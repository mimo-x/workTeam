import type { AgentCapability } from "../shared/agent-team";
import type { ApprovalDecision, ApprovalRequest, RpcRequestId } from "../shared/codex";

export type RuntimeAccess = "read-only" | "workspace-write";

export type RuntimeSkill = {
  name: string;
  path: string;
  enabled: boolean;
};

export type RuntimeSession = {
  sessionId: string;
  providerSessionId: string;
};

export type RuntimeTurn = {
  turnId: string;
};

export type RuntimeError = {
  kind: "unsupported" | "authentication" | "timeout" | "transport" | "provider" | "unknown";
  provider: string;
  model?: string;
  message: string;
  raw?: unknown;
};

export class AgentRuntimeError extends Error implements RuntimeError {
  readonly kind: RuntimeError["kind"];
  readonly provider: string;
  readonly model?: string;
  readonly raw?: unknown;

  constructor(input: RuntimeError) {
    super(input.message);
    this.name = "AgentRuntimeError";
    this.kind = input.kind;
    this.provider = input.provider;
    this.model = input.model;
    this.raw = input.raw;
  }
}

export type AgentRuntimeEvent = {
  method:
    | "message/delta"
    | "message/completed"
    | "activity"
    | "approval/requested"
    | "runtime/status"
    | "turn/completed"
    | "provider/event";
  sessionId?: string;
  params: Record<string, unknown>;
  raw?: unknown;
};

export type AgentRuntime = {
  readonly provider: string;
  readonly capabilities: readonly AgentCapability[];
  onEvent(listener: (event: AgentRuntimeEvent) => void): () => void;
  hasSession?(sessionId: string): boolean;
  startSession(input: {
    workspace: string;
    model?: string;
    access: RuntimeAccess;
    providerSessionId?: string;
  }): Promise<RuntimeSession>;
  startTurn(
    sessionId: string,
    workspace: string,
    text: string,
    model?: string,
    skills?: Array<{ name: string; path: string }>,
  ): Promise<RuntimeTurn>;
  steerTurn(sessionId: string, turnId: string, text: string): Promise<void>;
  interruptTurn(sessionId: string, turnId: string): Promise<void>;
  listSkills(workspace: string): Promise<RuntimeSkill[]>;
  resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision): Promise<void>;
};

export type { ApprovalRequest };
