export type AgentTheme = "cyan" | "violet" | "amber" | "emerald";
export type AgentVisibility = "private" | "public";
export type AgentExecutionLocation = "local" | "hosted";

export type AgentDefinition = {
  id: string;
  name: string;
  title: string;
  mention: string;
  initials: string;
  theme: AgentTheme;
  description: string;
  instructions: string;
  workspaceAccess: "read" | "write";
  visibility: AgentVisibility;
  ownerId: string;
  executionLocation: AgentExecutionLocation;
  openimUserId?: string;
  cloudAgentId?: string;
  skillPolicy?: "none" | "allowlist" | "all";
  skillRefs?: Array<{ name: string; path?: string }>;
  version?: number;
  syncSource?: "local" | "backend";
};

export type HumanContact = {
  id: string;
  name: string;
  initials: string;
  title: string;
  status: "online" | "offline";
  handle?: string;
  openimUserId?: string;
  syncSource?: "local" | "backend";
};

export type TeamMessageStatus = "pending" | "streaming" | "complete" | "error" | "cancelled";
export type AgentMessageAction = "chat" | "propose-task";
export type AgentLoopStatus = "running" | "paused" | "completed" | "cancelled" | "failed";
export type AgentLoopMode = "handoff" | "round-robin" | "goal-driven";
export type AgentLoopCompletionPolicy = "turn-target" | "agent-complete" | "consensus";

export type TeamMessage = {
  id: string;
  externalId?: string;
  workspace: string;
  roomId: string;
  seq: number;
  senderId: string;
  senderName: string;
  senderType: "user" | "agent" | "system";
  content: string;
  createdAt: number;
  updatedAt: number;
  status: TeamMessageStatus;
  runId?: string;
  threadId?: string;
  turnId?: string;
  replyTo?: string;
  targetAgentIds?: string[];
  atUserIds?: string[];
  agentHop?: number;
  relayRootId?: string;
  loopId?: string;
  loopTurn?: number;
  agentAction?: AgentMessageAction;
  taskId?: string;
  activity?: string;
  error?: string;
  transport: "local" | "openim";
};

export type TeamRoomType = "group" | "task" | "direct";

export type TeamRoomSnapshot = {
  workspace: string;
  roomId: string;
  name: string;
  type: TeamRoomType;
  agentIds: string[];
  humanIds: string[];
  sourceRoomId?: string;
  taskId?: string;
  directPrincipalId?: string;
  externalId?: string;
  ownerId?: string;
  revision?: number;
  syncSource?: "local" | "backend";
  createdAt: number;
  nextSeq: number;
  messages: TeamMessage[];
};

export type TaskStatus =
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "queued"
  | "running"
  | "waiting"
  | "review"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type TaskContextEvent = {
  messageId: string;
  sourceSeq: number;
  createdAt: number;
};

export type TaskRun = {
  id: string;
  taskId: string;
  agentId: string;
  messageId: string;
  status: TeamMessageStatus;
  contextVersion: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  threadId?: string;
  executionCwd?: string;
  timeline?: RunTimelineEvent[];
};

export type RunTimelineEvent = {
  id: string;
  at: number;
  type: "started" | "reasoning" | "command" | "file" | "mcp" | "approval" | "complete" | "error";
  title: string;
  detail?: string;
};

export type TaskWorktree = {
  path: string;
  branch: string;
  baseRef: string;
  createdAt: number;
};

export type TaskReviewDecision = "approved" | "changes_requested" | "rejected";

export type TaskReview = {
  id: string;
  taskId: string;
  taskRevision: number;
  reviewerUserId: string;
  reviewerName: string;
  decision: TaskReviewDecision;
  comment?: string;
  reviewedAt: number;
};

export type AgentTask = {
  id: string;
  title: string;
  objective: string;
  expectedResult: string;
  plan: string[];
  acceptanceCriteria: string[];
  requestedAccess: "read" | "write";
  creatorId: string;
  requestedByUserId?: string;
  proposedByAgentId?: string;
  sourceRoomId: string;
  anchorMessageId: string;
  anchorSeq: number;
  taskRoomId: string;
  assigneeIds: string[];
  status: TaskStatus;
  revision: number;
  reviews: TaskReview[];
  approvedReviewId?: string;
  startedByUserId?: string;
  startedAt?: number;
  contextVersion: number;
  latestSourceSeq: number;
  consumedContextVersionByAgent: Record<string, number>;
  contextEvents: TaskContextEvent[];
  runs: TaskRun[];
  worktree?: TaskWorktree;
  createdAt: number;
  updatedAt: number;
  syncSource?: "local" | "backend";
};

