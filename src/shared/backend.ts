import type {
  ImRuntimeConfig,
  PermissionScope,
  TeamWorkspaceSnapshot,
  WorkspaceBindingSummary,
} from "./agent-team";

export type BackendUser = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  openimUserId: string;
  emailVerified: boolean;
  revision: number;
};

export type BackendState = {
  apiUrl: string;
  authenticated: boolean;
  hasRefreshToken: boolean;
  user: BackendUser | null;
  error: string | null;
};

export type RemoteAgentHostState = {
  status: "stopped" | "connecting" | "connected" | "error";
  workspace: string;
  deviceId: string | null;
  agentCount: number;
  activeRunCount: number;
  error: string | null;
};

export type LocalWorkspaceBindingSummary = {
  bindingId: string;
  bindingRevision: number;
  hostDeviceId: string;
  updatedAt: number;
  pathAvailable: boolean;
};

export type BackendRegisterInput = {
  apiUrl: string;
  email: string;
  password: string;
  handle: string;
  displayName: string;
  deviceName?: string;
};

export type BackendLoginInput = {
  apiUrl: string;
  email: string;
  password: string;
  deviceName?: string;
};

export type BackendRequestInput = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type BackendDesktopApi = {
  getState: () => Promise<BackendState>;
  configure: (options: { apiUrl: string }) => Promise<BackendState>;
  register: (options: BackendRegisterInput) => Promise<BackendState>;
  login: (options: BackendLoginInput) => Promise<BackendState>;
  logout: () => Promise<BackendState>;
  request: <T = unknown>(options: BackendRequestInput) => Promise<T>;
  getImRuntimeConfig: () => Promise<ImRuntimeConfig>;
  syncWorkspace: (options: { workspace: string }) => Promise<TeamWorkspaceSnapshot>;
  importWorkspace: (options: { workspace: string }) => Promise<{
    imported: { agents: number; rooms: number; messages: number; tasks: number };
    warnings: string[];
  }>;
  startHost: (options: { workspace: string }) => Promise<RemoteAgentHostState>;
  registerWorkspaceBinding: (options: {
    workspace: string;
    label: string;
    repositoryUrl?: string | null;
    baselineScopes?: PermissionScope[];
  }) => Promise<WorkspaceBindingSummary>;
  listLocalWorkspaceBindings: () => Promise<LocalWorkspaceBindingSummary[]>;
  removeLocalWorkspaceBinding: (options: { bindingId: string }) => Promise<{ removed: boolean }>;
  stopHost: () => Promise<RemoteAgentHostState>;
  getHostState: () => Promise<RemoteAgentHostState>;
  onHostState: (listener: (state: RemoteAgentHostState) => void) => () => void;
  onEvent: (listener: (event: Record<string, unknown>) => void) => () => void;
};

export type LegacyWorkspaceImport = TeamWorkspaceSnapshot;
