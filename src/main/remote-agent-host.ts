import { hostname } from "node:os";
import { isAbsolute } from "node:path";

import type { BackendClient } from "./backend-client";
import type { AgentRuntime, AgentRuntimeEvent, RuntimeSession } from "./agent-runtime";
import type { AgentCapability } from "../shared/agent-team";
import type { AgentRuntimeRegistry } from "./runtime-registry";
import { formatErrorMessage } from "../shared/error";
import type { RemoteAgentHostState } from "../shared/backend";

type RemoteAgent = {
  id: string;
  executionTarget: "local" | "hosted";
};

type AssignedRun = {
  id: string;
  taskId: string;
  agentId: string;
  title: string;
  sourceRoomId: string;
  taskRoomId: string;
  contextVersion: number;
  leaseToken: string;
  agent: {
    name: string;
    title: string;
    mention: string;
    workspaceAccess: "read" | "write";
    skillPolicy: "none" | "allowlist" | "all";
    skillRefs?: Array<{ name: string; path?: string }>;
    provider?: string;
    model?: string | null;
    capabilities?: AgentCapability[];
    protocol?: string;
    runtimeEndpoint?: string;
    runtimeCommand?: string;
    runtimeArgs?: string[];
    runtimeAuth?: "bearer" | "none";
    private?: { instructions?: string; secrets?: Record<string, string> };
  };
  context: Array<{
    channel: "source" | "task";
    senderId: string;
    content: string;
    seq: number;
  }>;
};

type ActiveRun = {
  assignment: AssignedRun;
  runtime: AgentRuntime;
  threadId: string;
  turnId: string;
  content: string;
  lastProgressAt: number;
};

export class RemoteAgentHost {
  private socket: WebSocket | null = null;
  private workspace = "";
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private deviceId: string | undefined;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly sessionProviders = new Map<string, string>();
  private readonly runs = new Map<string, ActiveRun>();
  private readonly startingRuns = new Set<string>();
  private readonly turnToRun = new Map<string, string>();
  private readonly listeners = new Set<(state: RemoteAgentHostState) => void>();
  private readonly eventListeners = new Set<(event: Record<string, unknown>) => void>();
  private state: RemoteAgentHostState = {
    status: "stopped",
    workspace: "",
    deviceId: null,
    agentCount: 0,
    activeRunCount: 0,
    error: null,
  };

  constructor(
    private readonly backend: BackendClient,
    private readonly runtimeSource: AgentRuntime | AgentRuntimeRegistry,
  ) {
    this.runtimeSource.onEvent((event) => void this.onRuntimeEvent(event));
  }

  getState() {
    return { ...this.state };
  }