export type AgentLoopSession = {
  id: string;
  roomId: string;
  rootMessageId: string;
  lastMessageId: string;
  title: string;
  objective: string;
  participantAgentIds: string[];
  mode: AgentLoopMode;
  completionPolicy: AgentLoopCompletionPolicy;
  targetTurns?: number;
  safetyMaxTurns: number;
  completedTurns: number;
  currentAgentId?: string;
  nextAgentId?: string;
  status: AgentLoopStatus;
  endReason?: string;
  contextCursor: number;
  deadlineAt: number;
  consecutiveErrors: number;
  recentResponseFingerprints: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type TeamWorkspaceSnapshot = {
  workspace: string;
  agents: AgentDefinition[];
  humans: HumanContact[];
  rooms: TeamRoomSnapshot[];
  tasks: AgentTask[];
  loops: AgentLoopSession[];
};

export type TeamEvent =
  | { type: "workspace-snapshot"; snapshot: TeamWorkspaceSnapshot }
  | { type: "message-upsert"; workspace: string; roomId: string; message: TeamMessage }
  | { type: "room-upsert"; workspace: string; room: TeamRoomSnapshot }
  | { type: "task-upsert"; workspace: string; task: AgentTask }
  | { type: "loop-upsert"; workspace: string; loop: AgentLoopSession }
  | { type: "agents-upsert"; workspace: string; agents: AgentDefinition[] }
  | { type: "humans-upsert"; workspace: string; humans: HumanContact[] };

export type ExternalTeamMessage = {
  externalId: string;
  roomId: string;
  conversationType?: "group" | "direct";
  principalId?: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
  runId?: string;
  agentHop?: number;
  relayRootId?: string;
  loopId?: string;
  loopTurn?: number;
  agentAction?: AgentMessageAction;
};

export type AgentTeamApi = {
  getWorkspace: (options: { workspace: string }) => Promise<TeamWorkspaceSnapshot>;
  sendMessage: (options: {
    workspace: string;
    roomId?: string;
    text: string;
    model?: string;
    targetAgentIds?: string[];
    agentAction?: AgentMessageAction;
    transport?: "local" | "openim";
    externalId?: string;
  }) => Promise<{ messageId: string; runIds: string[]; taskId?: string; taskRoomId?: string }>;
  ingestExternalMessage: (options: {
    workspace: string;
    message: ExternalTeamMessage;
    model?: string;
    targetAgentIds?: string[];
    triggerAgents?: boolean;
    agentAction?: AgentMessageAction;
  }) => Promise<{
    messageId: string;
    runIds: string[];
    duplicate: boolean;
    taskId?: string;
    taskRoomId?: string;
  }>;
  stopRun: (options: { runId: string }) => Promise<void>;
  promoteAgents: (options: {
    workspace: string;
    mappings: Array<{
      localAgentId: string;
      cloudAgentId: string;
      openimUserId: string;
      version: number;
    }>;
  }) => Promise<TeamWorkspaceSnapshot>;
  controlLoop: (options: {
    workspace: string;
    loopId: string;
    action: "pause" | "resume" | "cancel";
    model?: string;
  }) => Promise<AgentLoopSession>;
  saveAgents: (options: {
    workspace: string;
    agents: AgentDefinition[];
  }) => Promise<TeamWorkspaceSnapshot>;
  saveHumans: (options: {
    workspace: string;
    humans: HumanContact[];
  }) => Promise<TeamWorkspaceSnapshot>;
  createRoom: (options: {
    workspace: string;
    name: string;
    agentIds: string[];
    humanIds: string[];
  }) => Promise<TeamRoomSnapshot>;
  updateRoom: (options: {
    workspace: string;
    roomId: string;
    name: string;
    agentIds: string[];
    humanIds: string[];
  }) => Promise<TeamRoomSnapshot>;
  openDirectRoom: (options: {
    workspace: string;
    principalId: string;
  }) => Promise<TeamRoomSnapshot>;
  updateTaskStatus: (options: {
    workspace: string;
    taskId: string;
    status: TaskStatus;
  }) => Promise<AgentTask>;
  reviewTask: (options: {
    workspace: string;
    taskId: string;
    decision: TaskReviewDecision;
    comment?: string;
  }) => Promise<AgentTask>;
  startTask: (options: { workspace: string; taskId: string; model?: string }) => Promise<AgentTask>;
  onEvent: (listener: (event: TeamEvent) => void) => () => void;
};

export type ImPublicConfig = {
  apiAddr: string;
  wsAddr: string;
  userId: string;
  groupId: string;
  gatewayUrl: string;
  hostRemoteMessages: boolean;
  hasUserToken: boolean;
  hasGatewaySecret: boolean;
};

export type ImConfigInput = {
  apiAddr: string;
  wsAddr: string;
  userId: string;
  groupId: string;
  gatewayUrl: string;
  hostRemoteMessages: boolean;
  userToken?: string;
  gatewaySecret?: string;
};

export type ImRuntimeConfig = ImPublicConfig & {
  userToken: string;
  dataDir: string;
  platformId: number;
};

export type ImDesktopApi = {
  getConfig: () => Promise<ImPublicConfig>;
  getRuntimeConfig: () => Promise<ImRuntimeConfig>;
  saveConfig: (config: ImConfigInput) => Promise<ImPublicConfig>;
};
