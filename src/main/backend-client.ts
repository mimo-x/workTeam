import { app, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  BackendLoginInput,
  BackendRegisterInput,
  BackendRequestInput,
  BackendState,
  BackendUser,
} from "../shared/backend";
import type {
  AgentCapability,
  AgentDefinition,
  AgentTask,
  HumanContact,
  ImRuntimeConfig,
  TaskRun,
  TeamMessage,
  TeamRoomSnapshot,
  TeamWorkspaceSnapshot,
} from "../shared/agent-team";
import { formatErrorMessage } from "../shared/error";

type StoredBackendConfig = {
  apiUrl: string;
  encryptedRefreshToken?: string;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user?: BackendUser;
};

type CloudFriend = {
  id: string;
  handle: string;
  displayName: string;
  openimUserId: string;
  online: boolean;
};

type CloudAgent = {
  id: string;
  ownerId: string;
  ownerName?: string;
  openimUserId: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  instructions?: string;
  visibility: "private" | "public";
  workspaceAccess?: "read" | "write";
  executionTarget: "local" | "hosted";
  provider?: string;
  protocol?: string;
  runtimeModel?: string | null;
  runtimeEndpoint?: string | null;
  runtimeCommand?: string | null;
  runtimeArgs?: string[];
  runtimeAuth?: "bearer" | "none";
  secrets?: Record<string, string>;
  capabilities?: AgentCapability[];
  runtimeStatus?: "online" | "offline" | "unknown";
  runtimeLastSeenAt?: string | null;
  skillPolicy?: "none" | "allowlist" | "all";
  skillRefs?: Array<{ name: string; path?: string }>;
  version: number;
};

type CloudRoomMember = {
  id: string;
  handle: string;
  displayName: string;
  openimUserId: string;
};

type CloudRoom = {
  id: string;
  ownerId: string;
  openimGroupId: string | null;
  type: "direct" | "group" | "task";
  name: string;
  sourceRoomId: string | null;
  directAgentId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  members: CloudRoomMember[];
  agents: Array<{ id: string }>;
};

type CloudMessage = {
  serverMsgId: string;
  clientMsgId: string;
  senderOpenimId: string;
  senderUserId: string | null;
  senderAgentId: string | null;
  content: string;
  seq: number | string;
  targetAgentIds?: string[];
  sentAt: string;
};

type CloudTask = {
  id: string;
  title: string;
  objective: string;
  expectedResult: string;
  plan: string[];
  acceptanceCriteria: string[];
  requestedAccess: "read" | "write";
  creatorId: string;
  requestedByUserId?: string | null;
  proposedByAgentId?: string | null;
  sourceRoomId: string;
  taskRoomId: string;
  anchorMessageId: string;
  status: AgentTask["status"];
  revision: number;
  approvedReviewId?: string | null;
  startedByUserId?: string | null;
  startedAt?: string | null;
  contextVersion: number;
  latestSourceSeq: number | string;
  createdAt: string;
  updatedAt: string;
  assignees: Array<{ id: string }>;
  runs: Array<{
    id: string;
    agentId: string;
    status: string;
    contextVersion: number;
    outputMessageId?: string | null;
    error?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  contextEvents: Array<{
    messageId: string;
    sourceSeq: number | string;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    taskId: string;
    taskRevision: number;
    reviewerUserId: string;
    reviewerName: string;
    decision: "approved" | "changes_requested" | "rejected";
    comment?: string;
    reviewedAt: string;
  }>;
};

const themes: AgentDefinition["theme"][] = ["cyan", "violet", "amber", "emerald"];
const themeFor = (value: string) =>
  themes[
    [...value].reduce((total, character) => total + character.charCodeAt(0), 0) % themes.length
  ];
const timestamp = (value: string | number | Date | undefined) => {
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const cleanApiUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("聊天后台地址无效。");
  }
  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";
  if (url.protocol !== "https:" && !isLocal && !isDev) {
    throw new Error("生产环境中远程聊天后台必须使用 HTTPS；开发环境或本机地址可以使用 HTTP。");
  }
  return trimmed;
};

