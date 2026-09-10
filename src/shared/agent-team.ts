export type AgentTheme = "cyan" | "violet" | "amber" | "emerald";
export type AgentVisibility = "private" | "public";
export type AgentExecutionLocation = "local" | "hosted";
export type AgentSource = "builtin" | "local" | "registry";
export type AgentCapability =
  | "chat"
  | "stream_progress"
  | "read_workspace"
  | "write_workspace"
  | "run_command"
  | "review_code"
  | (string & {});

export type AgentRuntimeBinding = {
  provider: string;
  protocol: string;
  target: AgentExecutionLocation;
  model?: string;
  version?: string;
  endpoint?: string;
  command?: string;
  args?: string[];
  auth?: "bearer" | "none";
};

export type AgentPermissionProfile = {
  workspaceAccess: "read" | "write";
  requiresApproval: boolean;
};

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
  source?: AgentSource;
  runtime?: AgentRuntimeBinding;
  capabilities?: AgentCapability[];
  runtimeStatus?: "online" | "offline" | "unknown";
  runtimeLastSeenAt?: number;
  openimUserId?: string;
  cloudAgentId?: string;
  skillPolicy?: "none" | "allowlist" | "all";
  skillRefs?: Array<{ name: string; path?: string }>;
  version?: number;
  syncSource?: "local" | "backend";
};

export type AgentManifest = {
  protocolVersion: 1;
  agentId: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  ownerId: string;
  visibility: AgentVisibility;
  source: AgentSource;
  capabilities: AgentCapability[];
  permissions: AgentPermissionProfile;
  runtime: AgentRuntimeBinding;
  version: number;
};

export const AGENT_MANIFEST_PROTOCOL_VERSION = 1 as const;