  onState(listener: (state: RemoteAgentHostState) => void) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: Record<string, unknown>) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(workspace: string) {
    if (!isAbsolute(workspace)) throw new Error("远程 Agent Host 需要有效的本机工作区。");
    this.workspace = workspace;
    this.stopped = false;
    this.clearReconnect();
    this.socket?.close(1000, "Restarting host");
    this.update({ status: "connecting", workspace, error: null });
    await this.connect();
    return this.getState();
  }

  stop() {
    this.stopped = true;
    this.clearReconnect();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const run of this.runs.values()) {
      if (run.threadId && run.turnId)
        void run.runtime.interruptTurn(run.threadId, run.turnId).catch(() => undefined);
    }
    this.runs.clear();
    this.turnToRun.clear();
    this.socket?.close(1000, "Host stopped");
    this.socket = null;
    this.sessions.clear();
    this.sessionProviders.clear();
    this.startingRuns.clear();
    this.update({ status: "stopped", activeRunCount: this.runs.size, error: null });
    return this.getState();
  }

  private async connect() {
    if (this.stopped) return;
    try {
      const agents = await this.backend.request<{ data: RemoteAgent[] }>({
        path: "/v1/agents?scope=owned&limit=100",
      });
      const localAgentIds = agents.data
        .filter((agent) => agent.executionTarget === "local")
        .map((agent) => agent.id);
      const connection = await this.backend.createRealtimeConnectionInfo();
      const socket = new WebSocket(connection.url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.send({
          type: "host.register",
          deviceId: this.deviceId,
          name: hostname(),
          platform: process.platform,
          agentIds: localAgentIds,
        });
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this.send({ type: "host.heartbeat" }), 10_000);
        this.heartbeatTimer.unref();
        this.update({ status: "connected", agentCount: localAgentIds.length, error: null });
      });
      socket.addEventListener("message", (event) => void this.onServerEvent(String(event.data)));
      socket.addEventListener("error", () => {
        this.update({ status: "error", error: "聊天后台实时连接失败。" });
      });
      socket.addEventListener("close", (event) => {
        if (this.socket === socket) this.socket = null;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        if (!this.stopped && event.code !== 1000) this.scheduleReconnect();
      });
    } catch (error) {
      this.update({
        status: "error",
        error: formatErrorMessage(error),
      });
      this.scheduleReconnect();
      throw error;
    }
  }

  private async onServerEvent(raw: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    for (const listener of this.eventListeners) listener(event);
    if (event.type === "host.registered") {
      this.deviceId = String(event.deviceId);
      this.update({ deviceId: this.deviceId });
      return;
    }
    if (event.type === "agent.run.assigned") {
      await this.execute(event.run as AssignedRun);
      return;
    }
    if (event.type === "task.context.appended") {
      const taskId = String(event.taskId ?? "");
      const update = `群聊产生了新的实时上下文：\n${String(event.senderId ?? "成员")}: ${String(event.content ?? "")}`;
      for (const run of this.runs.values()) {
        if (run.assignment.taskId === taskId && run.turnId) {
          await run.runtime.steerTurn(run.threadId, run.turnId, update).catch(() => undefined);
        }
      }
    }
  }

  private async execute(assignment: AssignedRun) {
    if (this.runs.has(assignment.id) || this.startingRuns.has(assignment.id)) return;
    this.startingRuns.add(assignment.id);
    try {
      const runtime = this.runtimeFor(assignment);
      if ("assertCapabilities" in this.runtimeSource) {
        this.runtimeSource.assertCapabilities(runtime, [
          "chat",
          ...(assignment.agent.workspaceAccess === "write" ? ["write_workspace"] : []),
        ]);
      }
      this.send({ type: "run.accept", runId: assignment.id, leaseToken: assignment.leaseToken });
      const threadKey = `${assignment.taskId}\u0000${assignment.agentId}`;
      let session = this.sessions.get(threadKey);
      const providerSessionId = session?.providerSessionId;
      if (
        !session ||
        this.sessionProviders.get(threadKey) !== runtime.provider ||
        (providerSessionId !== undefined && runtime.hasSession?.(providerSessionId) === false)
      ) {
        session = await runtime.startSession({
          workspace: this.workspace,
          access: assignment.agent.workspaceAccess === "write" ? "workspace-write" : "read-only",
          providerSessionId,
        });
        this.sessions.set(threadKey, session);
        this.sessionProviders.set(threadKey, runtime.provider);
      }
      const availableSkills = await runtime.listSkills(this.workspace).catch(() => []);
      const requested =
        assignment.agent.skillPolicy === "all"
          ? availableSkills
          : assignment.agent.skillPolicy === "allowlist"
            ? (assignment.agent.skillRefs ?? [])
            : [];
      const skills = requested
        .map((reference) =>
          availableSkills.find(
            (skill) =>
              skill.enabled &&
              skill.name === reference.name &&
              (!reference.path || skill.path === reference.path),
          ),
        )
        .filter((skill): skill is { name: string; path: string; enabled: boolean } =>
          Boolean(skill),
        )
        .map(({ name, path }) => ({ name, path }));
      const prompt = this.buildPrompt(assignment);
      const turn = await runtime.startTurn(
        session.sessionId,
        this.workspace,
        prompt,
        assignment.agent.model ?? undefined,
        skills,
      );
      this.runs.set(assignment.id, {
        assignment,
        runtime,
        threadId: session.sessionId,
        turnId: turn.turnId,
        content: "",
        lastProgressAt: 0,
      });
      this.turnToRun.set(turn.turnId, assignment.id);
      this.update({ activeRunCount: this.runs.size });
    } catch (error) {
      this.send({
        type: "run.fail",
        runId: assignment.id,
        leaseToken: assignment.leaseToken,
        error: formatErrorMessage(error),
      });
    } finally {
      this.startingRuns.delete(assignment.id);
    }
  }

  private buildPrompt(run: AssignedRun) {
    const context = run.context
      .map(
        (message) =>
          `[${message.channel === "source" ? "来源群" : "Task群"}#${message.seq}] ${message.senderId}: ${message.content}`,
      )
      .join("\n");
    return [
      run.agent.private?.instructions || "完成分配给你的任务。",
      `你的身份是 ${run.agent.name}（${run.agent.title}），提及名称是 ${run.agent.mention}。`,
      `你正在处理 Task「${run.title}」，上下文版本 ${run.contextVersion}。`,
      "任务执行期间，新的来源群消息会通过实时上下文继续送达。只以当前 Agent 身份回复。",
      context ? `当前聊天上下文：\n${context}` : "当前没有额外聊天上下文。",
    ].join("\n\n");
  }

  private async onRuntimeEvent(event: AgentRuntimeEvent) {
    const turnId = String(
      event.params.turnId ?? (event.params.turn as { id?: unknown } | undefined)?.id ?? "",
    );
    const runId = this.turnToRun.get(turnId);
    if (!runId) return;
    const run = this.runs.get(runId);
    if (!run) return;
    if (event.method === "message/delta") {
      run.content += String(event.params.delta ?? "");
      if (Date.now() - run.lastProgressAt > 500) {
        run.lastProgressAt = Date.now();
        this.send({
          type: "run.progress",
          runId,
          leaseToken: run.assignment.leaseToken,
          activity: "正在生成回复…",
          content: run.content,
        });
      }
    }
    const completed =
      event.method === "message/completed" && typeof event.params.text === "string"
        ? event.params.text
        : null;
    if (completed !== null) run.content = completed;
    if (event.method === "turn/completed") {
      const turn = (event.params.turn ?? {}) as Record<string, unknown>;
      const status = String(turn.status ?? "completed");
      if (status === "failed" || status === "interrupted") {
        this.send({
          type: "run.fail",
          runId,
          leaseToken: run.assignment.leaseToken,
          error: formatErrorMessage(
            turn.error,
            status === "interrupted" ? "Agent Runtime 已取消。" : "Agent Runtime 执行失败。",
          ),
        });
      } else {
        this.send({
          type: "run.complete",
          runId,
          leaseToken: run.assignment.leaseToken,
          content: run.content || "任务已完成。",
        });
      }
      this.runs.delete(runId);
      this.turnToRun.delete(turnId);
      this.update({ activeRunCount: this.runs.size });
    }
  }

  private runtimeFor(assignment: AssignedRun) {
    return "resolveBinding" in this.runtimeSource
      ? this.runtimeSource.resolveBinding(
          assignment.agentId,
          assignment.agent.provider,
          {
            provider: assignment.agent.provider ?? "codex",
            protocol: assignment.agent.protocol ?? "app-server",
            target: "local",
            model: assignment.agent.model ?? undefined,
            endpoint: assignment.agent.runtimeEndpoint,
            command: assignment.agent.runtimeCommand,
            args: assignment.agent.runtimeArgs,
            auth: assignment.agent.runtimeAuth,
          },
          assignment.agent.capabilities,
          assignment.agent.private?.secrets?.bearerToken ??
            assignment.agent.private?.secrets?.token,
        )
      : this.runtimeSource;
  }

  private send(event: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.update({ status: "connecting" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private update(patch: Partial<RemoteAgentHostState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.getState());
  }
}
