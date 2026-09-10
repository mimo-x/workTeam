export type RpcRequestId = number | string;

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: string }
  | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean };

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
};

export type CodexStatus = {
  connected: boolean;
  connecting: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
  models: CodexModel[];
  defaultWorkspace: string;
};

export type CodexEvent = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexThreadSummary = {
  id: string;
  name: string;
  preview?: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  model?: string;
  source?: string;
  threadSource?: string;
};

export type CodexThreadDetail = CodexThreadSummary & {
  turns: Array<Record<string, unknown>>;
};

export type CodexAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  cwd?: string;
  relativePath?: string;
  dataUrl?: string;
};

export type ApprovalRequest = {
  requestId: RpcRequestId;
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  command?: string;
  cwd?: string;
  reason?: string;
};

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CodexDesktopApi = {
  connect: () => Promise<CodexStatus>;
  getStatus: () => Promise<CodexStatus>;
  chooseWorkspace: () => Promise<string | null>;
  login: () => Promise<{ started: boolean; authUrl?: string }>;
  startThread: (options: {
    cwd: string;
    model?: string;
    sandboxMode?: "read-only" | "workspace-write";
  }) => Promise<{ threadId: string }>;
  startTurn: (options: {
    threadId: string;
    cwd: string;
    text: string;
    model?: string;
    attachments?: CodexAttachment[];
  }) => Promise<{ turnId: string }>;
  listThreads: (options: {
    cwd: string;
    search?: string;
    archived?: boolean;
  }) => Promise<CodexThreadSummary[]>;
  readThread: (options: { threadId: string }) => Promise<CodexThreadDetail>;
  resumeThread: (options: { threadId: string }) => Promise<CodexThreadDetail>;
  renameThread: (options: { threadId: string; name: string }) => Promise<void>;
  archiveThread: (options: { threadId: string }) => Promise<void>;
  deleteThread: (options: { threadId: string }) => Promise<void>;
  forkThread: (options: { threadId: string }) => Promise<{ threadId: string }>;
  compactThread: (options: { threadId: string }) => Promise<void>;
  listSkills: (options: {
    cwd: string;
  }) => Promise<Array<{ name: string; path: string; enabled: boolean }>>;
  listMcpServers: (options: { threadId?: string }) => Promise<Array<Record<string, unknown>>>;
  createWorktree: (options: {
    cwd: string;
    key: string;
  }) => Promise<{ path: string; branch: string; baseRef: string; createdAt: number }>;
  removeWorktree: (options: { cwd: string; path: string }) => Promise<void>;
  pickAttachments: (options: { cwd: string }) => Promise<CodexAttachment[]>;
  discardAttachment: (options: { cwd: string; attachment: CodexAttachment }) => Promise<void>;
  interruptTurn: (options: { threadId: string; turnId: string }) => Promise<void>;
  resolveApproval: (options: {
    requestId: RpcRequestId;
    decision: ApprovalDecision;
  }) => Promise<void>;
  onEvent: (listener: (event: CodexEvent) => void) => () => void;
};