export class BackendClient {
  private stored: StoredBackendConfig | null = null;
  private accessToken = "";
  private volatileRefreshToken = "";
  private user: BackendUser | null = null;
  private error: string | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly imDataDir: string,
    private readonly onAgentCredential?: (agentId: string, token: string) => void,
  ) {}

  async getState(): Promise<BackendState> {
    const stored = await this.read();
    return {
      apiUrl: stored.apiUrl,
      authenticated: Boolean(this.accessToken && this.user),
      hasRefreshToken: Boolean(this.refreshToken()),
      user: this.user,
      error: this.error,
    };
  }

  async configure(apiUrl: string) {
    const stored = await this.read();
    const cleaned = cleanApiUrl(apiUrl);
    if (cleaned !== stored.apiUrl) {
      this.accessToken = "";
      this.user = null;
      this.error = null;
      this.volatileRefreshToken = "";
      this.stored = { apiUrl: cleaned };
    } else {
      this.stored = { ...stored, apiUrl: cleaned };
    }
    await this.persist();
    return this.getState();
  }

  async register(input: BackendRegisterInput) {
    await this.configure(input.apiUrl);
    const result = await this.rawRequest<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: {
        email: input.email,
        password: input.password,
        handle: input.handle,
        displayName: input.displayName,
        deviceName: input.deviceName ?? "Codex Desktop",
      },
    });
    await this.acceptAuth(result);
    return this.getState();
  }

  async login(input: BackendLoginInput) {
    await this.configure(input.apiUrl);
    const result = await this.rawRequest<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: {
        email: input.email,
        password: input.password,
        deviceName: input.deviceName ?? "Codex Desktop",
      },
    });
    await this.acceptAuth(result);
    return this.getState();
  }

  async logout() {
    if (this.accessToken) {
      await this.request({ method: "POST", path: "/v1/auth/logout" }).catch(() => undefined);
    }
    this.accessToken = "";
    this.volatileRefreshToken = "";
    this.user = null;
    const stored = await this.read();
    delete stored.encryptedRefreshToken;
    await this.persist();
    return this.getState();
  }

  async request<T>(input: BackendRequestInput): Promise<T> {
    if (!input.path.startsWith("/v1/") || input.path.includes("..")) {
      throw new Error("不允许访问这个后台路径。");
    }
    await this.ensureAccessToken();
    try {
      return await this.rawRequest<T>(input.path, {
        method: input.method ?? "GET",
        body: input.body,
        headers: { ...input.headers, authorization: `Bearer ${this.accessToken}` },
      });
    } catch (error) {
      if (!(error instanceof BackendHttpError) || error.statusCode !== 401) throw error;
      this.accessToken = "";
      await this.refresh();
      return this.rawRequest<T>(input.path, {
        method: input.method ?? "GET",
        body: input.body,
        headers: { ...input.headers, authorization: `Bearer ${this.accessToken}` },
      });
    }
  }

  async getImRuntimeConfig(): Promise<ImRuntimeConfig> {
    await mkdir(this.imDataDir, { recursive: true });
    const session = await this.request<{
      apiAddr: string;
      wsAddr: string;
      userId: string;
      token: string;
    }>({ method: "POST", path: "/v1/im/session", body: {} });
    return {
      apiAddr: session.apiAddr,
      wsAddr: session.wsAddr,
      userId: session.userId,
      userToken: session.token,
      groupId: "",
      gatewayUrl: "",
      hostRemoteMessages: true,
      hasUserToken: true,
      hasGatewaySecret: false,
      dataDir: this.imDataDir,
      platformId: process.platform === "darwin" ? 4 : process.platform === "win32" ? 3 : 7,
    };
  }

  async importWorkspace(snapshot: TeamWorkspaceSnapshot) {
    return this.request<{
      imported: { agents: number; rooms: number; messages: number; tasks: number };
      warnings: string[];
    }>({
      method: "POST",
      path: "/v1/imports/local-workspace",
      headers: { "idempotency-key": `workspace-import:${createImportKey(snapshot)}` },
      body: snapshot,
    });
  }

  async syncWorkspace(workspace: string): Promise<TeamWorkspaceSnapshot> {
    const me = await this.request<{ user: BackendUser }>({ path: "/v1/me" });
    this.user = me.user;
    const [friendsResponse, agentsResponse, roomsResponse, tasksResponse] = await Promise.all([
      this.request<{ data: CloudFriend[] }>({ path: "/v1/friends" }),
      this.request<{ data: CloudAgent[] }>({ path: "/v1/agents?scope=available&limit=100" }),
      this.request<{ data: CloudRoom[] }>({ path: "/v1/rooms" }),
      this.request<{ data: Array<Omit<CloudTask, "assignees" | "runs" | "contextEvents">> }>({
        path: "/v1/tasks?limit=200",
      }),
    ]);
    const [messageResponses, taskDetails] = await Promise.all([
      Promise.all(
        roomsResponse.data.map((room) =>
          this.request<{ data: CloudMessage[] }>({
            path: `/v1/rooms/${encodeURIComponent(room.id)}/messages?limit=200`,
          }),
        ),
      ),
      Promise.all(
        tasksResponse.data.map((task) =>
          this.request<CloudTask>({ path: `/v1/tasks/${encodeURIComponent(task.id)}` }),
        ),
      ),
    ]);

    const mapUserId = (id: string) => (id === me.user.id ? "local_user" : id);
    const humans: HumanContact[] = [
      {
        id: "local_user",
        name: me.user.displayName,
        initials: me.user.displayName.slice(0, 2) || "我",
        title: `@${me.user.handle}`,
        status: "online",
        handle: me.user.handle,
        openimUserId: me.user.openimUserId,
        syncSource: "backend",
      },
      ...friendsResponse.data.map((friend) => ({
        id: friend.id,
        name: friend.displayName,
        initials: friend.displayName.slice(0, 2) || "友",
        title: `@${friend.handle}`,
        status: friend.online ? ("online" as const) : ("offline" as const),
        handle: friend.handle,
        openimUserId: friend.openimUserId,
        syncSource: "backend" as const,
      })),
    ];
    const agents: AgentDefinition[] = agentsResponse.data.map((agent) => ({
      id: agent.id,
      name: agent.name,
      title: agent.title,
      mention: agent.mention,
      initials: agent.name.slice(0, 2) || "AI",
      theme: themeFor(agent.id),
      description: agent.description,
      instructions:
        agent.instructions ??
        `你是 ${agent.name}（${agent.title}）。这是其他用户公开的 Agent，请根据群聊中的任务提供帮助。`,
      workspaceAccess: agent.workspaceAccess === "write" ? "write" : "read",
      visibility: agent.visibility,
      ownerId: agent.ownerId === me.user.id ? "local_user" : agent.ownerId,
      executionLocation: agent.executionTarget,
      source: "registry",
      runtime: {
        provider: agent.provider ?? "codex",
        protocol: agent.protocol ?? "app-server",
        target: agent.executionTarget,
        model: agent.runtimeModel ?? undefined,
        endpoint: agent.runtimeEndpoint ?? undefined,
        command: agent.runtimeCommand ?? undefined,
        args: agent.runtimeArgs ?? undefined,
        auth: agent.runtimeAuth ?? "none",
      },
      capabilities: agent.capabilities ?? ["chat", "stream_progress", "read_workspace"],
      runtimeStatus: agent.runtimeStatus ?? "unknown",
      runtimeLastSeenAt: agent.runtimeLastSeenAt ? timestamp(agent.runtimeLastSeenAt) : undefined,
      openimUserId: agent.openimUserId,
      skillPolicy: agent.skillPolicy ?? "none",
      skillRefs: agent.skillRefs ?? [],
      version: agent.version,
      syncSource: "backend",
    }));
    for (const agent of agentsResponse.data) {
      const token = agent.secrets?.bearerToken ?? agent.secrets?.token;
      if (token && agent.ownerId === me.user.id) this.onAgentCredential?.(agent.id, token);
    }
    const humanById = new Map(humans.map((human) => [human.id, human]));
    const humanByOpenim = new Map(
      humans.flatMap((human) => (human.openimUserId ? [[human.openimUserId, human] as const] : [])),
    );
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const agentByOpenim = new Map(
      agents.flatMap((agent) => (agent.openimUserId ? [[agent.openimUserId, agent] as const] : [])),
    );
    const taskByRoomId = new Map(taskDetails.map((task) => [task.taskRoomId, task.id]));
    const messagesByRoomId = new Map<string, TeamMessage[]>();
    roomsResponse.data.forEach((room, index) => {
      const messages = messageResponses[index].data.map((message, messageIndex): TeamMessage => {
        const senderId = message.senderAgentId ?? mapUserId(message.senderUserId ?? "");
        const senderAgent = agentById.get(senderId) ?? agentByOpenim.get(message.senderOpenimId);
        const senderHuman = humanById.get(senderId) ?? humanByOpenim.get(message.senderOpenimId);
        const sentAt = timestamp(message.sentAt);
        return {
          id: message.serverMsgId,
          externalId: message.serverMsgId,
          workspace,
          roomId: room.id,
          seq: Number(message.seq) || messageIndex + 1,
          senderId: senderAgent?.id ?? senderHuman?.id ?? message.senderOpenimId,
          senderName: senderAgent?.name ?? senderHuman?.name ?? message.senderOpenimId,
          senderType: senderAgent ? "agent" : "user",
          content: message.content,
          createdAt: sentAt,
          updatedAt: sentAt,
          status: "complete",
          targetAgentIds: message.targetAgentIds ?? [],
          transport: "openim",
        };
      });
      messagesByRoomId.set(room.id, messages);
    });
    const rooms: TeamRoomSnapshot[] = roomsResponse.data.map((room) => {
      const members = room.members.map((member) => mapUserId(member.id));
      const directPeer =
        room.type === "direct"
          ? room.members.find((member) => member.id !== me.user.id)
          : undefined;
      const directAgent = room.directAgentId ? agentById.get(room.directAgentId) : undefined;
      const messages = messagesByRoomId.get(room.id) ?? [];
      return {
        workspace,
        roomId: room.id,
        name: directPeer?.displayName ?? directAgent?.name ?? room.name,
        type: room.type,
        agentIds: [
          ...new Set([
            ...room.agents.map((agent) => agent.id),
            ...(room.directAgentId ? [room.directAgentId] : []),
          ]),
        ],
        humanIds: members.includes("local_user") ? members : ["local_user", ...members],
        sourceRoomId: room.sourceRoomId ?? undefined,
        taskId: taskByRoomId.get(room.id),
        directPrincipalId: directPeer?.id ?? room.directAgentId,
        externalId: room.openimGroupId ?? undefined,
        ownerId: mapUserId(room.ownerId),
        revision: room.revision,
        syncSource: "backend",
        createdAt: timestamp(room.createdAt),
        nextSeq: Math.max(1, ...messages.map((message) => message.seq + 1)),
        messages,
      };
    });
    const tasks: AgentTask[] = taskDetails.map((task) => {
      const anchor = task.contextEvents.find((event) => event.messageId === task.anchorMessageId);
      const runs: TaskRun[] = task.runs.map((run) => ({
        id: run.id,
        taskId: task.id,
        agentId: run.agentId,
        messageId: run.outputMessageId ?? task.anchorMessageId,
        status:
          run.status === "running"
            ? "streaming"
            : run.status === "complete"
              ? "complete"
              : run.status === "failed"
                ? "error"
                : "pending",
        contextVersion: run.contextVersion,
        createdAt: timestamp(run.createdAt),
        updatedAt: timestamp(run.updatedAt),
        error: run.error ?? undefined,
      }));
      return {
        id: task.id,
        title: task.title,
        objective: task.objective || task.title,
        expectedResult: task.expectedResult || task.title,
        plan: Array.isArray(task.plan) ? task.plan : [],
        acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
        requestedAccess: task.requestedAccess === "write" ? "write" : "read",
        creatorId: mapUserId(task.creatorId),
        requestedByUserId: task.requestedByUserId ? mapUserId(task.requestedByUserId) : undefined,
        proposedByAgentId: task.proposedByAgentId ?? undefined,
        sourceRoomId: task.sourceRoomId,
        anchorMessageId: task.anchorMessageId,
        anchorSeq: Number(anchor?.sourceSeq) || 1,
        taskRoomId: task.taskRoomId,
        assigneeIds: task.assignees.map((agent) => agent.id),
        status: task.status,
        revision: Number(task.revision) || 1,
        reviews: (task.reviews ?? []).map((review) => ({
          ...review,
          reviewerUserId: mapUserId(review.reviewerUserId),
          reviewedAt: timestamp(review.reviewedAt),
        })),
        approvedReviewId: task.approvedReviewId ?? undefined,
        startedByUserId: task.startedByUserId ? mapUserId(task.startedByUserId) : undefined,
        startedAt: task.startedAt ? timestamp(task.startedAt) : undefined,
        contextVersion: Number(task.contextVersion) || 1,
        latestSourceSeq: Number(task.latestSourceSeq) || Number(anchor?.sourceSeq) || 1,
        consumedContextVersionByAgent: Object.fromEntries(
          runs
            .filter((run) => run.status === "complete")
            .map((run) => [run.agentId, run.contextVersion]),
        ),
        contextEvents: task.contextEvents.map((event) => ({
          messageId: event.messageId,
          sourceSeq: Number(event.sourceSeq) || 1,
          createdAt: timestamp(event.createdAt),
        })),
        runs,
        createdAt: timestamp(task.createdAt),
        updatedAt: timestamp(task.updatedAt),
        syncSource: "backend",
      };
    });
    return { workspace, agents, sessions: [], humans, rooms, tasks, loops: [] };
  }

  async createRealtimeConnectionInfo() {
    const result = await this.request<{ ticket: string; url: string; expiresIn: number }>({
      method: "POST",
      path: "/v1/realtime/ticket",
      body: { deviceName: "Codex Desktop" },
    });
    const stored = await this.read();
    const base = new URL(stored.apiUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = result.url;
    base.search = new URLSearchParams({ ticket: result.ticket }).toString();
    return { url: base.toString(), expiresIn: result.expiresIn };
  }

  private async ensureAccessToken() {
    if (this.accessToken) return;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  private async refresh() {
    const refreshToken = this.refreshToken();
    if (!refreshToken) throw new Error("请先登录聊天后台。");
    try {
      const result = await this.rawRequest<AuthResponse>("/v1/auth/refresh", {
        method: "POST",
        body: { token: refreshToken },
      });
      await this.acceptAuth(result);
      const me = await this.rawRequest<{ user: BackendUser }>("/v1/me", {
        headers: { authorization: `Bearer ${this.accessToken}` },
      });
      this.user = me.user;
      this.error = null;
    } catch (error) {
      this.error = formatErrorMessage(error);
      if (error instanceof BackendHttpError && error.code === "INVALID_REFRESH_TOKEN") {
        const stored = await this.read();
        delete stored.encryptedRefreshToken;
        this.volatileRefreshToken = "";
        this.accessToken = "";
        this.user = null;
        await this.persist();
      }
      throw error;
    }
  }

  private async acceptAuth(result: AuthResponse) {
    this.accessToken = result.accessToken;
    if (result.user) this.user = result.user;
    this.error = null;
    this.saveRefreshToken(result.refreshToken);
    await this.persist();
  }

  private async rawRequest<T>(
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const stored = await this.read();
    if (!stored.apiUrl) throw new Error("请先配置聊天后台地址。");
    const response = await fetch(`${stored.apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      throw new BackendHttpError(
        response.status,
        body.error?.code ?? "BACKEND_ERROR",
        body.error?.message ?? `聊天后台返回 HTTP ${response.status}`,
      );
    }
    return body;
  }

  private saveRefreshToken(value: string) {
    if (!value) return;
    if (safeStorage.isEncryptionAvailable()) {
      this.stored = {
        ...(this.stored ?? { apiUrl: "" }),
        encryptedRefreshToken: safeStorage.encryptString(value).toString("base64"),
      };
      this.volatileRefreshToken = "";
    } else {
      this.volatileRefreshToken = value;
    }
  }

  private refreshToken() {
    if (this.volatileRefreshToken) return this.volatileRefreshToken;
    const encrypted = this.stored?.encryptedRefreshToken;
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return "";
    }
  }

  private async read() {
    if (this.stored) return this.stored;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as StoredBackendConfig;
      this.stored = {
        apiUrl: parsed.apiUrl ? cleanApiUrl(parsed.apiUrl) : "",
        encryptedRefreshToken: parsed.encryptedRefreshToken,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.stored = { apiUrl: process.env.AGENT_TEAM_API_URL ?? "" };
    }
    return this.stored;
  }

  private async persist() {
    if (!this.stored) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.stored, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

class BackendHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const createImportKey = (snapshot: TeamWorkspaceSnapshot) => {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
};

export const backendConfigPath = (userDataPath: string) =>
  join(userDataPath, "chat-backend-config.json");
