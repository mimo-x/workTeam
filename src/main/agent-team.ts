import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentCapability,
  AgentDefinition,
  AgentLoopCompletionPolicy,
  AgentLoopMode,
  AgentLoopSession,
  AgentMessageAction,
  AgentSession,
  AgentSessionState,
  AgentRuntimeBinding,
  AgentTask,
  ExternalTeamMessage,
  HumanContact,
  TaskRun,
  TaskReviewDecision,
  TaskStatus,
  TeamEvent,
  TeamMessage,
  TeamRoomSnapshot,
  TeamWorkspaceSnapshot,
} from "../shared/agent-team";
import { formatErrorMessage } from "../shared/error";
import type { AgentRuntime, AgentRuntimeEvent } from "./agent-runtime";
import type { AgentRuntimeRegistry } from "./runtime-registry";

type RuntimeRun = {
  id: string;
  workspace: string;
  sessionId: string;
  threadId: string | null;
  turnId: string | null;
  messageId: string;
  agentId: string;
  taskId?: string;
  loopId?: string;
};

type StoredWorkspace = TeamWorkspaceSnapshot & { version: number };
type LegacyRoom = Partial<TeamRoomSnapshot> & {
  workspace: string;
  roomId: string;
  name: string;
  agents?: AgentDefinition[];
  messages?: TeamMessage[];
};
type AgentMessagePublisher = (message: TeamMessage, agent: AgentDefinition) => Promise<void>;

class EventQueue {
  private values: AgentRuntimeEvent[] = [];
  private waiters: Array<(value: AgentRuntimeEvent) => void> = [];

  push(value: AgentRuntimeEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next() {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    return new Promise<AgentRuntimeEvent>((resolve) => this.waiters.push(resolve));
  }
}

const STORAGE_VERSION = 4;
const defaultRuntime: AgentRuntimeBinding = {
  provider: "codex",
  protocol: "app-server",
  target: "local",
};
const defaultCapabilities = (
  workspaceAccess: AgentDefinition["workspaceAccess"],
): AgentCapability[] => [
  "chat",
  "stream_progress",
  "read_workspace",
  ...(workspaceAccess === "write" ? ["write_workspace", "run_command"] : []),
];

export const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "agent_coordinator",
    name: "协调员",
    title: "Coordinator",
    mention: "@协调员",
    initials: "协",
    theme: "cyan",
    description: "拆解问题、汇总意见并决定下一步",
    workspaceAccess: "read",
    visibility: "private",
    ownerId: "local_user",
    executionLocation: "local",
    source: "builtin",
    runtime: defaultRuntime,
    capabilities: defaultCapabilities("read"),
    instructions:
      "你是多 Agent 群聊里的协调员。先理解目标和上下文，再给出清晰的任务拆解、取舍与下一步。你不能假装已经调用其他 Agent；需要其他角色时，应明确建议用户 @ 对应角色。",
  },
  {
    id: "agent_architect",
    name: "架构师",
    title: "Architect",
    mention: "@架构师",
    initials: "架",
    theme: "violet",
    description: "负责系统边界、数据模型和技术方案",
    workspaceAccess: "read",
    visibility: "public",
    ownerId: "local_user",
    executionLocation: "local",
    source: "builtin",
    runtime: defaultRuntime,
    capabilities: defaultCapabilities("read"),
    instructions:
      "你是多 Agent 群聊里的架构师。聚焦系统边界、接口、数据流、可靠性和技术取舍。可以读取项目，但不要修改文件。回答要能直接指导实现。",
  },
  {
    id: "agent_coder",
    name: "程序员",
    title: "Coder",
    mention: "@程序员",
    initials: "码",
    theme: "emerald",
    description: "实现功能、运行检查并汇报改动",
    workspaceAccess: "write",
    visibility: "private",
    ownerId: "local_user",
    executionLocation: "local",
    source: "builtin",
    runtime: defaultRuntime,
    capabilities: defaultCapabilities("write"),
    instructions:
      "你是多 Agent 群聊里的程序员。负责在当前工作区完成明确要求的代码改动并验证结果。修改前理解现有实现，保护用户已有改动，完成后简洁汇报文件和检查结果。",
  },
  {
    id: "agent_reviewer",
    name: "审查员",
    title: "Reviewer",
    mention: "@审查员",
    initials: "审",
    theme: "amber",
    description: "检查缺陷、安全风险和遗漏",
    workspaceAccess: "read",
    visibility: "public",
    ownerId: "local_user",
    executionLocation: "local",
    source: "builtin",
    runtime: defaultRuntime,
    capabilities: defaultCapabilities("read"),
    instructions:
      "你是多 Agent 群聊里的代码审查员。以发现真实缺陷为优先，检查正确性、安全性、并发、边界条件和测试缺口。可以读取项目，但不要修改文件。结论按严重程度排列，并引用具体文件。",
  },
];

const DEFAULT_ROOM_ID = "local-agent-team";
const MAX_MESSAGES = 300;
const MAX_CONTEXT_EVENTS = 1_000;
const DEFAULT_LOOP_DEADLINE_MS = 30 * 60 * 1_000;
const AD_HOC_RELAY_DEADLINE_MS = 10 * 60 * 1_000;
const SYSTEM_MAX_LOOP_TURNS = Math.max(
  10,
  Math.min(1_000, Number(process.env.AGENT_TEAM_MAX_LOOP_TURNS) || 100),
);
const clone = <T>(value: T): T => structuredClone(value);
const errorMessage = (error: unknown) => formatErrorMessage(error, "Codex 执行失败。");

type TaskProposal = {
  title: string;
  objective: string;
  expectedResult: string;
  plan: string[];
  acceptanceCriteria: string[];
  requestedAccess: "read" | "write";
};

type LoopAction = {
  action: "start" | "handoff" | "complete";
  title?: string;
  objective?: string;
  mode?: AgentLoopMode;
  completionPolicy?: AgentLoopCompletionPolicy;
  targetTurns?: number;
  participantAgentIds?: string[];
  nextAgentId?: string;
  reason?: string;
};

const proposalPattern = /<agent-team-task-proposal>([\s\S]*?)<\/agent-team-task-proposal>/i;
const loopActionPattern = /<agent-team-loop-action>([\s\S]*?)<\/agent-team-loop-action>/i;

const parseTaskProposal = (value: string): { content: string; proposal?: TaskProposal } => {
  const match = value.match(proposalPattern);
  if (!match) return { content: value };
  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    const title = String(raw.title ?? "")
      .trim()
      .slice(0, 100);
    const objective = String(raw.objective ?? "")
      .trim()
      .slice(0, 4_000);
    const expectedResult = String(raw.expectedResult ?? "")
      .trim()
      .slice(0, 4_000);
    const plan = Array.isArray(raw.plan)
      ? raw.plan
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const acceptanceCriteria = Array.isArray(raw.acceptanceCriteria)
      ? raw.acceptanceCriteria
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    if (!title || !objective || !plan.length)
      return { content: value.replace(match[0], "").trim() };
    return {
      content: value.replace(match[0], "").trim(),
      proposal: {
        title,
        objective,
        expectedResult: expectedResult || objective,
        plan,
        acceptanceCriteria,
        requestedAccess: raw.requestedAccess === "write" ? "write" : "read",
      },
    };
  } catch {
    return { content: value.replace(match[0], "").trim() };
  }
};

const parseLoopAction = (value: string): { content: string; action?: LoopAction } => {
  const match = value.match(loopActionPattern);
  if (!match) return { content: value };
  const content = value.replace(match[0], "").trim();
  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>;
    if (!new Set(["start", "handoff", "complete"]).has(String(raw.action))) return { content };
    const targetTurns = Number(raw.targetTurns);
    return {
      content,
      action: {
        action: raw.action as LoopAction["action"],
        title: typeof raw.title === "string" ? raw.title.trim().slice(0, 100) : undefined,
        objective:
          typeof raw.objective === "string" ? raw.objective.trim().slice(0, 4_000) : undefined,
        mode: ["handoff", "round-robin", "goal-driven"].includes(String(raw.mode))
          ? (raw.mode as AgentLoopMode)
          : undefined,
        completionPolicy: ["turn-target", "agent-complete", "consensus"].includes(
          String(raw.completionPolicy),
        )
          ? (raw.completionPolicy as AgentLoopCompletionPolicy)
          : undefined,
        targetTurns: Number.isFinite(targetTurns)
          ? Math.max(2, Math.min(SYSTEM_MAX_LOOP_TURNS, Math.floor(targetTurns)))
          : undefined,
        participantAgentIds: Array.isArray(raw.participantAgentIds)
          ? [
              ...new Set(
                raw.participantAgentIds.filter((id): id is string => typeof id === "string"),
              ),
            ].slice(0, 12)
          : undefined,
        nextAgentId:
          typeof raw.nextAgentId === "string" ? raw.nextAgentId.trim().slice(0, 64) : undefined,
        reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : undefined,
      },
    };
  } catch {
    return { content };
  }
};

const requestedTurnTarget = (value: string) => {
  const match = value.match(
    /(?:限制|持续|进行|一共|总共|共|最多|完成)\s*(\d{1,4})\s*(?:次|轮|回合)/u,
  );
  if (!match) return undefined;
  return Math.max(2, Math.min(SYSTEM_MAX_LOOP_TURNS, Number(match[1])));
};

const requestedLoopControl = (value: string) => {
  const normalized = value.trim().toLocaleLowerCase();
  const refersToLoop = /(loop|循环|接龙|协作)/iu.test(normalized);
  if (!refersToLoop) return undefined;
  if (/(暂停|等一下|先停)/u.test(normalized)) return "pause" as const;
  if (/(继续|恢复)/u.test(normalized)) return "resume" as const;
  if (/(停止|结束|终止|取消)/u.test(normalized)) return "cancel" as const;
  return undefined;
};

const eventTurnId = (event: AgentRuntimeEvent) => {
  if (typeof event.params.turnId === "string") return event.params.turnId;
  const turn = event.params.turn as Record<string, unknown> | undefined;
  return typeof turn?.id === "string" ? turn.id : null;
};

const completedAgentText = (event: AgentRuntimeEvent) => {
  if (event.method !== "message/completed") return null;
  return typeof event.params.text === "string" ? event.params.text : null;
};

const activityForEvent = (event: AgentRuntimeEvent) => {
  if (event.method !== "activity") return null;
  return typeof event.params.activity === "string" ? event.params.activity : null;
};

export class AgentTeamService {
  private workspaces = new Map<string, TeamWorkspaceSnapshot>();
  private loadPromises = new Map<string, Promise<TeamWorkspaceSnapshot>>();
  private listeners = new Set<(event: TeamEvent) => void>();
  private sessions = new Map<string, AgentSession>();
  private runs = new Map<string, RuntimeRun>();
  private writerTails = new Map<string, Promise<void>>();
  private agentTails = new Map<string, Promise<void>>();
  private persistTails = new Map<string, Promise<void>>();

  constructor(
    private readonly runtimeSource: AgentRuntime | AgentRuntimeRegistry,
    private readonly storeDir: string,
    private readonly publishAgentMessage?: AgentMessagePublisher,
  ) {}

