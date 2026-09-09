import type { AgentCapability } from "../shared/agent-team";
import type { CodexEvent, ApprovalDecision, ApprovalRequest, RpcRequestId } from "../shared/codex";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeAccess,
  RuntimeSession,
  RuntimeSkill,
  RuntimeTurn,
} from "./agent-runtime";
import { AgentRuntimeError } from "./agent-runtime";
import { CodexAppServer } from "./codex-app-server";
import { formatErrorMessage } from "../shared/error";

const capabilities: readonly AgentCapability[] = [
  "chat",
  "stream_progress",
  "read_workspace",
  "write_workspace",
  "run_command",
];

const turnIdFor = (event: CodexEvent) => {
  if (typeof event.params.turnId === "string") return event.params.turnId;
  const turn = event.params.turn as { id?: unknown } | undefined;
  return typeof turn?.id === "string" ? turn.id : undefined;
};

export class CodexRuntime implements AgentRuntime {
  readonly provider = "codex";
  readonly capabilities = capabilities;
  private readonly turnSessions = new Map<string, string>();
  private readonly sessions = new Set<string>();

  constructor(private readonly codex: CodexAppServer) {}

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    return this.codex.onEvent((event) => listener(this.normalizeEvent(event)));
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
    try {
      if (input.providerSessionId) {
        this.sessions.add(input.providerSessionId);
        return { sessionId: input.providerSessionId, providerSessionId: input.providerSessionId };
      }
      const result = await this.codex.startThread(
        input.workspace,
        input.model,
        input.access === "workspace-write" ? "workspace-write" : "read-only",
      );
      this.sessions.add(result.threadId);
      return { sessionId: result.threadId, providerSessionId: result.threadId };
    } catch (error) {
      throw this.wrapError(error, "Codex Session 创建失败。", input.model);
    }
  }

  async startTurn(
    sessionId: string,
    workspace: string,
    text: string,
    model?: string,
    skills: Array<{ name: string; path: string }> = [],
  ): Promise<RuntimeTurn> {
    try {
      const result = await this.codex.startTurn(sessionId, workspace, text, model, skills);
      this.turnSessions.set(result.turnId, sessionId);
      return result;
    } catch (error) {
      throw this.wrapError(error, "Codex Turn 执行失败。", model);
    }
  }

  async steerTurn(sessionId: string, turnId: string, text: string) {
    try {
      await this.codex.steerTurn(sessionId, turnId, text);
    } catch (error) {
      throw this.wrapError(error, "Codex Turn 更新失败。");
    }
  }

  async interruptTurn(sessionId: string, turnId: string) {
    try {
      await this.codex.interruptTurn(sessionId, turnId);
    } catch (error) {
      throw this.wrapError(error, "Codex Turn 取消失败。");
    }
  }

  async listSkills(workspace: string): Promise<RuntimeSkill[]> {
    try {
      return await this.codex.listSkills(workspace);
    } catch (error) {
      throw this.wrapError(error, "Codex Skills 读取失败。");
    }
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    try {
      await this.codex.resolveApproval(requestId, decision);
    } catch (error) {
      throw this.wrapError(error, "Codex 审批处理失败。");
    }
  }

  private wrapError(error: unknown, fallback: string, model?: string) {
    if (error instanceof AgentRuntimeError) return error;
    return new AgentRuntimeError({
      kind: "provider",
      provider: this.provider,
      model,
      message: formatErrorMessage(error, fallback),
      raw: error,
    });
  }

  private normalizeEvent(event: CodexEvent): AgentRuntimeEvent {
    const turnId = turnIdFor(event);
    const sessionId =
      (typeof event.params.threadId === "string" && event.params.threadId) ||
      (turnId ? this.turnSessions.get(turnId) : undefined);
    if (event.method === "item/agentMessage/delta") {
      return {
        method: "message/delta",
        sessionId,
        params: { ...event.params, turnId },
        raw: event,
      };
    }
    if (event.method === "item/completed") {
      const item = event.params.item as
        | { type?: unknown; text?: unknown; content?: unknown }
        | undefined;
      if (item?.type === "agentMessage") {
        return {
          method: "message/completed",
          sessionId,
          params: { turnId, text: item.text ?? item.content ?? "" },
          raw: event,
        };
      }
    }
    if (event.method === "item/started") {
      const item = event.params.item as { type?: unknown } | undefined;
      const activity =
        item?.type === "commandExecution"
          ? "正在运行命令…"
          : item?.type === "fileChange"
            ? "正在修改文件…"
            : item?.type === "mcpToolCall"
              ? "正在调用工具…"
              : undefined;
      if (activity)
        return { method: "activity", sessionId, params: { turnId, activity }, raw: event };
    }
    if (event.method === "desktop/approval/requested") {
      return { method: "approval/requested", sessionId, params: event.params, raw: event };
    }
    if (event.method === "desktop/status/changed") {
      if ((event.params as Record<string, unknown>).connected === false) this.sessions.clear();
      return { method: "runtime/status", sessionId, params: event.params, raw: event };
    }
    if (event.method === "turn/completed") {
      const normalized = {
        method: "turn/completed" as const,
        sessionId,
        params: { ...event.params, turnId },
        raw: event,
      };
      if (turnId) this.turnSessions.delete(turnId);
      return normalized;
    }
    return { method: "provider/event", sessionId, params: event.params, raw: event };
  }
}

export type { ApprovalRequest };
