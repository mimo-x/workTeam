import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { promisify } from "node:util";

import type { AgentCapability } from "../shared/agent-team";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeAccess,
  RuntimeSession,
  RuntimeSkill,
  RuntimeTurn,
} from "./agent-runtime";
import { AgentRuntimeError } from "./agent-runtime";
import { formatErrorMessage } from "../shared/error";

type ClaudeSession = {
  id: string;
  process: ChildProcessWithoutNullStreams;
  lines: ReadLineInterface;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  activeTurnId?: string;
  stderrTail: string;
};

const capabilities: readonly AgentCapability[] = ["chat", "stream_progress", "read_workspace"];
const DEFAULT_TIMEOUT_MS = 15_000;
const execFile = promisify(execFileCallback);

export type ClaudeRuntimeHealth = {
  available: boolean;
  version?: string;
  authenticated: boolean;
  authMethod?: string;
  error?: string;
};

export class ClaudeRuntime implements AgentRuntime {
  readonly provider = "claude";
  readonly capabilities = capabilities;
  private readonly sessions = new Map<string, ClaudeSession>();
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();

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

  async startSession(input: {
    workspace: string;
    model?: string;
    access: RuntimeAccess;
    providerSessionId?: string;
  }): Promise<RuntimeSession> {
    if (input.access === "workspace-write") {
      throw this.error(
        "Claude Runtime 当前只支持只读工作区；写入和审批能力尚未接入。",
        "unsupported",
        input.model,
      );
    }
    if (input.providerSessionId && this.sessions.has(input.providerSessionId)) {
      return { sessionId: input.providerSessionId, providerSessionId: input.providerSessionId };
    }

    const sessionId = input.providerSessionId ?? randomUUID();
    const args = [
      ...(this.options.argsPrefix ?? []),
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--session-id",
      sessionId,
      "--add-dir",
      input.workspace,
      "--permission-mode",
      "plan",
      "--permission-prompts",
      "none",
    ];
    if (input.model) args.push("--model", input.model);
    const child = spawn(this.options.command ?? "claude", args, {
      cwd: input.workspace,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveReady: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const session: ClaudeSession = {
      id: sessionId,
      process: child,
      lines: createInterface({ input: child.stdout }),
      ready,
      resolveReady,
      rejectReady,
      stderrTail: "",
    };
    this.sessions.set(sessionId, session);
    session.lines.on("line", (line) => this.handleLine(sessionId, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      session.stderrTail = `${session.stderrTail}${String(chunk)}`.slice(-4_000);
    });
    child.once("error", (error) => session.rejectReady(error));
    child.once("exit", (code, signal) => {
      const message = session.stderrTail.trim()
        ? `Claude CLI 已退出（code=${code}, signal=${signal}）：${session.stderrTail.trim()}`
        : `Claude CLI 已退出（code=${code}, signal=${signal}）。`;
      session.rejectReady(new Error(message));
      if (session.activeTurnId) {
        this.emit({
          method: "turn/completed",
          sessionId,
          params: {
            turnId: session.activeTurnId,
            turn: { id: session.activeTurnId, status: "failed", error: message },
          },
          raw: { code, signal, stderr: session.stderrTail },
        });
      }
      this.emit({
        method: "runtime/status",
        sessionId,
        params: { connected: false, error: message },
        raw: { code, signal, stderr: session.stderrTail },
      });
      this.sessions.delete(sessionId);
    });
    const timeout = setTimeout(
      () => session.rejectReady(new Error("Claude Session 初始化超时。")),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    timeout.unref();
    try {
      await session.ready;
    } catch (error) {
      child.kill();
      throw this.error(error, "transport", input.model);
    } finally {
      clearTimeout(timeout);
    }
    return { sessionId, providerSessionId: sessionId };
  }

  async startTurn(
    sessionId: string,
    _workspace: string,
    text: string,
    model?: string,
  ): Promise<RuntimeTurn> {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId)
      throw this.error("Claude Runtime 暂不支持同一 Session 并发 Turn。", "unsupported", model);
    const turnId = randomUUID();
    session.activeTurnId = turnId;
    this.write(session, {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    return { turnId };
  }

  async steerTurn(sessionId: string, turnId: string, text: string) {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId !== turnId)
      throw this.error("Claude Turn 不存在或已结束。", "transport");
    this.write(session, {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
  }

  async interruptTurn(sessionId: string, turnId: string) {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId !== turnId)
      throw this.error("Claude Turn 不存在或已结束。", "transport");
    session.activeTurnId = undefined;
    this.emit({
      method: "turn/completed",
      sessionId,
      params: { turnId, turn: { id: turnId, status: "interrupted" } },
    });
    session.process.kill();
    this.sessions.delete(sessionId);
  }

  async listSkills(_workspace: string): Promise<RuntimeSkill[]> {
    return [];
  }

  async checkHealth(): Promise<ClaudeRuntimeHealth> {
    try {
      const versionResult = await execFile(this.options.command ?? "claude", ["--version"], {
        timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      const authResult = await execFile(
        this.options.command ?? "claude",
        ["auth", "status", "--json"],
        {
          timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
        },
      );
      const auth = JSON.parse(authResult.stdout) as {
        loggedIn?: boolean;
        authMethod?: string;
      };
      return {
        available: true,
        version: versionResult.stdout.trim(),
        authenticated: auth.loggedIn === true,
        authMethod: auth.authMethod,
      };
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        error: formatErrorMessage(error, "Claude CLI 不可用或认证状态读取失败。"),
      };
    }
  }

  async resolveApproval() {
    throw this.error("Claude Runtime 当前未接入桌面审批。", "unsupported");
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.lines.close();
      session.process.kill();
    }
    this.sessions.clear();
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw this.error("Claude Agent Session 不存在。", "transport");
    return session;
  }

  private handleLine(sessionId: string, line: string) {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      this.emit({
        method: "provider/event",
        sessionId,
        params: {
          error: formatErrorMessage(error, "Claude 输出不是有效 JSON。"),
          line: line.slice(0, 1_000),
        },
        raw: line,
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (event.type === "system" && event.subtype === "init") {
      session.resolveReady();
      this.emit({
        method: "runtime/status",
        sessionId,
        params: { connected: true, metadata: event },
        raw: event,
      });
      return;
    }
    const turnId = session.activeTurnId;
    if (event.type === "stream_event") {
      const nested = event.event as Record<string, unknown> | undefined;
      const delta = nested?.delta as Record<string, unknown> | undefined;
      if (nested?.type === "content_block_delta" && delta?.type === "text_delta") {
        this.emit({
          method: "message/delta",
          sessionId,
          params: { turnId, delta: String(delta.text ?? "") },
          raw: event,
        });
      }
      if (nested?.type === "content_block_start") {
        const block = nested.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use")
          this.emit({
            method: "activity",
            sessionId,
            params: { turnId, activity: `正在调用 ${String(block.name ?? "工具")}…` },
            raw: event,
          });
      }
      return;
    }
    if (event.type === "assistant") {
      const message = event.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const text = content
        .filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
        )
        .filter((item) => item.type === "text")
        .map((item) => String(item.text ?? ""))
        .join("");
      if (text)
        this.emit({ method: "message/completed", sessionId, params: { turnId, text }, raw: event });
      return;
    }
    if (event.type === "result") {
      const isError = event.is_error === true || event.subtype !== "success";
      this.emit({
        method: "turn/completed",
        sessionId,
        params: {
          turnId,
          turn: {
            id: turnId,
            status: isError ? "failed" : "completed",
            error: isError ? (event.result ?? event.subtype) : undefined,
          },
          result: event.result,
        },
        raw: event,
      });
      session.activeTurnId = undefined;
      return;
    }
    this.emit({ method: "provider/event", sessionId, params: event, raw: event });
  }

  private write(session: ClaudeSession, value: Record<string, unknown>) {
    if (!session.process.stdin.writable) throw this.error("Claude CLI stdin 不可用。", "transport");
    session.process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private emit(event: AgentRuntimeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private error(message: unknown, kind: AgentRuntimeError["kind"], model?: string) {
    return new AgentRuntimeError({
      kind,
      provider: this.provider,
      model,
      message: formatErrorMessage(message, "Claude Runtime 执行失败。"),
      raw: message,
    });
  }
}
