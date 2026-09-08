import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexAccount,
  CodexEvent,
  CodexModel,
  CodexStatus,
  RpcRequestId,
} from "../shared/codex";
import { formatErrorMessage } from "../shared/error";

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type InitializeResponse = {
  userAgent: string;
};

type AccountResponse = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

type ModelListResponse = {
  data: Array<CodexModel & Record<string, unknown>>;
};

const APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

const findCodexExecutable = () => {
  const configuredPath = process.env.CODEX_PATH;
  const candidates = [
    configuredPath,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    process.platform === "win32" ? "codex.exe" : "codex",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return (
    candidates.find((candidate) => !candidate.includes("/") || existsSync(candidate)) ?? "codex"
  );
};

const errorMessage = (error: unknown) => formatErrorMessage(error, "Codex 运行异常。");

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadLineInterface | null = null;
  private nextId = 1;
  private pending = new Map<RpcRequestId, PendingRequest>();
  private serverRequests = new Map<RpcRequestId, string>();
  private listeners = new Set<(event: CodexEvent) => void>();
  private startPromise: Promise<CodexStatus> | null = null;
  private stderrTail = "";
  private status: CodexStatus = {
    connected: false,
    connecting: false,
    executable: null,
    version: null,
    error: null,
    account: null,
    requiresOpenaiAuth: false,
    models: [],
    defaultWorkspace: process.env.ELECTRON_RENDERER_URL ? process.cwd() : "",
  };

  onEvent(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus() {
    return structuredClone(this.status);
  }

  async connect() {
    if (this.status.connected) return this.getStatus();
    if (this.startPromise) return this.startPromise;

    this.status.connecting = true;
    this.status.error = null;
    this.startPromise = (async () => {
      try {
        await this.start();
        return this.getStatus();
      } finally {
        this.startPromise = null;
        this.status.connecting = false;
        this.emit({
          method: "desktop/status/changed",
          params: this.getStatus() as unknown as JsonObject,
        });
      }
    })();
    return this.startPromise;
  }

  private async start() {
    const executable = findCodexExecutable();
    this.status.executable = executable;

    try {
      const child = spawn(executable, ["app-server"], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.process = child;
      this.lines = createInterface({ input: child.stdout });
      this.lines.on("line", (line) => this.handleLine(line));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000);
      });
      child.once("error", (error) => this.handleExit(error));
      child.once("exit", (code, signal) => {
        if (this.status.connected) {
          this.handleExit(new Error(`Codex App Server 已退出（code=${code}, signal=${signal}）`));
        }
      });

      const initialized = await this.request<InitializeResponse>("initialize", {
        clientInfo: {
          name: "codex_desktop_chat",
          title: "Codex Desktop",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
      });
      this.notify("initialized");

      this.status.connected = true;
      this.status.version = initialized.userAgent;
      await this.refreshMetadata();
      this.emit({
        method: "desktop/status/changed",
        params: this.getStatus() as unknown as JsonObject,
      });
      return this.getStatus();
    } catch (error) {
      this.handleExit(error);
      throw error;
    }
  }

  private async refreshMetadata() {
    const [accountResult, modelResult] = await Promise.allSettled([
      this.request<AccountResponse>("account/read", { refreshToken: false }),
      this.request<ModelListResponse>("model/list", { limit: 100 }),
    ]);

    if (accountResult.status === "fulfilled") {
      this.status.account = accountResult.value.account;
      this.status.requiresOpenaiAuth = accountResult.value.requiresOpenaiAuth;
    }
    if (modelResult.status === "fulfilled") {
      this.status.models = modelResult.value.data.map((model) => ({
        id: model.id,
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
      }));
    }
  }

  async login() {
    await this.connect();
    const result = await this.request<{ type: string; authUrl?: string }>("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    });
    return { started: true, authUrl: result.authUrl };
  }

  async startThread(
    cwd: string,
    model?: string,
    sandbox: "read-only" | "workspace-write" = "workspace-write",
  ) {
    await this.connect();
    const result = await this.request<{ thread: { id: string } }>("thread/start", {
      cwd,
      model: model || null,
      sandbox,
      approvalPolicy: "on-request",
      ephemeral: false,
      threadSource: "codex-desktop-chat",
    });
    return { threadId: result.thread.id };
  }

  async startTurn(
    threadId: string,
    cwd: string,
    text: string,
    model?: string,
    skills: Array<{ name: string; path: string }> = [],
  ) {
    await this.connect();
    const result = await this.request<{ turn: { id: string } }>("turn/start", {
      threadId,
      cwd,
      model: model || null,
      input: [
        { type: "text", text, text_elements: [] },
        ...skills.map((skill) => ({ type: "skill", name: skill.name, path: skill.path })),
      ],
    });
    return { turnId: result.turn.id };
  }

  async steerTurn(threadId: string, turnId: string, text: string) {
    await this.connect();
    return this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text, text_elements: [] }],
    });
  }

  async listSkills(cwd: string, forceReload = false) {
    await this.connect();
    const result = await this.request<{
      data: Array<{
        cwd: string;
        skills: Array<{
          name: string;
          path: string;
          enabled: boolean;
        }>;
      }>;
    }>("skills/list", { cwds: [cwd], forceReload });
    return result.data.find((entry) => entry.cwd === cwd)?.skills ?? result.data[0]?.skills ?? [];
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    const method = this.serverRequests.get(requestId);
    if (!method || !APPROVAL_METHODS.has(method)) {
      throw new Error("这个审批请求已经失效或已处理。");
    }
    this.serverRequests.delete(requestId);
    this.write({ id: requestId, result: { decision } });
  }

  dispose() {
    this.lines?.close();
    this.lines = null;
    this.process?.kill();
    this.process = null;
    this.status.connected = false;
    this.rejectPending(new Error("Codex App Server 已关闭。"));
  }

  private request<T = unknown>(method: string, params?: JsonObject) {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error("Codex App Server 尚未连接。"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  private notify(method: string, params?: JsonObject) {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  private write(message: JsonObject) {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server 连接不可用。");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    const hasMethod = typeof message.method === "string";
    if (hasId && !hasMethod) {
      const id = message.id as RpcRequestId;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) {
        pending.reject(new Error(formatErrorMessage(message.error, "Codex RPC 调用失败。")));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!hasMethod) return;
    const method = message.method as string;
    const params = (message.params ?? {}) as JsonObject;
    if (hasId) {
      this.handleServerRequest(message.id as RpcRequestId, method, params);
      return;
    }

    if (method === "account/updated" || method === "account/login/completed") {
      void this.refreshMetadata().then(() => {
        this.emit({
          method: "desktop/status/changed",
          params: this.getStatus() as unknown as JsonObject,
        });
      });
    }
    this.emit({ method, params });
  }

  private handleServerRequest(id: RpcRequestId, method: string, params: JsonObject) {
    if (APPROVAL_METHODS.has(method)) {
      this.serverRequests.set(id, method);
      const isCommand = method === "item/commandExecution/requestApproval";
      const approval: ApprovalRequest = {
        requestId: id,
        method: method as ApprovalRequest["method"],
        threadId: String(params.threadId ?? ""),
        turnId: String(params.turnId ?? ""),
        itemId: String(params.itemId ?? ""),
        title: isCommand ? "Codex 请求执行命令" : "Codex 请求修改工作区外的文件",
        command: typeof params.command === "string" ? params.command : undefined,
        cwd: typeof params.cwd === "string" ? params.cwd : undefined,
        reason: typeof params.reason === "string" ? params.reason : undefined,
      };
      this.emit({
        method: "desktop/approval/requested",
        params: approval as unknown as JsonObject,
      });
      return;
    }

    this.write({
      id,
      error: {
        code: -32601,
        message: `Desktop client does not support server request: ${method}`,
      },
    });
  }

  private emit(event: CodexEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private handleExit(error: unknown) {
    const stderr = this.stderrTail.trim();
    const message = stderr ? `${errorMessage(error)}\n${stderr}` : errorMessage(error);
    this.status.connected = false;
    this.status.error = message;
    this.rejectPending(new Error(message));
    this.emit({
      method: "desktop/status/changed",
      params: this.getStatus() as unknown as JsonObject,
    });
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.serverRequests.clear();
  }
}