  onEvent(listener: (event: TeamEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async flush() {
    await Promise.all(this.agentTails.values());
    await Promise.all(this.writerTails.values());
    await Promise.all(this.persistTails.values());
  }

  async getWorkspace(workspace: string) {
    return clone(await this.loadWorkspace(workspace));
  }

  async mergeRemoteWorkspace(remote: TeamWorkspaceSnapshot) {
    const state = await this.loadWorkspace(remote.workspace);
    const localAgents = state.agents.filter((agent) => agent.syncSource !== "backend");
    const localSelf = state.humans.find(
      (human) => human.id === "local_user" && human.syncSource !== "backend",
    );
    const remoteSelf = remote.humans.find((human) => human.id === "local_user");
    const localHumans = state.humans.filter(
      (human) => human.id !== "local_user" && human.syncSource !== "backend",
    );
    const localRooms = state.rooms.filter((room) => room.syncSource !== "backend");
    const localTasks = state.tasks.filter((task) => task.syncSource !== "backend");
    const previousRemoteRooms = new Map(
      state.rooms
        .filter((room) => room.syncSource === "backend")
        .map((room) => [room.roomId, room]),
    );
    const remoteRooms = remote.rooms.map((room) => {
      const previous = previousRemoteRooms.get(room.roomId);
      if (!previous) return room;
      const byExternalId = new Map<string, TeamMessage>();
      for (const message of [...previous.messages, ...room.messages]) {
        byExternalId.set(message.externalId ?? message.id, message);
      }
      const messages = [...byExternalId.values()]
        .sort((first, second) => first.seq - second.seq || first.createdAt - second.createdAt)
        .slice(-MAX_MESSAGES);
      return {
        ...room,
        messages,
        nextSeq: Math.max(room.nextSeq, ...messages.map((message) => message.seq + 1)),
      };
    });
    const remoteAgentById = new Map(remote.agents.map((agent) => [agent.id, agent]));
    const reconciledLocalAgents = localAgents.map((local) => {
      const cloud = remoteAgentById.get(local.cloudAgentId ?? local.id);
      return cloud
        ? {
            ...local,
            ...cloud,
            id: cloud.id,
            cloudAgentId: cloud.id,
            initials: local.initials,
            theme: local.theme,
            syncSource: "local" as const,
          }
        : local;
    });
    const claimedCloudAgentIds = new Set(
      reconciledLocalAgents.map((agent) => agent.cloudAgentId).filter(Boolean),
    );
    state.agents = this.validateAgents([
      ...reconciledLocalAgents,
      ...remote.agents.filter((agent) => !claimedCloudAgentIds.has(agent.id)),
    ]);
    state.humans = this.validateHumans([
      { ...(localSelf ?? remoteSelf!), ...remoteSelf, id: "local_user", syncSource: "local" },
      ...remote.humans.filter((human) => human.id !== "local_user"),
      ...localHumans,
    ]);
    state.rooms = [...localRooms, ...remoteRooms];
    state.tasks = [...localTasks, ...remote.tasks];
    this.persist(state);
    const snapshot = clone(state);
    this.emit({ type: "workspace-snapshot", snapshot });
    return snapshot;
  }

  clearRemoteWorkspaces() {
    for (const state of this.workspaces.values()) {
      const remoteAgentIds = new Set(
        state.agents.filter((agent) => agent.syncSource === "backend").map((agent) => agent.id),
      );
      for (const [runId, run] of this.runs) {
        if (!remoteAgentIds.has(run.agentId)) continue;
        const runtime = this.runtimeForAgentId(state, run.agentId);
        if (runtime && run.threadId && run.turnId)
          void runtime.interruptTurn(run.threadId, run.turnId).catch(() => undefined);
        this.runs.delete(runId);
      }
      for (const [key, session] of this.sessions) {
        if (remoteAgentIds.has(session.agentId)) this.sessions.delete(key);
      }
      state.agents = state.agents.filter((agent) => agent.syncSource !== "backend");
      state.humans = state.humans.filter((human) => human.syncSource !== "backend");
      state.rooms = state.rooms.filter((room) => room.syncSource !== "backend");
      state.tasks = state.tasks.filter((task) => task.syncSource !== "backend");
      this.persist(state);
      this.emit({ type: "workspace-snapshot", snapshot: clone(state) });
    }
  }

  async sendMessage(options: {
    workspace: string;
    roomId?: string;
    text: string;
    model?: string;
    targetAgentIds?: string[];
    agentAction?: AgentMessageAction;
    transport?: "local" | "openim";
    externalId?: string;
  }) {
    const state = await this.loadWorkspace(options.workspace);
    const room = this.requireRoom(state, options.roomId || DEFAULT_ROOM_ID);
    const directAgent =
      room.type === "direct"
        ? state.agents.find((agent) => agent.id === room.directPrincipalId)
        : undefined;
    const targets = directAgent
      ? [directAgent]
      : this.resolveTargets(state, room, options.text, options.targetAgentIds);
    const message = this.createMessage(state, room, {
      externalId: options.externalId,
      senderId: "local_user",
      senderName: "我",
      senderType: "user",
      content: options.text.trim(),
      targetAgentIds: targets.map((agent) => agent.id),
      agentAction: options.agentAction ?? "chat",
      transport: options.transport ?? "local",
    });
    this.upsertMessage(state, room, message);
    const loopControl = requestedLoopControl(message.content);
    const activeLoop = state.loops.find(
      (loop) =>
        loop.roomId === room.roomId && (loop.status === "running" || loop.status === "paused"),
    );
    if (loopControl && activeLoop) {
      await this.controlLoop(state.workspace, activeLoop.id, loopControl, options.model);
      return { messageId: message.id, runIds: [] };
    }
    return this.routeUserMessage(
      state,
      room,
      message,
      targets,
      options.model,
      options.agentAction ?? "chat",
    );
  }

  async ingestExternalMessage(options: {
    workspace: string;
    message: ExternalTeamMessage;
    model?: string;
    targetAgentIds?: string[];
    triggerAgents?: boolean;
    agentAction?: AgentMessageAction;
  }) {
    const state = await this.loadWorkspace(options.workspace);
    const room = this.ensureExternalRoom(state, options.message.roomId);
    const existing = room.messages.find(
      (message) =>
        message.externalId === options.message.externalId ||
        (options.message.runId && message.runId === options.message.runId),
    );
    if (existing) {
      if (options.triggerAgents && existing.senderType === "user" && !existing.taskId) {
        const targets = this.resolveTargets(state, room, existing.content, options.targetAgentIds);
        if (targets.length) {
          existing.targetAgentIds = targets.map((target) => target.id);
          this.upsertMessage(state, room, existing);
          const routed = this.routeUserMessage(
            state,
            room,
            existing,
            targets,
            options.model,
            options.agentAction ?? existing.agentAction ?? "chat",
          );
          return { ...routed, duplicate: true };
        }
      }
      return { messageId: existing.id, runIds: [], duplicate: true };
    }

    const agent = state.agents.find(
      (candidate) =>
        candidate.id === options.message.senderId ||
        candidate.openimUserId === options.message.senderId,
    );
    const knownHuman = state.humans.find(
      (human) =>
        human.id === options.message.senderId || human.openimUserId === options.message.senderId,
    );
    if (!agent && !knownHuman) {
      state.humans.push({
        id: options.message.senderId,
        name: options.message.senderName,
        initials: options.message.senderName.slice(0, 2),
        title: "OpenIM 好友",
        status: "online",
      });
      if (!room.humanIds.includes(options.message.senderId))
        room.humanIds.push(options.message.senderId);
      this.emit({ type: "humans-upsert", workspace: state.workspace, humans: clone(state.humans) });
    }
    const message = this.createMessage(state, room, {
      externalId: options.message.externalId,
      senderId: agent?.id ?? knownHuman?.id ?? options.message.senderId,
      senderName: options.message.senderName,
      senderType: agent ? "agent" : "user",
      content: options.message.content,
      createdAt: options.message.createdAt,
      runId: options.message.runId,
      agentHop: options.message.agentHop,
      relayRootId: options.message.relayRootId,
      loopId: options.message.loopId,
      loopTurn: options.message.loopTurn,
      agentAction: options.agentAction ?? options.message.agentAction ?? "chat",
      transport: "openim",
    });
    this.upsertMessage(state, room, message);

    if (!options.triggerAgents) {
      return { messageId: message.id, runIds: [], duplicate: false };
    }
    const loopControl = agent ? undefined : requestedLoopControl(message.content);
    const activeLoop = state.loops.find(
      (loop) =>
        loop.roomId === room.roomId && (loop.status === "running" || loop.status === "paused"),
    );
    if (loopControl && activeLoop) {
      await this.controlLoop(state.workspace, activeLoop.id, loopControl, options.model);
      return { messageId: message.id, runIds: [], duplicate: false };
    }
    let targets = this.resolveTargets(state, room, message.content, options.targetAgentIds).filter(
      (target) => target.id !== agent?.id,
    );
    if (!targets.length) {
      return { messageId: message.id, runIds: [], duplicate: false };
    }
    if (agent && message.loopId) {
      const loop = state.loops.find((candidate) => candidate.id === message.loopId);
      if (loop) {
        const advanced = this.advanceLoop(state, room, loop, message, agent, targets);
        if (advanced.status !== "running") {
          return { messageId: message.id, runIds: [], duplicate: false };
        }
        const nextAgent = state.agents.find((candidate) => candidate.id === advanced.nextAgentId);
        if (!nextAgent) return { messageId: message.id, runIds: [], duplicate: false };
        message.targetAgentIds = [nextAgent.id];
        this.upsertMessage(state, room, message);
        const runId = this.scheduleAgent(
          state,
          room,
          message,
          nextAgent,
          undefined,
          options.model,
          false,
          advanced,
        );
        return { messageId: message.id, runIds: [runId], duplicate: false };
      }
    }
    if (agent)
      targets = targets.filter((target) => this.canContinueAdHocRelay(room, message, target));
    if (!targets.length) return { messageId: message.id, runIds: [], duplicate: false };
    message.targetAgentIds = targets.map((target) => target.id);
    this.upsertMessage(state, room, message);
    const routed = this.routeUserMessage(
      state,
      room,
      message,
      targets,
      options.model,
      options.agentAction ?? options.message.agentAction ?? "chat",
    );
    return { ...routed, duplicate: false };
  }

  async stopRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run?.threadId || !run.turnId) throw new Error("这个 Agent 当前没有可停止的任务。");
    const state = await this.loadWorkspace(run.workspace);
    const runtime = this.runtimeForAgentId(state, run.agentId);
    if (!runtime) throw new Error("找不到这个 Agent 的 Runtime。");
    await runtime.interruptTurn(run.threadId, run.turnId);
    const session = state.sessions.find((candidate) => candidate.id === run.sessionId);
    if (session) {
      this.transitionSession(session, "cancelled");
      this.emitSession(state, session);
    }
  }

  async controlLoop(
    workspace: string,
    loopId: string,
    action: "pause" | "resume" | "cancel",
    model?: string,
  ) {
    const state = await this.loadWorkspace(workspace);
    const loop = this.requireLoop(state, loopId);
    if (action === "pause") {
      if (loop.status !== "running") throw new Error("只有运行中的 Loop 可以暂停。");
      loop.status = "paused";
      loop.endReason = "由用户暂停。";
    } else if (action === "cancel") {
      if (["completed", "cancelled", "failed"].includes(loop.status)) {
        throw new Error("这个 Loop 已经结束。");
      }
      loop.status = "cancelled";
      loop.endReason = "由用户终止。";
      for (const run of this.runs.values()) {
        if (run.loopId === loop.id && run.threadId && run.turnId) {
          const runtime = this.runtimeForAgentId(state, run.agentId);
          if (runtime) void runtime.interruptTurn(run.threadId, run.turnId).catch(() => undefined);
          const session = state.sessions.find((candidate) => candidate.id === run.sessionId);
          if (session) {
            this.transitionSession(session, "cancelled");
            this.emitSession(state, session);
          }
        }
      }
    } else {
      if (loop.status !== "paused") throw new Error("只有暂停中的 Loop 可以继续。");
      if (loop.completedTurns >= loop.safetyMaxTurns) {
        throw new Error("Loop 已达到系统安全预算，不能继续。");
      }
      const room = this.requireRoom(state, loop.roomId);
      const anchor = room.messages.find((message) => message.id === loop.lastMessageId);
      const nextAgent = state.agents.find(
        (agent) => agent.id === loop.nextAgentId && loop.participantAgentIds.includes(agent.id),
      );
      if (!anchor || !nextAgent) throw new Error("Loop 缺少可恢复的下一位 Agent。");
      loop.status = "running";
      loop.endReason = undefined;
      loop.deadlineAt = Date.now() + DEFAULT_LOOP_DEADLINE_MS;
      loop.updatedAt = Date.now();
      this.emitLoop(state, loop);
      if ([...this.runs.values()].some((run) => run.loopId === loop.id)) return clone(loop);
      this.scheduleAgent(state, room, anchor, nextAgent, undefined, model, false, loop);
      return clone(loop);
    }
    loop.updatedAt = Date.now();
    this.emitLoop(state, loop);
    return clone(loop);
  }