export const agentManifestFromDefinition = (agent: AgentDefinition): AgentManifest => {
  const workspaceAccess = agent.workspaceAccess === "write" ? "write" : "read";
  const capabilities = agent.capabilities?.length
    ? [...new Set(agent.capabilities)]
    : [
        "chat",
        "stream_progress",
        "read_workspace",
        ...(workspaceAccess === "write" ? ["write_workspace", "run_command"] : []),
      ];
  return {
    protocolVersion: AGENT_MANIFEST_PROTOCOL_VERSION,
    agentId: agent.id,
    name: agent.name,
    title: agent.title,
    mention: agent.mention,
    description: agent.description,
    ownerId: agent.ownerId,
    visibility: agent.visibility,
    source: agent.source ?? (agent.syncSource === "backend" ? "registry" : "local"),
    capabilities,
    permissions: {
      workspaceAccess,
      requiresApproval: true,
    },
    runtime: agent.runtime ?? {
      provider: "codex",
      protocol: "app-server",
      target: agent.executionLocation,
    },
    version: Math.max(1, Number(agent.version) || 1),
  };
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

export type RoomMemberRole = "owner" | "admin" | "member";

export type PermissionScope = "workspace.read" | "workspace.write" | "command.run" | "network.read";

export type WorkspaceBindingStatus = "online" | "offline" | "unknown" | "revoked";

export type WorkspaceBindingSummary = {
  id: string;
  hostUserId: string;
  hostDeviceId: string;
  label: string;
  repositoryUrl?: string;
  revision: number;
  baselineScopes: PermissionScope[];
  status: WorkspaceBindingStatus;
  lastSeenAt?: number;
};

export type PermissionConstraints = {
  pathPrefixes?: string[];
  commandExecutables?: string[];
  networkDomains?: string[];
};

export type TaskPermissionGrant = {
  id: string;
  taskId: string;
  taskRevision: number;
  workspaceBindingId: string;
  bindingRevision: number;
  hostUserId: string;
  hostDeviceId: string;
  scopes: PermissionScope[];
  constraints: PermissionConstraints;
  approvedByUserId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
};

export type ExecutionApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ExecutionApprovalDecision = "deny" | "allow_once" | "allow_for_task";

export type ExecutionApprovalRequest = {
  id: string;
  idempotencyKey: string;
  taskId: string;
  taskRevision: number;
  runId: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  workspaceBindingId: string;
  hostDeviceId: string;
  providerRequestId: string;
  requestedScope: PermissionScope;
  requestedConstraints: PermissionConstraints;
  summary: string;
  status: ExecutionApprovalStatus;
  decision?: ExecutionApprovalDecision;
  decidedByUserId?: string;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
};

export type TaskBudget = {
  maxDepth: number;
  maxDescendants: number;
  maxRuns: number;
  maxWallTimeMs: number;
};

export type TaskBudgetUsage = {
  descendants: number;
  runs: number;
  startedAt: number;
};

type AgentActionBase = {
  protocolVersion: 1;
  actionId: string;
  taskId: string;
  taskRevision: number;
};

export type AgentActionV1 =
  | (AgentActionBase & {
      action: "create_subtask";
      title: string;
      objective: string;
      expectedResult: string;
      assigneeIds: string[];
      requestedScopes: PermissionScope[];
      acceptanceCriteria: string[];
    })
  | (AgentActionBase & { action: "assign_agent"; subtaskId: string; assigneeIds: string[] })
  | (AgentActionBase & { action: "request_review"; reviewerAgentId?: string })
  | (AgentActionBase & {
      action: "request_permission";
      requestedScopes: PermissionScope[];
      constraints: PermissionConstraints;
      reason: string;
    })
  | (AgentActionBase & { action: "block"; reason: string })
  | (AgentActionBase & { action: "complete"; summary: string; artifactRefs: string[] });

export type TeamMessageStatus = "pending" | "streaming" | "complete" | "error" | "cancelled";
export type AgentMessageAction = "chat" | "propose-task";
export type AgentSessionState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting";
export type ProviderThread = {
  provider: string;
  providerSessionId: string;
};
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
  sessionId?: string;
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
  memberRole?: RoomMemberRole;
  workspaceBinding?: WorkspaceBindingSummary;
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
  | "waiting_for_host"
  | "waiting_for_permission"
  | "waiting_for_approval"
  | "waiting_for_assignee"
  | "waiting_for_budget"
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
  targetDeviceId?: string;
  permissionGrantId?: string;
  parentRunId?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

export type AgentSession = {
  id: string;
  agentId: string;
  workspace: string;
  roomId: string;
  taskId?: string;
  provider: string;
  model?: string;
  providerThread?: ProviderThread;
  state: AgentSessionState;
  contextVersion: number;
  consumedContextVersion: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
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
  requestedScopes?: PermissionScope[];
  creatorId: string;
  requestedByUserId?: string;
  proposedByAgentId?: string;
  sourceRoomId: string;
  anchorMessageId: string;
  anchorSeq: number;
  taskRoomId: string;
  parentTaskId?: string;
  rootTaskId?: string;
  delegatedByAgentId?: string;
  depth?: number;
  assigneeIds: string[];
  status: TaskStatus;
  revision: number;
  reviews: TaskReview[];
  approvedReviewId?: string;
  startedByUserId?: string;
  startedAt?: number;
  workspaceBinding?: WorkspaceBindingSummary;
  workspaceBindingRevision?: number;
  permissionGrantIds?: string[];
  budget?: TaskBudget;
  budgetUsage?: TaskBudgetUsage;
  waitReason?: string;
  artifactRefs?: string[];
  contextVersion: number;
  latestSourceSeq: number;
  consumedContextVersionByAgent: Record<string, number>;
  contextEvents: TaskContextEvent[];
  runs: TaskRun[];
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
  sessions: AgentSession[];
  humans: HumanContact[];
  rooms: TeamRoomSnapshot[];
  tasks: AgentTask[];
  loops: AgentLoopSession[];
  permissionGrants?: TaskPermissionGrant[];
  executionApprovals?: ExecutionApprovalRequest[];
};

export type TeamEvent =
  | { type: "workspace-snapshot"; snapshot: TeamWorkspaceSnapshot }
  | { type: "message-upsert"; workspace: string; roomId: string; message: TeamMessage }
  | { type: "room-upsert"; workspace: string; room: TeamRoomSnapshot }
  | { type: "task-upsert"; workspace: string; task: AgentTask }
  | { type: "loop-upsert"; workspace: string; loop: AgentLoopSession }
  | { type: "agents-upsert"; workspace: string; agents: AgentDefinition[] }
  | { type: "session-upsert"; workspace: string; session: AgentSession }
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
  getRuntimeCredentialStatus: (options: { agentId: string }) => Promise<{ configured: boolean }>;
  saveRuntimeCredential: (options: { agentId: string; token: string }) => Promise<void>;
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
