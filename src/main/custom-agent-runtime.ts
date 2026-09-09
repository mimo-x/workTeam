import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

import type { AgentCapability } from "../shared/agent-team";
import {
  parseCustomAgentManifest,
  type CustomAgentEvent,
  type CustomAgentManifest,
} from "../shared/agent-protocol";
import type { ApprovalDecision, RpcRequestId } from "../shared/codex";
import { formatErrorMessage } from "../shared/error";
import {
  AgentRuntimeError,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type RuntimeAccess,
  type RuntimeSession,
  type RuntimeSkill,
  type RuntimeTurn,
} from "./agent-runtime";

const MAX_BODY_BYTES = 256_000;
const REQUEST_TIMEOUT_MS = 15_000;

const validateEndpoint = (value: string) => {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
  ) {
    throw new Error("自定义 HTTP Agent 的远程 endpoint 必须使用 HTTPS。");
  }
  return endpoint.toString().replace(/\/$/, "");
};

const runtimeError = (
  provider: string,
  error: unknown,
  fallback: string,
  kind: AgentRuntimeError["kind"] = "provider",
) =>
  error instanceof AgentRuntimeError
    ? error
    : new AgentRuntimeError({
        kind,
        provider,
        message: formatErrorMessage(error, fallback),
        raw: error,
      });

const normalizeEvent = (event: CustomAgentEvent, provider: string): AgentRuntimeEvent => {
  const params = { ...event.data, ...(event.turnId ? { turnId: event.turnId } : {}) };
  if (event.type === "message.delta")
    return { method: "message/delta", sessionId: event.sessionId, params };
  if (event.type === "message.completed")
    return { method: "message/completed", sessionId: event.sessionId, params };
  if (event.type === "activity") return { method: "activity", sessionId: event.sessionId, params };
  if (event.type === "approval.requested")
    return { method: "approval/requested", sessionId: event.sessionId, params };
  if (event.type === "turn.completed")
    return { method: "turn/completed", sessionId: event.sessionId, params, raw: event };
  if (event.type === "turn.failed") {
    return {
      method: "turn/completed",
      sessionId: event.sessionId,
      params: { ...params, turn: { id: event.turnId, status: "failed", error: event.data?.error } },
      raw: event,
    };
  }
  return { method: "provider/event", sessionId: event.sessionId, params, raw: { provider, event } };
};

export class CustomHttpRuntime implements AgentRuntime {
  readonly provider = "custom-http";
  readonly capabilities: readonly AgentCapability[];
  private readonly endpoint: string;
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly sessions = new Set<string>();
  private inFlight = 0;

  constructor(
    manifestInput: CustomAgentManifest,
    private readonly token = "",
    private readonly options: { maxConcurrency?: number; allowWorkspaceReference?: boolean } = {},
  ) {
    const manifest = parseCustomAgentManifest(manifestInput);
    if (manifest.transport !== "http" || !manifest.endpoint)
      throw new Error("HTTP Runtime 需要 HTTP Manifest。");
    if (manifest.auth === "bearer" && !token)
      throw new Error("HTTP Agent Manifest 要求 Bearer Token。");
    this.endpoint = validateEndpoint(manifest.endpoint);
    this.capabilities = manifest.capabilities;
  }

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async startSession(input: {
    workspace: string;
    model?: string;
    access: RuntimeAccess;
    providerSessionId?: string;
  }): Promise<RuntimeSession> {
    const body: Record<string, unknown> = {
      model: input.model,
      access: input.access,
      ...(input.providerSessionId ? { sessionId: input.providerSessionId } : {}),
    };
    if (this.options.allowWorkspaceReference) body.workspaceRef = input.workspace;
    const result = await this.request<{ sessionId: string }>("/sessions", { method: "POST", body });
    if (!result.sessionId) throw new Error("自定义 Agent 未返回 Session ID。");
    this.sessions.add(result.sessionId);
    return { sessionId: result.sessionId, providerSessionId: result.sessionId };
  }

  async checkHealth() {
    const result = await this.request<{ ok?: boolean }>("/health", { method: "GET" });
    return result.ok !== false;
  }

