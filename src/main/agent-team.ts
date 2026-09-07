import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentDefinition,
  AgentTask,
  ExternalTeamMessage,
  HumanContact,
  TaskRun,
  TaskStatus,
  TeamEvent,
  TeamMessage,
  TeamRoomSnapshot,
  TeamWorkspaceSnapshot,
} from "../shared/agent-team";
import type { CodexEvent } from "../shared/codex";
import { CodexAppServer } from "./codex-app-server";

type RuntimeRun = {
  id: string;
  threadId: string | null;
  turnId: string | null;
  messageId: string;
  taskId?: string;
};

type StoredWorkspace = TeamWorkspaceSnapshot & { version: 2 };
type LegacyRoom = Partial<TeamRoomSnapshot> & {
  workspace: string;
  roomId: string;
  name: string;
  agents?: AgentDefinition[];
  messages?: TeamMessage[];
};
type AgentMessagePublisher = (message: TeamMessage, agent: AgentDefinition) => Promise<void>;

class EventQueue {
  private values: CodexEvent[] = [];
  private waiters: Array<(value: CodexEvent) => void> = [];

  push(value: CodexEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next() {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    return new Promise<CodexEvent>((resolve) => this.waiters.push(resolve));
  }
}

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
    instructions:
      "你是多 Agent 群聊里的代码审查员。以发现真实缺陷为优先，检查正确性、安全性、并发、边界条件和测试缺口。可以读取项目，但不要修改文件。结论按严重程度排列，并引用具体文件。",
  },
];

const DEFAULT_ROOM_ID = "local-agent-team";
const MAX_MESSAGES = 300;
const MAX_CONTEXT_EVENTS = 1_000;
const clone = <T>(value: T): T => structuredClone(value);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const eventTurnId = (event: CodexEvent) => {
  if (typeof event.params.turnId === "string") return event.params.turnId;
  const turn = event.params.turn as Record<string, unknown> | undefined;
  return typeof turn?.id === "string" ? turn.id : null;
};

const completedAgentText = (event: CodexEvent) => {
  if (event.method !== "item/completed") return null;
  const item = event.params.item as Record<string, unknown> | undefined;
  return item?.type === "agentMessage" && typeof item.text === "string" ? item.text : null;
};

const activityForEvent = (event: CodexEvent) => {
  if (event.method !== "item/started") return null;
  const item = event.params.item as Record<string, unknown> | undefined;
  if (item?.type === "commandExecution") return "正在运行命令…";
  if (item?.type === "fileChange") return "正在修改文件…";
  if (item?.type === "mcpToolCall") return "正在调用工具…";
  return null;
};

export class AgentTeamService {
  private workspaces = new Map<string, TeamWorkspaceSnapshot>();
  private loadPromises = new Map<string, Promise<TeamWorkspaceSnapshot>>();
  private listeners = new Set<(event: TeamEvent) => void>();
  private threads = new Map<string, string>();
  private runs = new Map<string, RuntimeRun>();
  private writerTails = new Map<string, Promise<void>>();
  private agentTails = new Map<string, Promise<void>>();
  private persistTails = new Map<string, Promise<void>>();

  constructor(
    private readonly codex: CodexAppServer,
    private readonly storeDir: string,
    private readonly publishAgentMessage?: AgentMessagePublisher,
  ) {}

