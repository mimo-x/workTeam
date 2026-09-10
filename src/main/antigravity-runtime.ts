import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { promisify } from "node:util";

import type { AgentCapability } from "../shared/agent-team";
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

const execFile = promisify(execFileCallback);
const capabilities: readonly AgentCapability[] = ["chat", "stream_progress", "read_workspace"];
const DEFAULT_TIMEOUT_MS = 15_000;

type AntigravitySession = {
  id: string;
  process: ChildProcessWithoutNullStreams;
  lines: ReadLineInterface;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  activeTurnId?: string;
  stderrTail: string;
};

export type AntigravityRuntimeHealth = {
  available: boolean;
  version?: string;
  authenticated: "unknown";
  error?: string;
};

export class AntigravityRuntime implements AgentRuntime {
  readonly provider = "antigravity";
  readonly capabilities = capabilities;
  private readonly sessions = new Map<string, AntigravitySession>();
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
        "Antigravity Runtime 当前只支持只读工作区；写入和审批能力尚未接入。",
        "unsupported",
        input.model,
      );
    }
    if (input.providerSessionId && this.sessions.has(input.providerSessionId)) {
      return { sessionId: input.providerSessionId, providerSessionId: input.providerSessionId };
    }
    const id = input.providerSessionId ?? randomUUID();
    const args = [
      ...(this.options.argsPrefix ?? []),
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--mode",
      "plan",
    ];
    if (input.model) args.push("--model", input.model);
    const child = spawn(this.options.command ?? "agy", args, {
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
    const session: AntigravitySession = {
      id,
      process: child,
      lines: createInterface({ input: child.stdout }),
      ready,
      resolveReady,
      rejectReady,
      stderrTail: "",
    };
    this.sessions.set(id, session);
    session.lines.on("line", (line) => this.handleLine(id, line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      session.stderrTail = `${session.stderrTail}${String(chunk)}`.slice(-4_000);
    });
    child.once("error", (error) => session.rejectReady(error));
    child.once("exit", (code, signal) => {
      const message = session.stderrTail.trim()
        ? `Antigravity CLI 已退出（code=${code}, signal=${signal}）：${session.stderrTail.trim()}`
        : `Antigravity CLI 已退出（code=${code}, signal=${signal}）。`;
      session.rejectReady(new Error(message));
      if (session.activeTurnId) {
        this.emit({
          method: "turn/completed",
          sessionId: id,
          params: {
            turnId: session.activeTurnId,
            turn: { id: session.activeTurnId, status: "failed", error: message },
          },
          raw: { code, signal, stderr: session.stderrTail },
        });
      }
      this.emit({
        method: "runtime/status",
        sessionId: id,
        params: { connected: false, error: message },
        raw: { code, signal, stderr: session.stderrTail },
      });
      this.sessions.delete(id);
    });
    const timeout = setTimeout(
      () => session.rejectReady(new Error("Antigravity Session 初始化超时。")),
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
    return { sessionId: id, providerSessionId: id };
  }

  async startTurn(
    sessionId: string,
    _workspace: string,
    text: string,
    _model?: string,
  ): Promise<RuntimeTurn> {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId)
      throw this.error("Antigravity Runtime 暂不支持同一 Session 并发 Turn。", "unsupported");
    const turnId = randomUUID();
    session.activeTurnId = turnId;
    this.write(session, { event: "user", message: { content: text } });
    return { turnId };
  }

  async steerTurn() {
    throw this.error("Antigravity Headless 当前未声明可安全 steer 的能力。", "unsupported");
  }

  async interruptTurn(sessionId: string, turnId: string) {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId !== turnId)
      throw this.error("Antigravity Turn 不存在或已结束。", "transport");
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

  async resolveApproval() {
    throw this.error("Antigravity Headless 当前未接入桌面审批。", "unsupported");
  }

  async checkHealth(): Promise<AntigravityRuntimeHealth> {
    try {
      const result = await execFile(this.options.command ?? "agy", ["--version"], {
        timeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      return { available: true, version: result.stdout.trim(), authenticated: "unknown" };
    } catch (error) {
      return {
        available: false,
        authenticated: "unknown",
        error: formatErrorMessage(error, "Antigravity CLI 不可用。"),
      };
    }
  }

  dispose() {
    for (const session of this.sessions.values()) {
      session.lines.close();
      session.process.kill();
    }
    this.sessions.clear();
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
          error: formatErrorMessage(error, "Antigravity 输出不是有效 JSON。"),
          line: line.slice(0, 1_000),
        },
        raw: line,
      });
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (event.event === "init") {
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
    if (event.event === "step_update") {
      const update = (event.step_update ?? {}) as Record<string, unknown>;
      if (typeof update.text_delta === "string" && update.text_delta) {
        this.emit({
          method: "message/delta",
          sessionId,
          params: { turnId, delta: update.text_delta },
          raw: event,
        });
      }
      if (update.step_type === "tool") {
        this.emit({
          method: "activity",
          sessionId,
          params: {
            turnId,
            activity: `Antigravity 正在调用 ${String(update.tool_name ?? "工具")}…`,
          },
          raw: event,
        });
      }
      return;
    }
    if (event.event === "result") {
      const result = (event.result ?? {}) as Record<string, unknown>;
      const failed = String(result.status ?? "SUCCESS") !== "SUCCESS";
      if (!failed && typeof result.response === "string") {
        this.emit({
          method: "message/completed",
          sessionId,
          params: { turnId, text: result.response },
          raw: event,
        });
      }
      this.emit({
        method: "turn/completed",
        sessionId,
        params: {
          turnId,
          turn: {
            id: turnId,
            status: failed ? "failed" : "completed",
            error: failed ? result.error : undefined,
          },
          result: result.response,
        },
        raw: event,
      });
      session.activeTurnId = undefined;
      return;
    }
    this.emit({ method: "provider/event", sessionId, params: event, raw: event });
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw this.error("Antigravity Agent Session 不存在。", "transport");
    return session;
  }

  private write(session: AntigravitySession, value: Record<string, unknown>) {
    if (!session.process.stdin.writable)
      throw this.error("Antigravity CLI stdin 不可用。", "transport");
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
      message: formatErrorMessage(message, "Antigravity Runtime 执行失败。"),
      raw: message,
    });
  }
}
