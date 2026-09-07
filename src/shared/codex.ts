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
  }) => Promise<{ turnId: string }>;
  interruptTurn: (options: { threadId: string; turnId: string }) => Promise<void>;
  resolveApproval: (options: {
    requestId: RpcRequestId;
    decision: ApprovalDecision;
  }) => Promise<void>;
  onEvent: (listener: (event: CodexEvent) => void) => () => void;
};