  async saveAgents(workspace: string, agents: AgentDefinition[]) {
    const state = await this.loadWorkspace(workspace);
    const remoteAgents = state.agents.filter((agent) => agent.syncSource === "backend");
    const localInput = agents.filter((agent) => agent.syncSource !== "backend");
    const nextAgents = this.validateAgents(localInput);
    state.agents = [
      ...nextAgents.map((agent) => ({ ...agent, ownerId: "local_user" })),
      ...remoteAgents,
    ];
    const validIds = new Set(state.agents.map((agent) => agent.id));
    for (const room of state.rooms) {
      room.agentIds = room.agentIds.filter((id) => validIds.has(id));
      if (room.type === "direct") {
        const directAgent = state.agents.find((agent) => agent.id === room.directPrincipalId);
        if (directAgent) room.name = directAgent.name;
      }
    }
    this.persist(state);
    this.emit({ type: "agents-upsert", workspace, agents: clone(state.agents) });
    return clone(state);
  }

  async promoteAgents(
    workspace: string,
    mappings: Array<{
      localAgentId: string;
      cloudAgentId: string;
      openimUserId: string;
      version: number;
    }>,
  ) {
    const state = await this.loadWorkspace(workspace);
    const normalized = mappings.map((mapping) => ({
      localAgentId: String(mapping.localAgentId).trim(),
      cloudAgentId: String(mapping.cloudAgentId).trim(),
      openimUserId: String(mapping.openimUserId).trim(),
      version: Math.max(1, Number(mapping.version) || 1),
    }));
    const ids = new Map(normalized.map((mapping) => [mapping.localAgentId, mapping.cloudAgentId]));
    if ([...this.runs.values()].some((run) => ids.has(run.agentId))) {
      throw new Error("Agent 正在回复或执行任务，请结束运行后再同步到云端。");
    }
    for (const mapping of normalized) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(mapping.cloudAgentId)) {
        throw new Error("云端 Agent ID 无效。");
      }
      if (!mapping.openimUserId) throw new Error("云端 Agent 缺少 OpenIM 身份。");
      const local = state.agents.find((agent) => agent.id === mapping.localAgentId);
      if (!local || local.syncSource === "backend" || local.ownerId !== "local_user") {
        throw new Error(`本地 Agent 不存在或不可迁移：${mapping.localAgentId}`);
      }
    }
    const promotedByLocalId = new Map(
      normalized.map((mapping) => {
        const local = state.agents.find((agent) => agent.id === mapping.localAgentId)!;
        return [
          mapping.localAgentId,
          {
            ...local,
            id: mapping.cloudAgentId,
            cloudAgentId: mapping.cloudAgentId,
            openimUserId: mapping.openimUserId,
            version: mapping.version,
            syncSource: "local" as const,
          },
        ] as const;
      }),
    );
    const promotedCloudIds = new Set(normalized.map((mapping) => mapping.cloudAgentId));
    state.agents = state.agents
      .filter(
        (agent) =>
          promotedByLocalId.has(agent.id) || !promotedCloudIds.has(agent.cloudAgentId ?? agent.id),
      )
      .map((agent) => promotedByLocalId.get(agent.id) ?? agent);
    const mapId = (id: string) => ids.get(id) ?? id;
    const mapIds = (values: string[]) => [...new Set(values.map(mapId))];
    for (const room of state.rooms) {
      room.agentIds = mapIds(room.agentIds);
      if (room.directPrincipalId) room.directPrincipalId = mapId(room.directPrincipalId);
      for (const message of room.messages) {
        message.senderId = mapId(message.senderId);
        if (message.targetAgentIds) message.targetAgentIds = mapIds(message.targetAgentIds);
      }
    }
    for (const task of state.tasks) {
      task.assigneeIds = mapIds(task.assigneeIds);
      if (task.proposedByAgentId) task.proposedByAgentId = mapId(task.proposedByAgentId);
      task.runs = task.runs.map((run) => ({ ...run, agentId: mapId(run.agentId) }));
      task.consumedContextVersionByAgent = Object.fromEntries(
        Object.entries(task.consumedContextVersionByAgent).map(([id, version]) => [
          mapId(id),
          version,
        ]),
      );
    }
    for (const loop of state.loops) {
      loop.participantAgentIds = mapIds(loop.participantAgentIds);
      if (loop.currentAgentId) loop.currentAgentId = mapId(loop.currentAgentId);
      if (loop.nextAgentId) loop.nextAgentId = mapId(loop.nextAgentId);
    }
    for (const session of state.sessions) {
      session.agentId = mapId(session.agentId);
    }
    const remappedSessions = new Map<string, AgentSession>();
    for (const [key, session] of this.sessions) {
      const parts = key.split("\u0000");
      const mappedAgentId = ids.get(parts[2]);
      if (!mappedAgentId) {
        remappedSessions.set(key, session);
        continue;
      }
      session.agentId = mappedAgentId;
      parts[2] = mappedAgentId;
      remappedSessions.set(parts.join("\u0000"), session);
    }
    this.sessions = remappedSessions;
    this.persist(state);
    const snapshot = clone(state);
    this.emit({ type: "workspace-snapshot", snapshot });
    return snapshot;
  }

  async saveHumans(workspace: string, humans: HumanContact[]) {
    const state = await this.loadWorkspace(workspace);
    state.humans = this.validateHumans(humans);
    const validIds = new Set(state.humans.map((human) => human.id));
    for (const room of state.rooms) {
      room.humanIds = room.humanIds.filter((id) => validIds.has(id));
      if (!room.humanIds.includes("local_user")) room.humanIds.unshift("local_user");
      if (room.type === "direct") {
        const directHuman = state.humans.find((human) => human.id === room.directPrincipalId);
        if (directHuman) room.name = directHuman.name;
      }
    }
    this.persist(state);
    this.emit({ type: "humans-upsert", workspace, humans: clone(state.humans) });
    return clone(state);
  }

  async createRoom(workspace: string, name: string, agentIds: string[], humanIds: string[]) {
    const state = await this.loadWorkspace(workspace);
    const room: TeamRoomSnapshot = {
      workspace,
      roomId: `group_${randomUUID()}`,
      name: this.validateRoomName(name),
      type: "group",
      agentIds: this.validateRoomAgents(state, agentIds),
      humanIds: this.validateRoomHumans(state, humanIds),
      createdAt: Date.now(),
      nextSeq: 1,
      messages: [],
    };
    state.rooms.push(room);
    this.persist(state);
    this.emit({ type: "room-upsert", workspace, room: clone(room) });
    return clone(room);
  }

  async updateRoom(
    workspace: string,
    roomId: string,
    name: string,
    agentIds: string[],
    humanIds: string[],
  ) {
    const state = await this.loadWorkspace(workspace);
    const room = this.requireRoom(state, roomId);
    if (room.type === "direct") throw new Error("私聊成员和名称由联系人身份决定。");
    const nextAgentIds = this.validateRoomAgents(state, agentIds);
    const assigneesChanged =
      room.agentIds.length !== nextAgentIds.length ||
      room.agentIds.some((id) => !nextAgentIds.includes(id));
    if (room.taskId && assigneesChanged) {
      if (!nextAgentIds.length) throw new Error("Task 至少需要一个执行 Agent。");
      const task = this.requireTask(state, room.taskId);
      if (!["pending_review", "changes_requested", "approved"].includes(task.status)) {
        throw new Error("Task 执行开始后不能修改执行 Agent。");
      }
      task.assigneeIds = [...nextAgentIds];
      task.revision += 1;
      task.status = "pending_review";
      task.approvedReviewId = undefined;
      task.updatedAt = Date.now();
      this.emitTask(state, task);
    }
    room.name = this.validateRoomName(name);
    room.agentIds = nextAgentIds;
    room.humanIds = this.validateRoomHumans(state, humanIds);
    this.persist(state);
    this.emit({ type: "room-upsert", workspace, room: clone(room) });
    return clone(room);
  }

  async openDirectRoom(workspace: string, principalId: string) {
    const state = await this.loadWorkspace(workspace);
    if (principalId === "local_user") throw new Error("不能和自己创建私聊。");
    const agent = state.agents.find((candidate) => candidate.id === principalId);
    const human = state.humans.find((candidate) => candidate.id === principalId);
    if (!agent && !human) throw new Error("联系人不存在或当前不可见。");
    const existing = state.rooms.find(
      (room) => room.type === "direct" && room.directPrincipalId === principalId,
    );
    if (existing) return clone(existing);
    const room: TeamRoomSnapshot = {
      workspace,
      roomId: `direct_${createHash("sha256").update(principalId).digest("hex").slice(0, 20)}`,
      name: agent?.name ?? human!.name,
      type: "direct",
      agentIds: agent ? [agent.id] : [],
      humanIds: human ? ["local_user", human.id] : ["local_user"],
      directPrincipalId: principalId,
      createdAt: Date.now(),
      nextSeq: 1,
      messages: [],
    };
    state.rooms.push(room);
    this.persist(state);
    this.emit({ type: "room-upsert", workspace, room: clone(room) });
    return clone(room);
  }

  async updateTaskStatus(workspace: string, taskId: string, status: TaskStatus) {
    const state = await this.loadWorkspace(workspace);
    const task = this.requireTask(state, taskId);
    const allowed = new Set<TaskStatus>([
      "waiting",
      "review",
      "blocked",
      "done",
      "failed",
      "cancelled",
    ]);
    if (!allowed.has(status)) throw new Error("Task 状态无效。");
    task.status = status;
    task.updatedAt = Date.now();
    this.persist(state);
    this.emitTask(state, task);
    return clone(task);
  }

  async reviewTask(workspace: string, taskId: string, decision: TaskReviewDecision, comment = "") {
    const state = await this.loadWorkspace(workspace);
    const task = this.requireTask(state, taskId);
    if (!["pending_review", "changes_requested", "approved"].includes(task.status)) {
      throw new Error("当前 Task 状态不允许审核。");
    }
    const reviewer = state.humans.find((human) => human.id === "local_user");
    const review = {
      id: `review_${randomUUID()}`,
      taskId,
      taskRevision: task.revision,
      reviewerUserId: "local_user",
      reviewerName: reviewer?.name ?? "我",
      decision,
      comment: comment.trim() || undefined,
      reviewedAt: Date.now(),
    };
    task.reviews.push(review);
    task.approvedReviewId = decision === "approved" ? review.id : undefined;
    task.status =
      decision === "approved"
        ? "approved"
        : decision === "changes_requested"
          ? "changes_requested"
          : "cancelled";
    task.updatedAt = Date.now();
    this.persist(state);
    this.emitTask(state, task);
    return clone(task);
  }

  async startTask(workspace: string, taskId: string, model?: string) {
    const state = await this.loadWorkspace(workspace);
    const task = this.requireTask(state, taskId);
    const approval = task.reviews.find((review) => review.id === task.approvedReviewId);
    if (
      task.status !== "approved" ||
      !approval ||
      approval.decision !== "approved" ||
      approval.taskRevision !== task.revision
    ) {
      throw new Error("当前版本尚未通过人工审核，不能开始执行。");
    }
    const taskRoom = this.requireRoom(state, task.taskRoomId);
    const agents = state.agents.filter((agent) => task.assigneeIds.includes(agent.id));
    if (!agents.length) throw new Error("Task 没有可执行的 Agent。");
    if (agents.some((agent) => agent.executionLocation === "hosted")) {
      throw new Error("Task 包含托管 Agent，但云端 Worker 尚未接入，当前不能开始执行。");
    }
    const reviewer = state.humans.find((human) => human.id === approval.reviewerUserId);
    const instruction = this.createMessage(state, taskRoom, {
      senderId: "local_user",
      senderName: reviewer?.name ?? "我",
      senderType: "system",
      content: `方案 v${task.revision} 已由 ${approval.reviewerName} 审核通过，开始执行。`,
      targetAgentIds: agents.map((agent) => agent.id),
      taskId: task.id,
      transport: "local",
    });
    this.upsertMessage(state, taskRoom, instruction);
    task.status = "queued";
    task.startedByUserId = "local_user";
    task.startedAt = Date.now();
    task.updatedAt = task.startedAt;
    for (const agent of agents)
      this.scheduleAgent(state, taskRoom, instruction, agent, task, model);
    this.persist(state);
    this.emitTask(state, task);
    return clone(task);
  }

  private routeUserMessage(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    message: TeamMessage,
    targets: AgentDefinition[],
    model?: string,
    action: AgentMessageAction = "chat",
  ) {
    if (!targets.length) return { messageId: message.id, runIds: [] };
    const executable = targets.filter((agent) => agent.executionLocation !== "hosted");
    for (const agent of targets.filter((candidate) => candidate.executionLocation === "hosted")) {
      const response = this.createMessage(state, room, {
        senderId: agent.id,
        senderName: agent.name,
        senderType: "agent",
        content: "",
        status: "error",
        error: "该 Agent 由托管 Runtime 执行，但云端 Worker 尚未接入。",
        replyTo: message.id,
        transport: message.transport,
      });
      this.upsertMessage(state, room, response);
    }
    const runIds = executable.map((agent) =>
      this.scheduleAgent(state, room, message, agent, undefined, model, action === "propose-task"),
    );
    return { messageId: message.id, runIds };
  }

  private createTaskProposal(
    state: TeamWorkspaceSnapshot,
    sourceRoom: TeamRoomSnapshot,
    anchor: TeamMessage,
    targets: AgentDefinition[],
    proposal: TaskProposal,
    proposedByAgentId: string,
  ) {
    const now = Date.now();
    const taskId = `task_${randomUUID()}`;
    const taskRoomId = `task_room_${randomUUID()}`;
    const task: AgentTask = {
      id: taskId,
      title: proposal.title,
      objective: proposal.objective,
      expectedResult: proposal.expectedResult,
      plan: proposal.plan,
      acceptanceCriteria: proposal.acceptanceCriteria,
      requestedAccess: proposal.requestedAccess,
      creatorId: anchor.senderId,
      requestedByUserId: anchor.senderId,
      proposedByAgentId,
      sourceRoomId: sourceRoom.roomId,
      anchorMessageId: anchor.id,
      anchorSeq: anchor.seq,
      taskRoomId,
      assigneeIds: targets.map((agent) => agent.id),
      status: "pending_review",
      revision: 1,
      reviews: [],
      contextVersion: 1,
      latestSourceSeq: anchor.seq,
      consumedContextVersionByAgent: {},
      contextEvents: [{ messageId: anchor.id, sourceSeq: anchor.seq, createdAt: anchor.createdAt }],
      runs: [],
      createdAt: now,
      updatedAt: now,
    };
    const taskRoom: TeamRoomSnapshot = {
      workspace: state.workspace,
      roomId: taskRoomId,
      name: task.title,
      type: "task",
      agentIds: [...task.assigneeIds],
      humanIds: ["local_user"],
      sourceRoomId: sourceRoom.roomId,
      taskId,
      createdAt: now,
      nextSeq: 1,
      messages: [],
    };
    anchor.taskId = taskId;
    state.tasks.push(task);
    state.rooms.push(taskRoom);
    this.upsertMessage(state, sourceRoom, anchor);
    this.persist(state);
    this.emit({ type: "room-upsert", workspace: state.workspace, room: clone(taskRoom) });
    this.emitTask(state, task);
    return { task, taskRoom };
  }

  private updateTaskProposal(task: AgentTask, proposal: TaskProposal, proposedByAgentId: string) {
    task.title = proposal.title;
    task.objective = proposal.objective;
    task.expectedResult = proposal.expectedResult;
    task.plan = proposal.plan;
    task.acceptanceCriteria = proposal.acceptanceCriteria;
    task.requestedAccess = proposal.requestedAccess;
    task.proposedByAgentId = proposedByAgentId;
    task.revision += 1;
    task.status = "pending_review";
    task.approvedReviewId = undefined;
    task.updatedAt = Date.now();
  }

  private createLoop(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    rootMessage: TeamMessage,
    response: TeamMessage,
    currentAgent: AgentDefinition,
    mentionedAgents: AgentDefinition[],
    action?: LoopAction,
  ) {
    const requestedTurns = requestedTurnTarget(rootMessage.content) ?? action?.targetTurns;
    if (action?.action !== "start" && (!requestedTurns || !mentionedAgents.length))
      return undefined;
    const requestedParticipantIds = new Set([
      currentAgent.id,
      ...mentionedAgents.map((agent) => agent.id),
      ...(action?.participantAgentIds ?? []),
      ...(action?.nextAgentId ? [action.nextAgentId] : []),
    ]);
    const participantAgentIds = room.agentIds.filter((id) => requestedParticipantIds.has(id));
    if (participantAgentIds.length < 2) return undefined;
    const nextAgentId =
      participantAgentIds.find((id) => id === action?.nextAgentId && id !== currentAgent.id) ??
      mentionedAgents.find((agent) => participantAgentIds.includes(agent.id))?.id ??
      participantAgentIds.find((id) => id !== currentAgent.id);
    if (!nextAgentId) return undefined;
    const now = Date.now();
    const completionPolicy =
      action?.completionPolicy ?? (requestedTurns ? "turn-target" : "agent-complete");
    const targetTurns = completionPolicy === "turn-target" ? (requestedTurns ?? 2) : requestedTurns;
    const loop: AgentLoopSession = {
      id: `loop_${randomUUID()}`,
      roomId: room.roomId,
      rootMessageId: rootMessage.relayRootId ?? rootMessage.id,
      lastMessageId: response.id,
      title: action?.title || `Agent 协作 · ${room.name}`,
      objective: action?.objective || rootMessage.content.slice(0, 4_000),
      participantAgentIds,
      mode: action?.mode ?? "handoff",
      completionPolicy,
      targetTurns,
      safetyMaxTurns: Math.max(targetTurns ?? 2, SYSTEM_MAX_LOOP_TURNS),
      completedTurns: 1,
      currentAgentId: currentAgent.id,
      nextAgentId,
      status: "running",
      contextCursor: response.seq,
      deadlineAt: now + DEFAULT_LOOP_DEADLINE_MS,
      consecutiveErrors: 0,
      recentResponseFingerprints: [this.responseFingerprint(response.content)],
      createdBy: rootMessage.senderId,
      createdAt: now,
      updatedAt: now,
    };
    response.loopId = loop.id;
    response.loopTurn = 1;
    response.relayRootId = loop.rootMessageId;
    state.loops.unshift(loop);
    this.emitLoop(state, loop);
    return loop;
  }

  private advanceLoop(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    loop: AgentLoopSession,
    response: TeamMessage,
    currentAgent: AgentDefinition,
    mentionedAgents: AgentDefinition[],
    action?: LoopAction,
  ) {
    loop.completedTurns = Math.max(
      loop.completedTurns,
      response.loopTurn ?? loop.completedTurns + 1,
    );
    loop.currentAgentId = currentAgent.id;
    loop.lastMessageId = response.id;
    loop.contextCursor = response.seq;
    loop.consecutiveErrors = 0;
    const fingerprint = this.responseFingerprint(response.content);
    loop.recentResponseFingerprints.push(fingerprint);
    loop.recentResponseFingerprints = loop.recentResponseFingerprints.slice(-6);
    loop.updatedAt = Date.now();

    const recent = loop.recentResponseFingerprints.slice(-3);
    if (recent.length === 3 && new Set(recent).size === 1) {
      loop.status = "paused";
      loop.endReason = "检测到连续重复回复。";
    } else if (Date.now() >= loop.deadlineAt) {
      loop.status = "paused";
      loop.endReason = "Loop 已达到运行时限。";
    } else if (loop.targetTurns && loop.completedTurns >= loop.targetTurns) {
      loop.status = "completed";
      loop.endReason = `已完成 ${loop.targetTurns} 次 Agent 回复。`;
      loop.nextAgentId = undefined;
    } else if (loop.completedTurns >= loop.safetyMaxTurns) {
      loop.status = "paused";
      loop.endReason = "Loop 已达到系统安全预算。";
    } else if (action?.action === "complete" && loop.completionPolicy !== "turn-target") {
      loop.status = "completed";
      loop.endReason = action.reason || "Agent 已报告协作目标完成。";
      loop.nextAgentId = undefined;
    } else {
      const nextAgentId = this.resolveNextLoopAgent(loop, currentAgent.id, mentionedAgents, action);
      loop.nextAgentId = nextAgentId;
      if (!nextAgentId && loop.status === "running") {
        loop.status = "paused";
        loop.endReason = "Agent 没有指定下一位协作者。";
      }
    }
    this.emitLoop(state, loop);
    return loop;
  }

  private resolveNextLoopAgent(
    loop: AgentLoopSession,
    currentAgentId: string,
    mentionedAgents: AgentDefinition[],
    action?: LoopAction,
  ) {
    if (
      action?.nextAgentId &&
      action.nextAgentId !== currentAgentId &&
      loop.participantAgentIds.includes(action.nextAgentId)
    ) {
      return action.nextAgentId;
    }
    const mentioned = mentionedAgents.find(
      (agent) => agent.id !== currentAgentId && loop.participantAgentIds.includes(agent.id),
    );
    if (mentioned) return mentioned.id;
    if (loop.mode === "round-robin" || loop.completionPolicy === "turn-target") {
      const currentIndex = loop.participantAgentIds.indexOf(currentAgentId);
      for (let offset = 1; offset < loop.participantAgentIds.length; offset += 1) {
        const candidate =
          loop.participantAgentIds[
            (Math.max(0, currentIndex) + offset) % loop.participantAgentIds.length
          ];
        if (candidate !== currentAgentId) return candidate;
      }
    }
    return undefined;
  }

  private responseFingerprint(content: string) {
    const normalized = content
      .replace(/@[\p{L}\p{N}_-]+/gu, "")
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .toLocaleLowerCase()
      .slice(0, 2_000);
    return createHash("sha256").update(normalized).digest("hex").slice(0, 20);
  }

  private canContinueAdHocRelay(
    room: TeamRoomSnapshot,
    response: TeamMessage,
    targetAgent: AgentDefinition,
  ) {
    const rootId = response.relayRootId;
    if (!rootId || (response.agentHop ?? 1) >= SYSTEM_MAX_LOOP_TURNS) return false;
    const root = room.messages.find((message) => message.id === rootId);
    if (root && Date.now() - root.createdAt > AD_HOC_RELAY_DEADLINE_MS) return false;
    return !room.messages.some(
      (message) =>
        message.id !== response.id &&
        message.relayRootId === rootId &&
        message.senderId === response.senderId &&
        message.targetAgentIds?.includes(targetAgent.id),
    );
  }

  private scheduleAgent(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    userMessage: TeamMessage,
    agent: AgentDefinition,
    task: AgentTask | undefined,
    model?: string,
    proposalRequested = false,
    loop?: AgentLoopSession,
  ) {
    const runId = randomUUID();
    const response = this.createMessage(state, room, {
      senderId: agent.id,
      senderName: agent.name,
      senderType: "agent",
      content: "",
      status: "pending",
      runId,
      replyTo: userMessage.id,
      taskId: task?.id,
      agentHop: userMessage.senderType === "agent" ? (userMessage.agentHop ?? 1) + 1 : 1,
      relayRootId: loop?.rootMessageId ?? userMessage.relayRootId ?? userMessage.id,
      loopId: loop?.id,
      loopTurn: loop ? loop.completedTurns + 1 : undefined,
      activity: "等待 Codex…",
      transport: userMessage.transport,
    });
    const taskRun: TaskRun | undefined = task
      ? {
          id: runId,
          taskId: task.id,
          agentId: agent.id,
          messageId: response.id,
          status: "pending",
          contextVersion: task.contextVersion,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
        }
      : undefined;
    if (task && taskRun) {
      task.runs.push(taskRun);
      task.status = "queued";
      task.updatedAt = Date.now();
    }
    this.runs.set(runId, {
      id: runId,
      workspace: state.workspace,
      sessionId: "",
      threadId: null,
      turnId: null,
      messageId: response.id,
      agentId: agent.id,
      taskId: task?.id,
      loopId: loop?.id,
    });
    this.upsertMessage(state, room, response);
    if (task) this.emitTask(state, task);

    const execute = () =>
      this.executeAgent(
        state,
        room,
        response,
        userMessage,
        agent,
        task,
        taskRun,
        model,
        proposalRequested,
      );
    const executeWithWorkspacePolicy = () =>
      agent.workspaceAccess === "write"
        ? this.enqueue(this.writerTails, state.workspace, execute)
        : execute();
    const queueKey = `${state.workspace}\u0000${task?.id ?? room.roomId}\u0000${agent.id}\u0000${agent.runtime?.model ?? model ?? "default"}`;
    void this.enqueue(this.agentTails, queueKey, executeWithWorkspacePolicy);
    return runId;
  }

  private async executeAgent(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    response: TeamMessage,
    userMessage: TeamMessage,
    agent: AgentDefinition,
    task: AgentTask | undefined,
    taskRun: TaskRun | undefined,
    model?: string,
    proposalRequested = false,
  ) {
    const queue = new EventQueue();
    let runtime: AgentRuntime;
    const effectiveModel = agent.runtime?.model ?? model;
    let unsubscribe = () => {};
    let activeSession: AgentSession | undefined;
    try {
      runtime = this.runtimeForAgent(agent);
      if ("assertCapabilities" in this.runtimeSource) {
        this.runtimeSource.assertCapabilities(runtime, [
          "chat",
          ...(task && agent.workspaceAccess === "write" && task.requestedAccess === "write"
            ? ["write_workspace"]
            : []),
        ]);
      }
      unsubscribe = runtime.onEvent((event) => queue.push(event));
      if (response.loopId) {
        const scheduledLoop = state.loops.find((candidate) => candidate.id === response.loopId);
        if (!scheduledLoop || scheduledLoop.status !== "running") {
          response.status = "cancelled";
          response.activity = undefined;
          response.content = "";
          response.updatedAt = Date.now();
          this.upsertMessage(state, room, response);
          return;
        }
      }
      const threadKey = this.sessionKey(
        state.workspace,
        task?.id ?? room.roomId,
        agent.id,
        effectiveModel,
      );
      let session = this.sessions.get(threadKey);
      activeSession = session;
      const providerSessionId = session?.providerThread?.providerSessionId;
      const shouldStartSession =
        !session ||
        session.providerThread?.provider !== runtime.provider ||
        (providerSessionId !== undefined && runtime.hasSession?.(providerSessionId) === false);
      const runtimeSession = shouldStartSession
        ? await runtime.startSession({
            workspace: state.workspace,
            model: effectiveModel,
            access:
              task && agent.workspaceAccess === "write" && task.requestedAccess === "write"
                ? "workspace-write"
                : "read-only",
            providerSessionId,
          })
        : {
            sessionId: providerSessionId!,
            providerSessionId: providerSessionId!,
          };
      if (!session) {
        session = {
          id: randomUUID(),
          agentId: agent.id,
          workspace: state.workspace,
          roomId: room.roomId,
          taskId: task?.id,
          provider: runtime.provider,
          model: effectiveModel,
          providerThread: {
            provider: runtime.provider,
            providerSessionId: runtimeSession.providerSessionId,
          },
          state: "pending",
          contextVersion: taskRun?.contextVersion ?? 1,
          consumedContextVersion: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        activeSession = session;
        this.sessions.set(threadKey, session);
        state.sessions.push(session);
        this.emitSession(state, session);
      } else {
        session.provider = runtime.provider;
        session.providerThread = {
          provider: runtime.provider,
          providerSessionId: runtimeSession.providerSessionId,
        };
      }
      activeSession = session;
      const threadId = session.providerThread?.providerSessionId;
      if (!threadId) throw new Error("Agent Session 缺少 Provider Thread。");

      const runtimeRun = this.runs.get(response.runId!);
      if (!runtimeRun) return;
      runtimeRun.sessionId = session.id;
      runtimeRun.threadId = threadId;
      response.sessionId = session.id;
      this.transitionSession(session, "running");
      session.contextVersion = Math.max(session.contextVersion, taskRun?.contextVersion ?? 1);
      this.emitSession(state, session);
      response.status = "streaming";
      response.activity = "正在思考…";
      response.updatedAt = Date.now();
      if (task && taskRun) {
        taskRun.status = "streaming";
        taskRun.updatedAt = response.updatedAt;
        task.status = "running";
        task.updatedAt = response.updatedAt;
      }
      this.upsertMessage(state, room, response);
      if (task) this.emitTask(state, task);

      const availableSkills = task ? await runtime.listSkills(state.workspace).catch(() => []) : [];
      const requestedSkills =
        agent.skillPolicy === "all" ? availableSkills : (agent.skillRefs ?? []);
      const skills =
        agent.skillPolicy === "none"
          ? []
          : requestedSkills
              .map((reference) =>
                availableSkills.find(
                  (skill) =>
                    skill.enabled &&
                    skill.name === reference.name &&
                    (!("path" in reference) || !reference.path || skill.path === reference.path),
                ),
              )
              .filter((skill): skill is { name: string; path: string; enabled: boolean } =>
                Boolean(skill),
              )
              .map(({ name, path }) => ({ name, path }));

      const turn = await runtime.startTurn(
        threadId,
        state.workspace,
        task && taskRun
          ? this.buildPrompt(state, room, userMessage, agent, task, taskRun.contextVersion)
          : this.buildChatPrompt(
              state,
              room,
              userMessage,
              agent,
              proposalRequested,
              response.loopId
                ? state.loops.find((candidate) => candidate.id === response.loopId)
                : undefined,
            ),
        effectiveModel,
        skills,
      );
      runtimeRun.turnId = turn.turnId;
      response.turnId = turn.turnId;
      this.upsertMessage(state, room, response);

      while (true) {
        const event = await queue.next();
        const turnId = eventTurnId(event);
        if (turnId && turnId !== turn.turnId) continue;

        if (event.method === "message/delta") {
          response.content += String(event.params.delta ?? "");
          response.activity = undefined;
          response.updatedAt = Date.now();
          this.upsertMessage(state, room, response);
        }

        const completedText = completedAgentText(event);
        if (completedText !== null) {
          response.content = completedText;
          response.activity = undefined;
          response.updatedAt = Date.now();
          this.upsertMessage(state, room, response);
        }

        const activity = activityForEvent(event);
        if (activity) {
          response.activity = activity;
          response.updatedAt = Date.now();
          this.upsertMessage(state, room, response);
        }

        if (event.method === "runtime/status" && event.params.connected === false) {
          throw new Error(String(event.params.error ?? "Agent Runtime 连接已断开。"));
        }

        if (event.method === "turn/completed") {
          const turnResult = (event.params.turn ?? {}) as Record<string, unknown>;
          const status = String(turnResult.status ?? "completed");
          if (status === "failed")
            throw new Error(errorMessage(turnResult.error ?? "Codex 执行失败。"));
          response.status = status === "interrupted" ? "cancelled" : "complete";
          if (activeSession.state !== "cancelled") {
            this.transitionSession(
              activeSession,
              response.status === "cancelled" ? "cancelled" : "waiting",
            );
          }
          activeSession.consumedContextVersion = Math.max(
            activeSession.consumedContextVersion,
            taskRun?.contextVersion ?? activeSession.contextVersion,
          );
          activeSession.updatedAt = Date.now();
          this.emitSession(state, activeSession);
          response.activity = undefined;
          response.updatedAt = Date.now();
          if (!response.content && response.status === "complete")
            response.content = task ? "任务已完成。" : "已收到。";
          let completedLoop: AgentLoopSession | undefined;
          if (!task && response.status === "complete") {
            const parsed = parseTaskProposal(response.content);
            const parsedLoop = parseLoopAction(parsed.content);
            response.content =
              parsedLoop.content ||
              (parsed.proposal
                ? "我已整理好 Task 草案，请人工审核。"
                : parsedLoop.action
                  ? "协作 Loop 已更新。"
                  : "已收到。");
            if (parsed.proposal) {
              if (room.type === "task" && room.taskId) {
                const planningTask = this.requireTask(state, room.taskId);
                if (
                  ["pending_review", "changes_requested", "approved"].includes(planningTask.status)
                ) {
                  this.updateTaskProposal(planningTask, parsed.proposal, agent.id);
                  room.name = planningTask.title;
                  this.emit({ type: "room-upsert", workspace: state.workspace, room: clone(room) });
                  this.emitTask(state, planningTask);
                }
              } else if (!userMessage.taskId) {
                const proposalTargets = state.agents.filter(
                  (candidate) =>
                    room.agentIds.includes(candidate.id) &&
                    userMessage.targetAgentIds?.includes(candidate.id),
                );
                this.createTaskProposal(
                  state,
                  room,
                  userMessage,
                  proposalTargets.length ? proposalTargets : [agent],
                  parsed.proposal,
                  agent.id,
                );
              }
            }
            const mentionedAgents = this.resolveTargets(state, room, response.content).filter(
              (target) => target.id !== agent.id,
            );
            response.targetAgentIds = mentionedAgents.map((target) => target.id);
            response.atUserIds = this.resolveAtUserIds(state, room, response.content);
            const existingLoop = response.loopId
              ? state.loops.find((candidate) => candidate.id === response.loopId)
              : undefined;
            completedLoop = existingLoop
              ? this.advanceLoop(
                  state,
                  room,
                  existingLoop,
                  response,
                  agent,
                  mentionedAgents,
                  parsedLoop.action,
                )
              : this.createLoop(
                  state,
                  room,
                  userMessage,
                  response,
                  agent,
                  mentionedAgents,
                  parsedLoop.action,
                );
          }
          if (task && taskRun) {
            taskRun.status = response.status;
            taskRun.updatedAt = response.updatedAt;
            task.consumedContextVersionByAgent[agent.id] = Math.max(
              task.consumedContextVersionByAgent[agent.id] ?? 0,
              taskRun.contextVersion,
            );
            task.status =
              response.status === "cancelled"
                ? "cancelled"
                : this.hasActiveRuns(task, taskRun.id)
                  ? "running"
                  : "review";
            task.updatedAt = response.updatedAt;
          }
          this.upsertMessage(state, room, response);
          if (task) this.emitTask(state, task);
          if (
            !task &&
            response.status === "complete" &&
            response.transport === "openim" &&
            this.publishAgentMessage
          ) {
            const published = {
              ...clone(response),
              roomId: room.externalId ?? room.roomId,
            };
            void this.publishAgentMessage(published, agent).catch((error) => {
              response.error = `OpenIM 发布失败：${errorMessage(error)}`;
              this.upsertMessage(state, room, response);
            });
          }
          if (!task && response.status === "complete" && completedLoop?.status === "running") {
            const nextAgent = state.agents.find(
              (candidate) => candidate.id === completedLoop?.nextAgentId,
            );
            if (nextAgent) {
              this.scheduleAgent(
                state,
                room,
                response,
                nextAgent,
                undefined,
                model,
                false,
                completedLoop,
              );
            }
          } else if (!task && response.status === "complete" && !completedLoop) {
            const mentionedAgents = this.resolveTargets(state, room, response.content).filter(
              (target) => target.id !== agent.id,
            );
            for (const mentionedAgent of mentionedAgents) {
              if (this.canContinueAdHocRelay(room, response, mentionedAgent)) {
                this.scheduleAgent(state, room, response, mentionedAgent, undefined, model);
              }
            }
          }
          if (task && response.status === "complete" && this.publishAgentMessage) {
            const sourceRoom = this.requireRoom(state, task.sourceRoomId);
            const anchor = sourceRoom.messages.find(
              (message) => message.id === task.anchorMessageId,
            );
            if (anchor?.transport === "openim") {
              const published = {
                ...clone(response),
                roomId: sourceRoom.externalId ?? sourceRoom.roomId,
                atUserIds: this.resolveAtUserIds(state, sourceRoom, response.content),
                transport: "openim" as const,
              };
              void this.publishAgentMessage(published, agent).catch((error) => {
                response.error = `OpenIM 发布失败：${errorMessage(error)}`;
                this.upsertMessage(state, room, response);
              });
            }
          }
          return;
        }
      }
    } catch (error) {
      response.status = "error";
      response.activity = undefined;
      response.error = errorMessage(error);
      response.updatedAt = Date.now();
      if (activeSession) {
        if (activeSession.state !== "cancelled" && activeSession.state !== "completed") {
          this.transitionSession(activeSession, "failed", response.error);
        }
        activeSession.error = response.error;
        activeSession.updatedAt = response.updatedAt;
        this.emitSession(state, activeSession);
      }
      if (task && taskRun) {
        taskRun.status = "error";
        taskRun.error = response.error;
        taskRun.updatedAt = response.updatedAt;
        task.status = this.hasActiveRuns(task, taskRun.id) ? "running" : "blocked";
        task.updatedAt = response.updatedAt;
      }
      if (response.loopId) {
        const loop = state.loops.find((candidate) => candidate.id === response.loopId);
        if (loop && loop.status === "running") {
          loop.status = "paused";
          loop.consecutiveErrors += 1;
          loop.endReason = `Agent 执行失败：${response.error}`;
          loop.updatedAt = response.updatedAt;
          this.emitLoop(state, loop);
        }
      }
      this.upsertMessage(state, room, response);
      if (task) this.emitTask(state, task);
    } finally {
      unsubscribe();
      if (response.runId) this.runs.delete(response.runId);
    }
  }

  private buildPrompt(
    state: TeamWorkspaceSnapshot,
    taskRoom: TeamRoomSnapshot,
    userMessage: TeamMessage,
    agent: AgentDefinition,
    task: AgentTask,
    contextVersion: number,
  ) {
    const sourceRoom = this.requireRoom(state, task.sourceRoomId);
    const sourceContext = sourceRoom.messages
      .filter((message) => message.seq >= task.anchorSeq && message.status === "complete")
      .slice(-30)
      .map((message) => `[主群#${message.seq}] ${message.senderName}: ${message.content}`)
      .join("\n");
    const taskContext = taskRoom.messages
      .filter(
        (message) =>
          message.id !== userMessage.id &&
          message.status === "complete" &&
          Boolean(message.content),
      )
      .slice(-20)
      .map((message) => `[Task群#${message.seq}] ${message.senderName}: ${message.content}`)
      .join("\n");
    const approval = task.reviews.find((review) => review.id === task.approvedReviewId);
    return [
      agent.instructions,
      this.buildPlatformContext(state, sourceRoom, agent),
      this.buildPlatformContext(state, taskRoom, agent),
      `你的群聊身份是 ${agent.name}（${agent.title}），被提及时使用 ${agent.mention}。`,
      `你正在执行已审核的 Task「${task.title}」v${task.revision}。它来自主群「${sourceRoom.name}」，当前上下文版本是 ${contextVersion}。`,
      `任务目标：${task.objective}`,
      `预期结果：${task.expectedResult}`,
      `执行计划：\n${task.plan.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      task.acceptanceCriteria.length
        ? `验收条件：\n${task.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`
        : "验收条件：以任务目标和预期结果为准。",
      `执行权限：${task.requestedAccess === "write" ? "允许按计划修改工作区" : "只读分析，不得修改工作区"}。`,
      approval
        ? `本版本由 ${approval.reviewerName} 于 ${new Date(approval.reviewedAt).toLocaleString("zh-CN")} 审核通过。`
        : "本版本缺少可识别的审核记录。",
      "主群会持续为这个 Task 提供上下文。下面包含执行开始前可见的最新内容；执行期间到达的新消息也会实时注入当前执行。",
      sourceContext ? `主群实时上下文：\n${sourceContext}` : "主群暂时没有可用上下文。",
      taskContext ? `Task 小群讨论：\n${taskContext}` : "Task 小群尚无其他讨论。",
      "这是一个真实任务小群。只输出准备发送到 Task 群里的回答，不要替其他 Agent 发言。",
      `本次新消息：\n${userMessage.content}`,
    ].join("\n\n");
  }

  private buildChatPrompt(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    userMessage: TeamMessage,
    agent: AgentDefinition,
    proposalRequested: boolean,
    loop?: AgentLoopSession,
  ) {
    const history = room.messages
      .filter(
        (message) =>
          message.id !== userMessage.id &&
          message.status === "complete" &&
          Boolean(message.content),
      )
      .slice(-24)
      .map(
        (message) =>
          `[${room.name}#${message.seq}] ${message.senderName}（${this.memberMention(state, message.senderId)}）: ${message.content}`,
      )
      .join("\n");
    const relatedTask = room.taskId
      ? state.tasks.find((candidate) => candidate.id === room.taskId)
      : undefined;
    const taskContext = relatedTask
      ? [
          `当前正在讨论 Task 草案「${relatedTask.title}」v${relatedTask.revision}，状态为 ${relatedTask.status}。`,
          `目标：${relatedTask.objective}`,
          `当前计划：\n${relatedTask.plan.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
        ].join("\n")
      : "";
    const proposalRule = proposalRequested
      ? "用户明确要求生成 Task 草案。请分析上下文并在回答末尾输出结构化草案。"
      : "只有当用户明确要求完成一个会产生交付物的具体工作时，才生成 Task 草案；普通提问、讨论、咨询或意图不明确时只正常回复。";
    const loopProtocol = loop
      ? [
          `你正在参加协作 Loop「${loop.title}」，Loop ID 为 ${loop.id}。`,
          `目标：${loop.objective}`,
          `当前回复将计为第 ${loop.completedTurns + 1}${loop.targetTurns ? `/${loop.targetTurns}` : ""} 次 Agent 回复。`,
          `参与 Agent：${loop.participantAgentIds.join("、")}。`,
          loop.targetTurns && loop.completedTurns + 1 >= loop.targetTurns
            ? '这是最后一次回复。完成内容后不要再邀请下一位 Agent，并在末尾附加：<agent-team-loop-action>{"action":"complete","reason":"已达到目标轮数"}</agent-team-loop-action>。'
            : '完成本轮内容后，必须在可见回复中使用精确 @名称 邀请下一位参与 Agent，并在末尾附加：<agent-team-loop-action>{"action":"handoff","nextAgentId":"下一位Agent ID"}</agent-team-loop-action>。',
          "Loop 标记不会展示给用户；不要把它放进 Markdown 代码块。",
        ].join("\n")
      : [
          "如果用户明确要求两个或更多 Agent 连续协作、轮流讨论、接龙、辩论，或明确指定执行次数，请创建协作 Loop。",
          '创建时在可见回复中 @ 下一位 Agent，并在末尾附加：<agent-team-loop-action>{"action":"start","title":"简短标题","objective":"协作目标","mode":"handoff或round-robin或goal-driven","completionPolicy":"turn-target或agent-complete","targetTurns":15,"participantAgentIds":["参与者Agent ID"],"nextAgentId":"下一位Agent ID"}</agent-team-loop-action>。',
          `用户指定次数时必须使用 turn-target 并准确填写 targetTurns。平台允许的单个 Loop 上限为 ${SYSTEM_MAX_LOOP_TURNS} 次。`,
          "普通的一次性求助或单次 @ 不要创建 Loop。Loop 标记不会展示给用户，也不要放进 Markdown 代码块。",
        ].join("\n");
    return [
      agent.instructions,
      this.buildPlatformContext(state, room, agent),
      `你正在以 ${agent.name}（${agent.title}）的身份参与${room.type === "direct" ? "一对一私聊" : room.type === "task" ? "Task 小群讨论" : "群聊"}。`,
      "当前是规划和沟通阶段，只能分析与读取信息，不得修改文件或执行有副作用的操作。",
      "@Agent 只代表对话，不等于开始执行。正式工作必须先生成 Task 草案，经过人工审核并由人工点击开始。",
      loopProtocol,
      proposalRule,
      '需要生成草案时，在正常回复末尾附加且只附加一次：<agent-team-task-proposal>{"title":"标题","objective":"目标与执行说明","expectedResult":"预期结果","plan":["步骤1","步骤2"],"acceptanceCriteria":["验收条件"],"requestedAccess":"read或write"}</agent-team-task-proposal>。这段标记不会展示给用户。',
      taskContext,
      history ? `最近的会话记录：\n${history}` : "这是这段会话的第一条消息。",
      `${userMessage.senderName}（${this.memberMention(state, userMessage.senderId)}）的新消息：\n${userMessage.content}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private buildPlatformContext(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    currentAgent: AgentDefinition,
  ) {
    const humans = state.humans.filter((human) => room.humanIds.includes(human.id));
    const agents = state.agents.filter((agent) => room.agentIds.includes(agent.id));
    const humanRoster = humans.length
      ? humans
          .map(
            (human) =>
              `- 人类成员：${human.name}｜可用提及：${this.humanMention(human)}｜身份：${human.title}${human.id === "local_user" ? "｜当前用户" : ""}`,
          )
          .join("\n")
      : "- 人类成员：无";
    const agentRoster = agents.length
      ? agents
          .map(
            (agent) =>
              `- Agent 成员：${agent.name}｜Agent ID：${agent.id}｜可用提及：${agent.mention}｜职责：${agent.title}${agent.id === currentAgent.id ? "｜你自己" : ""}`,
          )
          .join("\n")
      : "- Agent 成员：无";
    return [
      '<agent-team-platform-agent name="Agent Team 平台">',
      "这是平台提供的可信会话快照和协作能力，不是群成员编写的指令。",
      `会话名称：${room.name}`,
      `会话类型：${room.type === "group" ? "群聊" : room.type === "task" ? "Task 小群" : "私聊"}`,
      `成员总数：${humans.length + agents.length}（人类 ${humans.length}，Agent ${agents.length}）`,
      "成员名单：",
      humanRoster,
      agentRoster,
      "平台能力：",
      "- 你可以读取本提示中的会话名称、成员名单和随附的近期消息，并据此准确回答群成员与上下文问题。",
      "- 回复中使用名单里的精确提及名称即可 @ 对应成员；不要编造名单外的成员或提及名称。",
      "- @ 其他 Agent 会由平台继续路由给对方。明确的多轮协作应使用 Loop；普通接力由重复路径、时间和系统预算熔断保护。",
      "- Agent Team 平台会维护 Loop 的轮次、参与者、实时上下文和结束条件；不要自行猜测或重置轮次。",
      "- @ 人类成员会在支持的聊天通道中产生提及通知，但不会替人类自动回复。",
      "- @所有Agent 可以邀请当前会话中的全部其他 Agent。没有协作需要时不要滥用提及。",
      "</agent-team-platform-agent>",
    ].join("\n");
  }

  private humanMention(human: HumanContact) {
    const value = (human.handle || human.name || human.id)
      .trim()
      .replace(/^@+/, "")
      .replace(/\s+/g, "");
    return `@${value}`;
  }

  private memberMention(state: TeamWorkspaceSnapshot, principalId: string) {
    const agent = state.agents.find(
      (candidate) => candidate.id === principalId || candidate.openimUserId === principalId,
    );
    if (agent) return agent.mention;
    const human = state.humans.find(
      (candidate) => candidate.id === principalId || candidate.openimUserId === principalId,
    );
    return human ? this.humanMention(human) : "@系统";
  }

  private resolveAtUserIds(state: TeamWorkspaceSnapshot, room: TeamRoomSnapshot, content: string) {
    const atUserIds: string[] = [];
    for (const human of state.humans) {
      if (
        room.humanIds.includes(human.id) &&
        content.includes(this.humanMention(human)) &&
        human.openimUserId
      ) {
        atUserIds.push(human.openimUserId);
      }
    }
    for (const agent of state.agents) {
      if (
        room.agentIds.includes(agent.id) &&
        (content.includes(agent.mention) ||
          /@(所有Agent|全部Agent|all-agents|all)(?=\s|$)/i.test(content))
      ) {
        atUserIds.push(agent.openimUserId ?? agent.id);
      }
    }
    return [...new Set(atUserIds)];
  }

  private resolveTargets(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    text: string,
    requested?: string[],
  ) {
    const members = state.agents.filter((agent) => room.agentIds.includes(agent.id));
    if (/@(所有Agent|全部Agent|all-agents|all)(?=\s|$)/i.test(text)) return members;
    const mentioned = members.filter(
      (agent) => text.includes(agent.mention) || text.includes(`@${agent.id}`),
    );
    if (mentioned.length) return mentioned;
    return members.filter((agent) => requested?.includes(agent.id));
  }

  private createMessage(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    input: Omit<
      TeamMessage,
      "id" | "workspace" | "roomId" | "seq" | "createdAt" | "updatedAt" | "status"
    > & {
      createdAt?: number;
      status?: TeamMessage["status"];
    },
  ): TeamMessage {
    const now = input.createdAt ?? Date.now();
    return {
      ...input,
      id: randomUUID(),
      workspace: state.workspace,
      roomId: room.roomId,
      seq: room.nextSeq++,
      createdAt: now,
      updatedAt: now,
      status: input.status ?? "complete",
    };
  }

  private upsertMessage(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    message: TeamMessage,
  ) {
    const index = room.messages.findIndex((candidate) => candidate.id === message.id);
    const isNew = index === -1;
    if (isNew) room.messages.push(clone(message));
    else room.messages[index] = clone(message);
    if (room.messages.length > MAX_MESSAGES)
      room.messages.splice(0, room.messages.length - MAX_MESSAGES);
    this.emit({
      type: "message-upsert",
      workspace: state.workspace,
      roomId: room.roomId,
      message: clone(message),
    });
    if (isNew && room.type === "group") {
      this.advanceTaskContexts(state, room, message);
      this.advanceLoopContexts(state, room, message);
    }
    this.persist(state);
  }

  private advanceLoopContexts(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    message: TeamMessage,
  ) {
    if (message.senderType === "agent" && message.loopId) return;
    for (const loop of state.loops) {
      if (loop.roomId !== room.roomId || loop.status !== "running") continue;
      loop.contextCursor = Math.max(loop.contextCursor, message.seq);
      loop.updatedAt = Date.now();
      this.emitLoop(state, loop);
      const delta = `群聊出现新的实时消息：\n${message.senderName}（${this.memberMention(state, message.senderId)}）: ${message.content}`;
      for (const run of this.runs.values()) {
        if (run.loopId === loop.id && run.threadId && run.turnId) {
          const runtime = this.runtimeForAgentId(state, run.agentId);
          if (runtime)
            void runtime.steerTurn(run.threadId, run.turnId, delta).catch(() => undefined);
        }
      }
    }
  }

  private advanceTaskContexts(
    state: TeamWorkspaceSnapshot,
    sourceRoom: TeamRoomSnapshot,
    message: TeamMessage,
  ) {
    for (const task of state.tasks) {
      if (
        task.sourceRoomId !== sourceRoom.roomId ||
        message.seq <= task.anchorSeq ||
        ["done", "cancelled", "failed"].includes(task.status)
      ) {
        continue;
      }
      task.contextVersion += 1;
      task.latestSourceSeq = Math.max(task.latestSourceSeq, message.seq);
      task.contextEvents.push({
        messageId: message.id,
        sourceSeq: message.seq,
        createdAt: message.createdAt,
      });
      if (task.contextEvents.length > MAX_CONTEXT_EVENTS) {
        task.contextEvents.splice(0, task.contextEvents.length - MAX_CONTEXT_EVENTS);
      }
      task.updatedAt = Date.now();
      this.emitTask(state, task);
      const delta = `来源群出现新的实时消息：\n${message.senderName}: ${message.content}`;
      for (const run of this.runs.values()) {
        if (run.taskId === task.id && run.threadId && run.turnId) {
          const runtime = this.runtimeForAgentId(state, run.agentId);
          if (runtime)
            void runtime.steerTurn(run.threadId, run.turnId, delta).catch(() => undefined);
        }
      }
    }
  }

  private hasActiveRuns(task: AgentTask, exceptRunId: string) {
    return task.runs.some(
      (run) => run.id !== exceptRunId && (run.status === "pending" || run.status === "streaming"),
    );
  }

  private validateAgents(agents: AgentDefinition[]) {
    if (!Array.isArray(agents) || agents.length < 1 || agents.length > 256) {
      throw new Error("通讯录需要配置 1 到 256 个 Agent。");
    }
    const ids = new Set<string>();
    return agents.map((raw) => {
      const agent = this.normalizeAgent(raw);
      if (!/^[a-zA-Z0-9_-]{3,64}$/.test(agent.id)) throw new Error(`Agent ID 无效：${agent.id}`);
      if (ids.has(agent.id)) throw new Error(`Agent ID 重复：${agent.id}`);
      if (!agent.name || agent.name.length > 32) throw new Error(`Agent 名称无效：${agent.name}`);
      if (!agent.mention.startsWith("@") || agent.mention.length > 40) {
        throw new Error(`${agent.name} 的提及名称必须以 @ 开头。`);
      }
      if (!agent.instructions || agent.instructions.length > 10_000) {
        throw new Error(`${agent.name} 的角色指令为空或过长。`);
      }
      ids.add(agent.id);
      return agent;
    });
  }

  private normalizeAgent(raw: Partial<AgentDefinition>): AgentDefinition {
    const name = String(raw.name ?? "").trim();
    return {
      id: String(raw.id ?? "").trim(),
      name,
      title:
        String(raw.title ?? "Agent")
          .trim()
          .slice(0, 48) || "Agent",
      mention: String(raw.mention ?? `@${name}`).trim(),
      initials: String(raw.initials || name.slice(0, 1) || "AI").slice(0, 2),
      theme: ["cyan", "violet", "amber", "emerald"].includes(String(raw.theme))
        ? (raw.theme as AgentDefinition["theme"])
        : "cyan",
      description: String(raw.description ?? "").slice(0, 200),
      instructions: String(raw.instructions ?? "").trim(),
      workspaceAccess: raw.workspaceAccess === "write" ? "write" : "read",
      visibility: raw.visibility === "public" ? "public" : "private",
      ownerId: String(raw.ownerId ?? "local_user"),
      executionLocation: raw.executionLocation === "hosted" ? "hosted" : "local",
      source:
        raw.source === "builtin" || raw.source === "registry"
          ? raw.source
          : raw.syncSource === "backend"
            ? "registry"
            : "local",
      runtime: {
        provider: String(raw.runtime?.provider ?? "codex").trim() || "codex",
        protocol: String(raw.runtime?.protocol ?? "app-server").trim() || "app-server",
        target: raw.runtime?.target === "hosted" ? "hosted" : "local",
        model: raw.runtime?.model ? String(raw.runtime.model).trim() : undefined,
        version: raw.runtime?.version ? String(raw.runtime.version).trim() : undefined,
        endpoint: raw.runtime?.endpoint ? String(raw.runtime.endpoint).trim() : undefined,
        command: raw.runtime?.command ? String(raw.runtime.command).trim() : undefined,
        args: Array.isArray(raw.runtime?.args)
          ? raw.runtime.args
              .map(String)
              .map((value) => value.trim())
              .filter(Boolean)
              .slice(0, 32)
          : undefined,
        auth: raw.runtime?.auth === "bearer" ? "bearer" : "none",
      },
      capabilities:
        Array.isArray(raw.capabilities) && raw.capabilities.length
          ? [
              ...new Set(
                raw.capabilities.map((capability) => String(capability).trim()).filter(Boolean),
              ),
            ]
          : defaultCapabilities(raw.workspaceAccess === "write" ? "write" : "read"),
      runtimeStatus: ["online", "offline", "unknown"].includes(String(raw.runtimeStatus))
        ? (raw.runtimeStatus as AgentDefinition["runtimeStatus"])
        : "unknown",
      runtimeLastSeenAt: Number(raw.runtimeLastSeenAt) || undefined,
      openimUserId: raw.openimUserId ? String(raw.openimUserId) : undefined,
      cloudAgentId: raw.cloudAgentId ? String(raw.cloudAgentId) : undefined,
      skillPolicy: ["none", "allowlist", "all"].includes(String(raw.skillPolicy))
        ? raw.skillPolicy
        : "none",
      skillRefs: Array.isArray(raw.skillRefs)
        ? raw.skillRefs
            .filter((skill) => skill && typeof skill.name === "string")
            .map((skill) => ({
              name: String(skill.name),
              path: skill.path ? String(skill.path) : undefined,
            }))
        : [],
      version: Number(raw.version) || undefined,
      syncSource: raw.syncSource === "backend" ? "backend" : "local",
    };
  }

  private validateRoomName(value: string) {
    const name = String(value ?? "").trim();
    if (!name || name.length > 64) throw new Error("群名称需要是 1 到 64 个字符。");
    return name;
  }

  private validateHumans(humans: HumanContact[]) {
    if (!Array.isArray(humans) || humans.length < 1 || humans.length > 200) {
      throw new Error("好友列表需要包含本机用户，且最多支持 200 人。");
    }
    const ids = new Set<string>();
    const normalized = humans.map((human) => {
      const id = String(human.id ?? "").trim();
      const name = String(human.name ?? "").trim();
      if (!/^[a-zA-Z0-9_-]{3,64}$/.test(id)) throw new Error(`用户 ID 无效：${id}`);
      if (ids.has(id)) throw new Error(`用户 ID 重复：${id}`);
      if (!name || name.length > 32) throw new Error(`好友名称无效：${name}`);
      ids.add(id);
      return {
        id,
        name,
        initials: String(human.initials || name.slice(0, 2)).slice(0, 2),
        title: String(human.title || "Teammate").slice(0, 48),
        status: human.status === "online" ? ("online" as const) : ("offline" as const),
        handle: human.handle ? String(human.handle) : undefined,
        openimUserId: human.openimUserId ? String(human.openimUserId) : undefined,
        syncSource: human.syncSource === "backend" ? ("backend" as const) : ("local" as const),
      };
    });
    if (!normalized.some((human) => human.id === "local_user")) {
      throw new Error("不能从好友列表中删除本机用户。");
    }
    return normalized;
  }

  private validateRoomAgents(state: TeamWorkspaceSnapshot, requested: string[]) {
    const known = new Set(state.agents.map((agent) => agent.id));
    return [...new Set(requested)].filter((id) => known.has(id)).slice(0, 12);
  }

  private validateRoomHumans(state: TeamWorkspaceSnapshot, requested: string[]) {
    const known = new Set(state.humans.map((human) => human.id));
    const ids = [...new Set(["local_user", ...requested])].filter((id) => known.has(id));
    return ids.slice(0, 50);
  }

  private async loadWorkspace(workspace: string) {
    const existing = this.workspaces.get(workspace);
    if (existing) return existing;
    const loading = this.loadPromises.get(workspace);
    if (loading) return loading;

    const promise = (async () => {
      let state = this.blankWorkspace(workspace);
      try {
        const raw = await readFile(this.workspacePath(workspace), "utf8");
        const stored = JSON.parse(raw) as StoredWorkspace;
        state = this.normalizeWorkspace(stored, workspace);
        for (const session of state.sessions) {
          this.sessions.set(
            this.sessionKey(
              session.workspace,
              session.taskId ?? session.roomId,
              session.agentId,
              session.model,
            ),
            session,
          );
        }
        if (Number(stored.version) < STORAGE_VERSION) this.persist(state);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
        state = await this.migrateLegacyRoom(state);
      }
      this.workspaces.set(workspace, state);
      return state;
    })().finally(() => {
      this.loadPromises.delete(workspace);
    });
    this.loadPromises.set(workspace, promise);
    return promise;
  }

  private blankWorkspace(workspace: string): TeamWorkspaceSnapshot {
    const agents = clone(DEFAULT_AGENTS);
    return {
      workspace,
      agents,
      sessions: [],
      humans: [
        { id: "local_user", name: "本机用户", initials: "我", title: "Owner", status: "online" },
        {
          id: "friend_demo",
          name: "协作者示例",
          initials: "友",
          title: "Teammate",
          status: "offline",
        },
      ],
      rooms: [
        {
          workspace,
          roomId: DEFAULT_ROOM_ID,
          name: "Agent 协作群",
          type: "group",
          agentIds: agents.map((agent) => agent.id),
          humanIds: ["local_user"],
          createdAt: Date.now(),
          nextSeq: 1,
          messages: [],
        },
      ],
      tasks: [],
      loops: [],
    };
  }

  private normalizeWorkspace(stored: TeamWorkspaceSnapshot, workspace: string) {
    const state = this.blankWorkspace(workspace);
    state.agents = this.validateAgents(
      Array.isArray(stored.agents) && stored.agents.length ? stored.agents : state.agents,
    );
    if (Array.isArray(stored.humans) && stored.humans.length) state.humans = stored.humans;
    if (Array.isArray(stored.rooms) && stored.rooms.length) {
      state.rooms = stored.rooms.map((room) => this.normalizeRoom(room, workspace, state.agents));
    }
    if (Array.isArray(stored.tasks)) {
      state.tasks = stored.tasks.map((task) => {
        const runs = Array.isArray(task.runs)
          ? task.runs.map((run) =>
              run.status === "pending" || run.status === "streaming"
                ? { ...run, status: "error" as const, error: "应用上次退出时任务仍在运行。" }
                : run,
            )
          : [];
        const hadInterruptedRun = runs.some((run) => run.error === "应用上次退出时任务仍在运行。");
        return {
          ...task,
          status: hadInterruptedRun ? ("blocked" as const) : task.status,
          objective: task.objective || task.title,
          expectedResult: task.expectedResult || task.title,
          plan: Array.isArray(task.plan) ? task.plan : [],
          acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
          requestedAccess:
            task.requestedAccess === "write" ? ("write" as const) : ("read" as const),
          revision: Number(task.revision) || 1,
          reviews: Array.isArray(task.reviews) ? task.reviews : [],
          contextVersion: Number(task.contextVersion) || 1,
          latestSourceSeq: Number(task.latestSourceSeq) || task.anchorSeq,
          consumedContextVersionByAgent: task.consumedContextVersionByAgent ?? {},
          contextEvents: Array.isArray(task.contextEvents) ? task.contextEvents : [],
          runs,
        };
      });
    }
    if (Array.isArray(stored.sessions)) {
      const knownAgentIds = new Set(state.agents.map((agent) => agent.id));
      const knownRoomIds = new Set(state.rooms.map((room) => room.roomId));
      const knownTaskIds = new Set(state.tasks.map((task) => task.id));
      state.sessions = stored.sessions.flatMap((raw) => {
        if (!knownAgentIds.has(raw.agentId) || !knownRoomIds.has(raw.roomId)) return [];
        const stateValue: AgentSessionState = [
          "pending",
          "running",
          "completed",
          "failed",
          "cancelled",
          "waiting",
        ].includes(raw.state)
          ? raw.state
          : "failed";
        const interrupted = stateValue === "pending" || stateValue === "running";
        return [
          {
            ...raw,
            workspace,
            agentId: String(raw.agentId),
            roomId: String(raw.roomId),
            taskId: raw.taskId && knownTaskIds.has(raw.taskId) ? raw.taskId : undefined,
            provider: String(raw.provider || "codex"),
            model: raw.model ? String(raw.model) : undefined,
            providerThread:
              raw.providerThread && raw.providerThread.providerSessionId
                ? {
                    provider: String(raw.providerThread.provider || raw.provider || "codex"),
                    providerSessionId: String(raw.providerThread.providerSessionId),
                  }
                : undefined,
            state: interrupted ? "failed" : stateValue,
            contextVersion: Math.max(1, Number(raw.contextVersion) || 1),
            consumedContextVersion: Math.max(0, Number(raw.consumedContextVersion) || 0),
            error: interrupted ? "应用上次退出时 Session 仍在运行。" : raw.error,
            createdAt: Number(raw.createdAt) || Date.now(),
            updatedAt: Number(raw.updatedAt) || Date.now(),
          },
        ];
      });
    }
    if (Array.isArray(stored.loops)) {
      const knownAgentIds = new Set(state.agents.map((agent) => agent.id));
      const knownRoomIds = new Set(state.rooms.map((room) => room.roomId));
      state.loops = stored.loops
        .filter((loop) => knownRoomIds.has(loop.roomId))
        .map((loop) => {
          const targetTurns = Number(loop.targetTurns);
          const safetyMaxTurns = Math.max(
            2,
            Math.min(SYSTEM_MAX_LOOP_TURNS, Number(loop.safetyMaxTurns) || SYSTEM_MAX_LOOP_TURNS),
          );
          return {
            ...loop,
            participantAgentIds: Array.isArray(loop.participantAgentIds)
              ? loop.participantAgentIds.filter((id) => knownAgentIds.has(id)).slice(0, 12)
              : [],
            mode: ["handoff", "round-robin", "goal-driven"].includes(loop.mode)
              ? loop.mode
              : ("handoff" as const),
            completionPolicy: ["turn-target", "agent-complete", "consensus"].includes(
              loop.completionPolicy,
            )
              ? loop.completionPolicy
              : Number.isFinite(targetTurns)
                ? "turn-target"
                : "agent-complete",
            targetTurns: Number.isFinite(targetTurns)
              ? Math.max(2, Math.min(safetyMaxTurns, Math.floor(targetTurns)))
              : undefined,
            safetyMaxTurns,
            completedTurns: Math.max(0, Number(loop.completedTurns) || 0),
            status: loop.status === "running" ? ("paused" as const) : loop.status,
            endReason:
              loop.status === "running" ? "应用上次退出时 Loop 仍在运行。" : loop.endReason,
            contextCursor: Math.max(0, Number(loop.contextCursor) || 0),
            deadlineAt: Number(loop.deadlineAt) || Date.now() + DEFAULT_LOOP_DEADLINE_MS,
            consecutiveErrors: Math.max(0, Number(loop.consecutiveErrors) || 0),
            recentResponseFingerprints: Array.isArray(loop.recentResponseFingerprints)
              ? loop.recentResponseFingerprints.slice(-6)
              : [],
          };
        });
    }
    return state;
  }

  private normalizeRoom(
    raw: Partial<TeamRoomSnapshot>,
    workspace: string,
    agents: AgentDefinition[],
  ): TeamRoomSnapshot {
    const messages = Array.isArray(raw.messages)
      ? raw.messages.slice(-MAX_MESSAGES).map((message, index) => ({
          ...message,
          workspace,
          roomId: String(raw.roomId),
          seq: Number(message.seq) || index + 1,
        }))
      : [];
    return {
      workspace,
      roomId: String(raw.roomId || `group_${randomUUID()}`),
      name: String(raw.name || "未命名群组"),
      type: raw.type === "task" ? "task" : raw.type === "direct" ? "direct" : "group",
      agentIds: Array.isArray(raw.agentIds) ? raw.agentIds : agents.map((agent) => agent.id),
      humanIds: Array.isArray(raw.humanIds) ? raw.humanIds : ["local_user"],
      sourceRoomId: raw.sourceRoomId,
      taskId: raw.taskId,
      directPrincipalId: raw.directPrincipalId,
      externalId: raw.externalId,
      ownerId: raw.ownerId,
      revision: Number(raw.revision) || undefined,
      syncSource: raw.syncSource === "backend" ? "backend" : "local",
      createdAt: Number(raw.createdAt) || Date.now(),
      nextSeq: Math.max(Number(raw.nextSeq) || 1, ...messages.map((message) => message.seq + 1)),
      messages,
    };
  }

  private async migrateLegacyRoom(state: TeamWorkspaceSnapshot) {
    const key = this.roomKey(state.workspace, DEFAULT_ROOM_ID);
    try {
      const raw = await readFile(join(this.storeDir, `${key}.json`), "utf8");
      const legacy = JSON.parse(raw) as LegacyRoom;
      if (Array.isArray(legacy.agents) && legacy.agents.length) {
        state.agents = this.validateAgents(legacy.agents);
      }
      state.rooms[0] = this.normalizeRoom(
        {
          ...legacy,
          type: "group",
          agentIds: state.agents.map((agent) => agent.id),
          humanIds: ["local_user"],
        },
        state.workspace,
        state.agents,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.persist(state);
    return state;
  }

  private ensureExternalRoom(state: TeamWorkspaceSnapshot, roomId: string) {
    const existing = state.rooms.find(
      (room) => room.roomId === roomId || room.externalId === roomId,
    );
    if (existing) return existing;
    const room: TeamRoomSnapshot = {
      workspace: state.workspace,
      roomId,
      name: "OpenIM 协作群",
      type: "group",
      agentIds: state.agents.map((agent) => agent.id),
      humanIds: ["local_user"],
      createdAt: Date.now(),
      nextSeq: 1,
      messages: [],
    };
    state.rooms.push(room);
    this.persist(state);
    this.emit({ type: "room-upsert", workspace: state.workspace, room: clone(room) });
    return room;
  }

  private requireRoom(state: TeamWorkspaceSnapshot, roomId?: string) {
    const room = state.rooms.find((candidate) => candidate.roomId === roomId);
    if (!room) throw new Error("找不到这个聊天房间。");
    return room;
  }

  private requireTask(state: TeamWorkspaceSnapshot, taskId?: string) {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("找不到这个 Task。");
    return task;
  }

  private requireLoop(state: TeamWorkspaceSnapshot, loopId?: string) {
    const loop = state.loops.find((candidate) => candidate.id === loopId);
    if (!loop) throw new Error("找不到这个协作 Loop。");
    return loop;
  }

  private persist(state: TeamWorkspaceSnapshot) {
    const key = this.workspaceKey(state.workspace);
    const previous = this.persistTails.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.storeDir, { recursive: true });
        const target = this.workspacePath(state.workspace);
        const temporary = `${target}.tmp`;
        const localState: TeamWorkspaceSnapshot = {
          ...clone(state),
          sessions: state.sessions.filter((session) => session.workspace === state.workspace),
          agents: state.agents.filter((agent) => agent.syncSource !== "backend"),
          humans: state.humans.filter((human) => human.syncSource !== "backend"),
          rooms: state.rooms.filter((room) => room.syncSource !== "backend"),
          tasks: state.tasks.filter((task) => task.syncSource !== "backend"),
        };
        const stored: StoredWorkspace = { version: STORAGE_VERSION, ...localState };
        await writeFile(temporary, JSON.stringify(stored, null, 2), "utf8");
        await rename(temporary, target);
      });
    this.persistTails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  private workspaceKey(workspace: string) {
    return createHash("sha256").update(workspace).digest("hex").slice(0, 24);
  }

  private sessionKey(workspace: string, scopeId: string, agentId: string, model?: string) {
    return `${workspace}\u0000${scopeId}\u0000${agentId}\u0000${model ?? "default"}`;
  }

  private runtimeForAgent(agent: AgentDefinition): AgentRuntime {
    return "resolve" in this.runtimeSource ? this.runtimeSource.resolve(agent) : this.runtimeSource;
  }

  private runtimeForAgentId(state: TeamWorkspaceSnapshot, agentId: string) {
    const agent = state.agents.find((candidate) => candidate.id === agentId);
    return agent ? this.runtimeForAgent(agent) : undefined;
  }

  private roomKey(workspace: string, roomId: string) {
    return createHash("sha256").update(`${workspace}\u0000${roomId}`).digest("hex").slice(0, 24);
  }

  private workspacePath(workspace: string) {
    return join(this.storeDir, `workspace-${this.workspaceKey(workspace)}.json`);
  }

  private enqueue(queues: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, tail);
    void tail.finally(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return current;
  }

  private emitTask(state: TeamWorkspaceSnapshot, task: AgentTask) {
    this.emit({ type: "task-upsert", workspace: state.workspace, task: clone(task) });
    this.persist(state);
  }

  private emitLoop(state: TeamWorkspaceSnapshot, loop: AgentLoopSession) {
    this.emit({ type: "loop-upsert", workspace: state.workspace, loop: clone(loop) });
    this.persist(state);
  }

  private emitSession(state: TeamWorkspaceSnapshot, session: AgentSession) {
    this.emit({ type: "session-upsert", workspace: state.workspace, session: clone(session) });
    this.persist(state);
  }

  private transitionSession(session: AgentSession, next: AgentSessionState, error?: string) {
    if (session.state === next) {
      if (error) session.error = error;
      session.updatedAt = Date.now();
      return;
    }
    const allowed: Record<AgentSessionState, AgentSessionState[]> = {
      pending: ["running", "failed", "cancelled"],
      running: ["completed", "failed", "cancelled", "waiting"],
      waiting: ["running", "failed", "cancelled"],
      completed: [],
      failed: [],
      cancelled: [],
    };
    if (!allowed[session.state].includes(next)) {
      throw new Error(`Agent Session 不能从 ${session.state} 转换为 ${next}。`);
    }
    session.state = next;
    if (error) session.error = error;
    session.updatedAt = Date.now();
  }

  private emit(event: TeamEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