  async startTurn(
    sessionId: string,
    _workspace: string,
    text: string,
    model?: string,
    skills: Array<{ name: string; path: string }> = [],
  ): Promise<RuntimeTurn> {
    this.assertSession(sessionId);
    const result = await this.request<{ turnId: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: "POST",
        body: { text, model, skills },
      },
    );
    if (!result.turnId) throw new Error("自定义 Agent 未返回 Turn ID。");
    void this.streamEvents(sessionId, result.turnId);
    return { turnId: result.turnId };
  }

  async steerTurn(sessionId: string, turnId: string, text: string) {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/steer`,
      {
        method: "POST",
        body: { text },
      },
    );
  }

  async interruptTurn(sessionId: string, turnId: string) {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`,
      { method: "POST" },
    );
  }

  async listSkills(_workspace: string): Promise<RuntimeSkill[]> {
    return [];
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    await this.request(`/approvals/${encodeURIComponent(String(requestId))}`, {
      method: "POST",
      body: { decision },
    });
  }

  private assertSession(sessionId: string) {
    if (!this.sessions.has(sessionId)) throw new Error("自定义 Agent Session 不存在。");
  }

  private async streamEvents(sessionId: string, turnId: string) {
    try {
      const response = await fetch(
        `${this.endpoint}/sessions/${encodeURIComponent(sessionId)}/events?turnId=${encodeURIComponent(turnId)}`,
        {
          headers: this.headers(),
          signal: AbortSignal.timeout(60 * 60 * 1_000),
        },
      );
      if (!response.ok || !response.body) throw new Error(`事件流返回 HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim()) as CustomAgentEvent;
          completed = completed || event.type === "turn.completed" || event.type === "turn.failed";
          for (const listener of this.listeners)
            listener(normalizeEvent({ ...event, sessionId, turnId }, this.provider));
        }
      }
      if (!completed) {
        throw new Error("自定义 Agent 事件流在 Turn 完成前断开。");
      }
    } catch (error) {
      for (const listener of this.listeners) {
        listener({
          method: "turn/completed",
          sessionId,
          params: {
            turnId,
            turn: {
              id: turnId,
              status: "failed",
              error: formatErrorMessage(error, "自定义 Agent 事件流失败。"),
            },
          },
          raw: error,
        });
      }
    }
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    options: { method: string; body?: unknown },
  ): Promise<T> {
    const limit = this.options.maxConcurrency ?? 4;
    if (this.inFlight >= limit)
      throw runtimeError(
        this.provider,
        new Error("自定义 Agent 并发数已达上限。"),
        "自定义 Agent 并发数已达上限。",
        "transport",
      );
    this.inFlight += 1;
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        method: options.method,
        headers: {
          ...this.headers(),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const raw = await response.text();
      if (raw.length > MAX_BODY_BYTES) throw new Error("自定义 Agent 响应过大。");
      const body = JSON.parse(raw || "{}");
      if (!response.ok || body.error)
        throw new Error(body.error?.message || `自定义 Agent 返回 HTTP ${response.status}`);
      return body as T;
    } catch (error) {
      throw runtimeError(this.provider, error, "自定义 HTTP Agent 请求失败。", "transport");
    } finally {
      this.inFlight -= 1;
    }
  }

  private headers(): Record<string, string> {
    return this.token
      ? { authorization: `Bearer ${this.token}`, accept: "application/json" }
      : { accept: "application/json" };
  }
}

type CliSession = {
  id: string;
  process: ChildProcessWithoutNullStreams;
  lines: ReadLineInterface;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  activeTurns: Set<string>;
  turnTimers: Map<string, NodeJS.Timeout>;
  stderrTail: string;
};

export class CustomCliRuntime implements AgentRuntime {
  readonly provider = "custom-cli";
  readonly capabilities: readonly AgentCapability[];
  private readonly manifest: CustomAgentManifest;
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly sessions = new Map<string, CliSession>();
  private nextSession = 1;

  constructor(
    manifestInput: CustomAgentManifest,
    private readonly options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {},
  ) {
    this.manifest = parseCustomAgentManifest(manifestInput);
    if (this.manifest.transport !== "cli-jsonl" || !this.manifest.command)
      throw new Error("CLI Runtime 需要 CLI Manifest。");
    this.capabilities = this.manifest.capabilities;
  }

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async startSession(input: {
    workspace: string;
    model?: string;
    access: RuntimeAccess;
    providerSessionId?: string;
  }): Promise<RuntimeSession> {
    if (input.providerSessionId && this.sessions.has(input.providerSessionId)) {
      return { sessionId: input.providerSessionId, providerSessionId: input.providerSessionId };
    }
    const [command, ...inlineArgs] = this.manifest.command!.split(/\s+/);
    const args = [...inlineArgs, ...(this.manifest.args ?? [])];
    const child = spawn(command, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const id = input.providerSessionId ?? `cli_session_${this.nextSession++}`;
    const lines = createInterface({ input: child.stdout });
    let resolveReady: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const session = {
      id,
      process: child,
      lines,
      ready,
      resolveReady,
      rejectReady,
      activeTurns: new Set<string>(),
      turnTimers: new Map<string, NodeJS.Timeout>(),
      stderrTail: "",
    };
    this.sessions.set(id, session);
    lines.on("line", (line) => this.handleLine(id, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      session.stderrTail = `${session.stderrTail}${String(chunk)}`.slice(-4_000);
      if (String(chunk).length)
        this.emit({
          method: "provider/event",
          sessionId: id,
          params: { stderr: String(chunk).slice(-4_000) },
          raw: chunk,
        });
    });
    child.once("exit", (code, signal) => {
      const stderr = session.stderrTail.trim();
      const exitError = new Error(
        stderr
          ? `CLI 已退出（code=${code}, signal=${signal}）：${stderr}`
          : `CLI 已退出（code=${code}, signal=${signal}）`,
      );
      session.rejectReady(exitError);
      for (const turnId of session.activeTurns) {
        const timer = session.turnTimers.get(turnId);
        if (timer) clearTimeout(timer);
        session.turnTimers.delete(turnId);
        this.emit({
          method: "turn/completed",
          sessionId: id,
          params: { turnId, turn: { id: turnId, status: "failed", error: exitError.message } },
          raw: exitError,
        });
      }
      session.activeTurns.clear();
      this.emit({
        method: "runtime/status",
        sessionId: id,
        params: { connected: false, error: exitError.message },
      });
      this.sessions.delete(id);
    });
    this.write(session, {
      type: "session.start",
      sessionId: id,
      workspace: input.workspace,
      model: input.model,
      access: input.access,
    });
    const timeout = setTimeout(
      () => session.rejectReady(new Error("CLI Agent Session 握手超时。")),
      this.options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );
    timeout.unref();
    try {
      await session.ready;
    } catch (error) {
      child.kill();
      throw runtimeError(this.provider, error, "CLI Agent Session 握手失败。", "transport");
    } finally {
      clearTimeout(timeout);
    }
    return { sessionId: id, providerSessionId: id };
  }

  async startTurn(
    sessionId: string,
    _workspace: string,
    text: string,
    model?: string,
    skills: Array<{ name: string; path: string }> = [],
  ): Promise<RuntimeTurn> {
    const session = this.requireSession(sessionId);
    const turnId = `cli_turn_${randomUUID()}`;
    session.activeTurns.add(turnId);
    const timer = setTimeout(
      () => {
        session.activeTurns.delete(turnId);
        session.turnTimers.delete(turnId);
        this.emit({
          method: "turn/completed",
          sessionId,
          params: {
            turnId,
            turn: { id: turnId, status: "failed", error: "CLI Agent Turn 执行超时。" },
          },
        });
        session.process.kill();
      },
      this.options.timeoutMs ?? 60 * 60 * 1_000,
    );
    timer.unref();
    session.turnTimers.set(turnId, timer);
    this.write(session, { type: "turn.start", sessionId, turnId, text, model, skills });
    return { turnId };
  }

  async steerTurn(sessionId: string, turnId: string, text: string) {
    this.write(this.requireSession(sessionId), { type: "turn.steer", sessionId, turnId, text });
  }

  async interruptTurn(sessionId: string, turnId: string) {
    this.write(this.requireSession(sessionId), { type: "turn.cancel", sessionId, turnId });
  }

  async listSkills(_workspace: string): Promise<RuntimeSkill[]> {
    return [];
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    for (const session of this.sessions.values())
      this.write(session, { type: "approval.resolve", requestId, decision });
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.lines.close();
      session.process.kill();
    }
    this.sessions.clear();
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw runtimeError(
        this.provider,
        new Error("CLI Agent Session 不存在。"),
        "CLI Agent Session 不存在。",
        "transport",
      );
    return session;
  }

  private handleLine(sessionId: string, line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as CustomAgentEvent;
      if (event.type === "session.started") {
        this.sessions.get(sessionId)?.resolveReady();
        return;
      }
      if (event.type === "turn.completed" || event.type === "turn.failed") {
        if (event.turnId) {
          const session = this.sessions.get(sessionId);
          session?.activeTurns.delete(event.turnId);
          const timer = session?.turnTimers.get(event.turnId);
          if (timer) clearTimeout(timer);
          session?.turnTimers.delete(event.turnId);
        }
      }
      for (const listener of this.listeners)
        listener(normalizeEvent({ ...event, sessionId }, this.provider));
    } catch (error) {
      this.emit({
        method: "provider/event",
        sessionId,
        params: {
          error: formatErrorMessage(error, "CLI Agent 输出不是有效 JSONL。"),
          line: line.slice(0, 1_000),
        },
        raw: line,
      });
    }
  }

  private write(session: CliSession, value: Record<string, unknown>) {
    if (!session.process.stdin.writable)
      throw runtimeError(
        this.provider,
        new Error("CLI Agent stdin 不可用。"),
        "CLI Agent 连接不可用。",
        "transport",
      );
    session.process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private emit(event: AgentRuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