  onEvent(listener: (event: TeamEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    state.agents = this.validateAgents([...localAgents, ...remote.agents]);
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
      transport: options.transport ?? "local",
    });
    this.upsertMessage(state, room, message);
    return this.routeUserMessage(state, room, message, targets, options.model);
  }

  async ingestExternalMessage(options: {
    workspace: string;
    message: ExternalTeamMessage;
    model?: string;
    targetAgentIds?: string[];
    triggerAgents?: boolean;
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
          const routed = this.routeUserMessage(state, room, existing, targets, options.model);
          return { ...routed, duplicate: true };
        }
      }
      return { messageId: existing.id, runIds: [], duplicate: true };
    }

    const agent = state.agents.find((candidate) => candidate.id === options.message.senderId);
    if (!agent && !state.humans.some((human) => human.id === options.message.senderId)) {
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
      senderId: options.message.senderId,
      senderName: options.message.senderName,
      senderType: agent ? "agent" : "user",
      content: options.message.content,
      createdAt: options.message.createdAt,
      runId: options.message.runId,
      transport: "openim",
    });
    this.upsertMessage(state, room, message);

    if (!options.triggerAgents || agent) {
      return { messageId: message.id, runIds: [], duplicate: false };
    }
    const targets = this.resolveTargets(state, room, message.content, options.targetAgentIds);
    message.targetAgentIds = targets.map((target) => target.id);
    this.upsertMessage(state, room, message);
    const routed = this.routeUserMessage(state, room, message, targets, options.model);
    return { ...routed, duplicate: false };
  }

  async stopRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run?.threadId || !run.turnId) throw new Error("这个 Agent 当前没有可停止的任务。");
    await this.codex.interruptTurn(run.threadId, run.turnId);
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
    room.name = this.validateRoomName(name);
    room.agentIds = this.validateRoomAgents(state, agentIds);
    room.humanIds = this.validateRoomHumans(state, humanIds);
    if (room.taskId) {
      const task = this.requireTask(state, room.taskId);
      task.assigneeIds = [...room.agentIds];
      task.updatedAt = Date.now();
      this.emitTask(state, task);
    }
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
      "queued",
      "running",
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

  private routeUserMessage(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    message: TeamMessage,
    targets: AgentDefinition[],
    model?: string,
  ) {
    if (!targets.length) return { messageId: message.id, runIds: [] };

    if (room.type === "direct") {
      const runIds = targets.map((agent) =>
        this.scheduleAgent(state, room, message, agent, undefined, model),
      );
      return { messageId: message.id, runIds };
    }

    let task: AgentTask;
    let taskRoom: TeamRoomSnapshot;
    if (room.type === "group") {
      ({ task, taskRoom } = this.createTask(state, room, message, targets));
    } else {
      task = this.requireTask(state, room.taskId);
      taskRoom = room;
      if (["done", "failed", "cancelled"].includes(task.status)) task.status = "queued";
      task.updatedAt = Date.now();
      this.emitTask(state, task);
    }

    const runIds = targets.map((agent) =>
      this.scheduleAgent(state, taskRoom, message, agent, task, model),
    );
    return {
      messageId: message.id,
      runIds,
      taskId: task.id,
      taskRoomId: taskRoom.roomId,
    };
  }

  private createTask(
    state: TeamWorkspaceSnapshot,
    sourceRoom: TeamRoomSnapshot,
    anchor: TeamMessage,
    targets: AgentDefinition[],
  ) {
    const now = Date.now();
    const taskId = `task_${randomUUID()}`;
    const taskRoomId = `task_room_${randomUUID()}`;
    const task: AgentTask = {
      id: taskId,
      title: this.taskTitle(anchor.content, targets),
      creatorId: anchor.senderId,
      sourceRoomId: sourceRoom.roomId,
      anchorMessageId: anchor.id,
      anchorSeq: anchor.seq,
      taskRoomId,
      assigneeIds: targets.map((agent) => agent.id),
      status: "queued",
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

  private scheduleAgent(
    state: TeamWorkspaceSnapshot,
    room: TeamRoomSnapshot,
    userMessage: TeamMessage,
    agent: AgentDefinition,
    task: AgentTask | undefined,
    model?: string,
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
      activity: "等待 Codex…",
      transport: "local",
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
      threadId: null,
      turnId: null,
      messageId: response.id,
      taskId: task?.id,
    });
    this.upsertMessage(state, room, response);
    if (task) this.emitTask(state, task);

    const execute = () =>
      this.executeAgent(state, room, response, userMessage, agent, task, taskRun, model);
    const executeWithWorkspacePolicy = () =>
      agent.workspaceAccess === "write"
        ? this.enqueue(this.writerTails, state.workspace, execute)
        : execute();
    const queueKey = `${state.workspace}\u0000${task?.id ?? room.roomId}\u0000${agent.id}\u0000${model ?? "default"}`;
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
  ) {
    const queue = new EventQueue();
    const unsubscribe = this.codex.onEvent((event) => queue.push(event));
    try {
      const threadKey = `${state.workspace}\u0000${task?.id ?? room.roomId}\u0000${agent.id}\u0000${model ?? "default"}`;
      let threadId = this.threads.get(threadKey);
      if (!threadId) {
        const thread = await this.codex.startThread(
          state.workspace,
          model,
          agent.workspaceAccess === "write" ? "workspace-write" : "read-only",
        );
        threadId = thread.threadId;
        this.threads.set(threadKey, threadId);
      }

      const runtimeRun = this.runs.get(response.runId!);
      if (!runtimeRun) return;
      runtimeRun.threadId = threadId;
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

      const availableSkills = this.codex.listSkills
        ? await this.codex.listSkills(state.workspace).catch(() => [])
        : [];
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

      const turn = await this.codex.startTurn(
        threadId,
        state.workspace,
        task && taskRun
          ? this.buildPrompt(state, room, userMessage, agent, task, taskRun.contextVersion)
          : this.buildDirectPrompt(room, userMessage, agent),
        model,
        skills,
      );
      runtimeRun.turnId = turn.turnId;
      response.turnId = turn.turnId;
      this.upsertMessage(state, room, response);

      while (true) {
        const event = await queue.next();
        const turnId = eventTurnId(event);
        if (turnId && turnId !== turn.turnId) continue;

        if (event.method === "item/agentMessage/delta") {
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

        if (event.method === "desktop/status/changed" && event.params.connected === false) {
          throw new Error(String(event.params.error ?? "Codex App Server 连接已断开。"));
        }

        if (event.method === "turn/completed") {
          const turnResult = (event.params.turn ?? {}) as Record<string, unknown>;
          const status = String(turnResult.status ?? "completed");
          if (status === "failed")
            throw new Error(errorMessage(turnResult.error ?? "Codex 执行失败。"));
          response.status = status === "interrupted" ? "cancelled" : "complete";
          response.activity = undefined;
          response.updatedAt = Date.now();
          if (!response.content && response.status === "complete")
            response.content = "任务已完成。";
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
          if (task && response.status === "complete" && this.publishAgentMessage) {
            const sourceRoom = this.requireRoom(state, task.sourceRoomId);
            const anchor = sourceRoom.messages.find(
              (message) => message.id === task.anchorMessageId,
            );
            if (anchor?.transport === "openim") {
              const published = {
                ...clone(response),
                roomId: sourceRoom.roomId,
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
      if (task && taskRun) {
        taskRun.status = "error";
        taskRun.error = response.error;
        taskRun.updatedAt = response.updatedAt;
        task.status = this.hasActiveRuns(task, taskRun.id) ? "running" : "blocked";
        task.updatedAt = response.updatedAt;
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
    return [
      agent.instructions,
      `你的群聊身份是 ${agent.name}（${agent.title}），被提及时使用 ${agent.mention}。`,
      `你正在处理 Task「${task.title}」。它来自主群「${sourceRoom.name}」，当前上下文版本是 ${contextVersion}。`,
      "主群会持续为这个 Task 提供上下文。下面包含本次执行开始前可见的最新主群内容；执行期间到达的新内容会在下一次 Task 对话中注入。",
      sourceContext ? `主群实时上下文：\n${sourceContext}` : "主群暂时没有可用上下文。",
      taskContext ? `Task 小群讨论：\n${taskContext}` : "Task 小群尚无其他讨论。",
      "这是一个真实任务小群。只输出准备发送到 Task 群里的回答，不要替其他 Agent 发言。",
      `本次新消息：\n${userMessage.content}`,
    ].join("\n\n");
  }

  private buildDirectPrompt(
    room: TeamRoomSnapshot,
    userMessage: TeamMessage,
    agent: AgentDefinition,
  ) {
    const history = room.messages
      .filter(
        (message) =>
          message.id !== userMessage.id &&
          message.status === "complete" &&
          Boolean(message.content),
      )
      .slice(-24)
      .map((message) => `${message.senderName}: ${message.content}`)
      .join("\n");
    return [
      agent.instructions,
      `你正在以 ${agent.name}（${agent.title}）的身份和用户进行一对一私聊。`,
      "这是持续的私聊会话，不是新的群聊 Task。只输出准备发送给用户的回答，不要添加虚构事件。",
      history ? `最近的私聊记录：\n${history}` : "这是这段私聊的第一条消息。",
      `用户的新消息：\n${userMessage.content}`,
    ].join("\n\n");
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
    if (isNew && room.type === "group") this.advanceTaskContexts(state, room, message);
    this.persist(state);
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
        ["done", "cancelled"].includes(task.status)
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
    }
  }

  private taskTitle(text: string, agents: AgentDefinition[]) {
    let title = text;
    for (const agent of agents)
      title = title.replaceAll(agent.mention, "").replaceAll(`@${agent.id}`, "");
    title = title.replace(/@(所有Agent|全部Agent|all-agents|all)(?=\s|$)/gi, "").trim();
    return title.slice(0, 72) || `交给 ${agents.map((agent) => agent.name).join("、")} 的任务`;
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
      openimUserId: raw.openimUserId ? String(raw.openimUserId) : undefined,
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
        state = this.normalizeWorkspace(JSON.parse(raw) as StoredWorkspace, workspace);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
        state = await this.migrateLegacyRoom(state);
      }
      this.workspaces.set(workspace, state);
      this.loadPromises.delete(workspace);
      return state;
    })();
    this.loadPromises.set(workspace, promise);
    return promise;
  }

  private blankWorkspace(workspace: string): TeamWorkspaceSnapshot {
    const agents = clone(DEFAULT_AGENTS);
    return {
      workspace,
      agents,
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
          contextVersion: Number(task.contextVersion) || 1,
          latestSourceSeq: Number(task.latestSourceSeq) || task.anchorSeq,
          consumedContextVersionByAgent: task.consumedContextVersionByAgent ?? {},
          contextEvents: Array.isArray(task.contextEvents) ? task.contextEvents : [],
          runs,
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
          agents: state.agents.filter((agent) => agent.syncSource !== "backend"),
          humans: state.humans.filter((human) => human.syncSource !== "backend"),
          rooms: state.rooms.filter((room) => room.syncSource !== "backend"),
          tasks: state.tasks.filter((task) => task.syncSource !== "backend"),
        };
        const stored: StoredWorkspace = { version: 2, ...localState };
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

  private emit(event: TeamEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
