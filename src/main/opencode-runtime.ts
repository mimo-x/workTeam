import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

import type { AgentCapability } from "../shared/agent-team";
import type { ApprovalDecision, RpcRequestId } from "../shared/codex";
import { formatErrorMessage } from "../shared/error";
import {
  AgentRuntimeError,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type RuntimeAccess,
  type RuntimeSession,
  type RuntimeSkill,
  type RuntimeTurn,
} from "./agent-runtime";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: RpcRequestId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

type OpenCodeSession = {
  id: string;
  workspace: string;
  process: ChildProcessWithoutNullStreams;
  lines: ReadLineInterface;
  pending: Map<RpcRequestId, PendingRequest>;
  nextRequestId: number;
  activeTurnId?: string;
  cancelRequested: boolean;
  content: string;
  permissionRequests: Map<RpcRequestId, Record<string, unknown>>;
};

const capabilities: readonly AgentCapability[] = ["chat", "stream_progress", "read_workspace"];
const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenCodeRuntime implements AgentRuntime {
  readonly provider = "opencode";
  readonly capabilities = capabilities;
  private readonly sessions = new Map<string, OpenCodeSession>();

  constructor(
    private readonly options: {
      command?: string;
      argsPrefix?: string[];
      env?: NodeJS.ProcessEnv;
      timeoutMs?: number;
    } = {},
  ) {}

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();

  async startSession(input: {
    workspace: string;
    model?: string;
    access: RuntimeAccess;
    providerSessionId?: string;
  }): Promise<RuntimeSession> {
    if (input.access === "workspace-write") {
      throw this.error("OpenCode Runtime 当前只支持只读工作区。", "unsupported", input.model);
    }
    if (input.providerSessionId && this.sessions.has(input.providerSessionId)) {
      return { sessionId: input.providerSessionId, providerSessionId: input.providerSessionId };
    }
    const session = await this.startProcess(input.workspace);
    if (input.providerSessionId) {
      await sessionRequest(session, "session/load", {
        sessionId: input.providerSessionId,
        cwd: input.workspace,
        mcpServers: [],
        additionalDirectories: [],
      });
      session.id = input.providerSessionId;
      this.sessions.delete(session.id);
      this.sessions.set(input.providerSessionId, session);
    } else {
      const result = await sessionRequest(session, "session/new", {
        cwd: input.workspace,
        mcpServers: [],
        additionalDirectories: [],
      });
      const providerSessionId = String(result.sessionId ?? "");
      if (!providerSessionId)
        throw this.error("OpenCode 未返回 Session ID。", "provider", input.model);
      session.id = providerSessionId;
      this.sessions.set(providerSessionId, session);
    }
    this.emit({
      method: "runtime/status",
      sessionId: session.id,
      params: { connected: true, provider: this.provider, model: input.model },
    });
    return { sessionId: session.id, providerSessionId: session.id };
  }

  async startTurn(
    sessionId: string,
    _workspace: string,
    text: string,
    _model?: string,
  ): Promise<RuntimeTurn> {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId)
      throw this.error("OpenCode Runtime 暂不支持同一 Session 并发 Turn。", "unsupported");
    const turnId = randomUUID();
    session.activeTurnId = turnId;
    session.cancelRequested = false;
    session.content = "";
    void sessionRequest(session, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    })
      .then((result) => {
        const stopReason = String(result.stopReason ?? "end_turn");
        const status = stopReason === "cancelled" ? "interrupted" : "completed";
        this.emit({
          method: "turn/completed",
          sessionId,
          params: {
            turnId,
            turn: {
              id: turnId,
              status,
              error: stopReason === "cancelled" ? undefined : undefined,
            },
          },
          raw: result,
        });
      })
      .catch((error) => {
        this.emit({
          method: "turn/completed",
          sessionId,
          params: {
            turnId,
            turn: { id: turnId, status: "failed", error: formatErrorMessage(error) },
          },
          raw: error,
        });
      })
      .finally(() => {
        session.activeTurnId = undefined;
        session.cancelRequested = false;
      });
    return { turnId };
  }

  async steerTurn() {
    throw this.error("OpenCode ACP 当前未声明可安全 steer 的能力。", "unsupported");
  }

  async interruptTurn(sessionId: string, turnId: string) {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId !== turnId)
      throw this.error("OpenCode Turn 不存在或已结束。", "transport");
    session.cancelRequested = true;
    await sessionNotify(session, "session/cancel", { sessionId });
  }

  async listSkills(_workspace: string): Promise<RuntimeSkill[]> {
    return [];
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    for (const session of this.sessions.values()) {
      const request = session.permissionRequests.get(requestId);
      if (!request) continue;
      const options = Array.isArray(request.options) ? request.options : [];
      const selected = options.find((option) => {
        const kind = String((option as Record<string, unknown>)?.kind ?? "").toLowerCase();
        return decision === "accept" || decision === "acceptForSession"
          ? kind.includes("allow") || kind.includes("approve")
          : kind.includes("reject") || kind.includes("deny");
      }) as Record<string, unknown> | undefined;
      await this.respond(session, requestId, {
        outcome: selected
          ? { outcome: "selected", optionId: selected.optionId }
          : { outcome: "cancelled" },
      });
      session.permissionRequests.delete(requestId);
      return;
    }
    throw this.error("OpenCode 审批请求不存在或已结束。", "transport");
  }

  async checkHealth() {
    try {
      const result = await this.runVersion();
      return { available: true, version: result.trim() };
    } catch (error) {
      return { available: false, error: formatErrorMessage(error, "OpenCode 不可用。") };
    }
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.lines.close();
      session.process.kill();
    }
    this.sessions.clear();
  }

  private async startProcess(workspace: string) {
    const args = [...(this.options.argsPrefix ?? []), "acp", "--cwd", workspace];
    const child = spawn(this.options.command ?? "opencode", args, {
      cwd: workspace,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session: OpenCodeSession = {
      id: `pending_${randomUUID()}`,
      workspace,
      process: child,
      lines: createInterface({ input: child.stdout }),
      pending: new Map(),
      nextRequestId: 1,
      cancelRequested: false,
      content: "",
      permissionRequests: new Map(),
    };
    session.lines.on("line", (line) => this.handleLine(session, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) =>
      this.emit({
        method: "provider/event",
        sessionId: session.id,
        params: { stderr: String(chunk).slice(-4_000) },
        raw: chunk,
      }),
    );
    child.once("exit", (code, signal) => {
      const error = `OpenCode ACP 已退出（code=${code}, signal=${signal}）。`;
      for (const pending of session.pending.values()) pending.reject(new Error(error));
      session.pending.clear();
      if (session.activeTurnId) {
        this.emit({
          method: "turn/completed",
          sessionId: session.id,
          params: {
            turnId: session.activeTurnId,
            turn: { id: session.activeTurnId, status: "failed", error },
          },
          raw: { code, signal },
        });
      }
      this.emit({
        method: "runtime/status",
        sessionId: session.id,
        params: { connected: false, error },
        raw: { code, signal },
      });
      this.sessions.delete(session.id);
    });
    await sessionRequest(session, "initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
        auth: { terminal: false },
      },
      clientInfo: { name: "workTeam", version: "0.1.0" },
    });
    return session;
  }

  private async runVersion() {
    const child = spawn(this.options.command ?? "opencode", ["--version"], {
      env: { ...process.env, ...this.options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`OpenCode 版本检测失败（code=${code}）。`)),
      );
    });
    return output;
  }

  private handleLine(session: OpenCodeSession, line: string) {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.emit({
        method: "provider/event",
        sessionId: session.id,
        params: {
          error: formatErrorMessage(error, "OpenCode ACP 输出不是有效 JSON。"),
          line: line.slice(0, 1_000),
        },
        raw: line,
      });
      return;
    }
    if (message.id !== undefined && (message.result || message.error)) {
      const pending = session.pending.get(message.id);
      if (!pending) return;
      session.pending.delete(message.id);
      if (message.error)
        pending.reject(
          new Error(message.error.message || `OpenCode ACP 错误 ${message.error.code ?? ""}`),
        );
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method === "session/update") {
      this.handleUpdate(session, message.params ?? {});
      return;
    }
    if (message.method === "session/request_permission" && message.id !== undefined) {
      const params = message.params ?? {};
      session.permissionRequests.set(message.id, params);
      this.emit({
        method: "approval/requested",
        sessionId: session.id,
        params: { requestId: message.id, ...params },
        raw: message,
      });
      return;
    }
    if (message.method === "fs/read_text_file" && message.id !== undefined) {
      void this.readTextFile(session, message.id, message.params ?? {});
      return;
    }
    if (message.method && message.id !== undefined) {
      void this.respond(session, message.id, undefined, {
        code: -32601,
        message: `不支持 ACP 请求：${message.method}`,
      });
    }
  }

  private handleUpdate(session: OpenCodeSession, params: Record<string, unknown>) {
    const update = (params.update ?? {}) as Record<string, unknown>;
    const kind = String(update.sessionUpdate ?? "");
    const content = (update.content ?? {}) as Record<string, unknown>;
    const text = content.type === "text" ? String(content.text ?? "") : "";
    if (kind === "agent_message_chunk" && text) {
      session.content += text;
      this.emit({
        method: "message/delta",
        sessionId: session.id,
        params: { turnId: session.activeTurnId, delta: text },
        raw: params,
      });
    } else if (
      kind === "tool_call" ||
      kind === "tool_call_update" ||
      kind === "agent_thought_chunk"
    ) {
      this.emit({
        method: "activity",
        sessionId: session.id,
        params: { turnId: session.activeTurnId, activity: "OpenCode 正在执行工具…" },
        raw: params,
      });
    }
  }

  private async readTextFile(
    session: OpenCodeSession,
    requestId: RpcRequestId,
    params: Record<string, unknown>,
  ) {
    const path = String(params.path ?? "");
    if (!isAbsolute(path)) {
      await this.respond(session, requestId, undefined, {
        code: -32001,
        message: "只允许读取当前工作区内的文件。",
      });
      return;
    }
    try {
      const root = await realpath(session.workspace);
      const target = await realpath(path);
      const targetRelative = relative(root, target);
      if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`)) {
        await this.respond(session, requestId, undefined, {
          code: -32001,
          message: "只允许读取当前工作区内的文件。",
        });
        return;
      }
      const content = await readFile(target, "utf8");
      await this.respond(session, requestId, { content });
    } catch (error) {
      await this.respond(session, requestId, undefined, {
        code: -32002,
        message: formatErrorMessage(error, "文件读取失败。"),
      });
    }
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw this.error("OpenCode Agent Session 不存在。", "transport");
    return session;
  }

  private respond(
    session: OpenCodeSession,
    id: RpcRequestId,
    result?: Record<string, unknown>,
    error?: { code: number; message: string },
  ) {
    if (!session.process.stdin.writable)
      return Promise.reject(new Error("OpenCode ACP stdin 不可用。"));
    session.process.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result: result ?? {} }) })}\n`,
    );
    return Promise.resolve();
  }

  private emit(event: AgentRuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private error(message: unknown, kind: AgentRuntimeError["kind"], model?: string) {
    return new AgentRuntimeError({
      kind,
      provider: this.provider,
      model,
      message: formatErrorMessage(message, "OpenCode Runtime 执行失败。"),
      raw: message,
    });
  }
}

const sessionRequest = (
  session: OpenCodeSession,
  method: string,
  params: Record<string, unknown>,
) => {
  const id = session.nextRequestId++;
  session.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const pending = { resolve, reject };
    session.pending.set(id, pending);
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`OpenCode ACP 请求超时：${method}`));
    }, DEFAULT_TIMEOUT_MS);
    timer.unref();
    pending.resolve = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    pending.reject = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
};

const sessionNotify = (
  session: OpenCodeSession,
  method: string,
  params: Record<string, unknown>,
) => {
  if (!session.process.stdin.writable)
    return Promise.reject(new Error("OpenCode ACP stdin 不可用。"));
  session.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return Promise.resolve();
};
