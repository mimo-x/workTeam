import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import OpenIMSdkMain from "@openim/electron-client-sdk";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";

import { AgentGatewayPublisher } from "./agent-gateway";
import { AgentTeamService } from "./agent-team";
import { BackendClient, backendConfigPath } from "./backend-client";
import { CodexAppServer } from "./codex-app-server";
import { ImConfigStore, imConfigPath } from "./im-config";
import { RemoteAgentHost } from "./remote-agent-host";
import { WorktreeManager } from "./worktree-manager";
import { isCodexPrivateThread } from "./codex-thread-visibility";
import type {
  AgentDefinition,
  AgentMessageAction,
  ExternalTeamMessage,
  HumanContact,
  ImConfigInput,
  TaskStatus,
  TaskReviewDecision,
} from "../shared/agent-team";
import type { ApprovalDecision, CodexAttachment, RpcRequestId } from "../shared/codex";
import type {
  BackendLoginInput,
  BackendRegisterInput,
  BackendRequestInput,
} from "../shared/backend";

const codex = new CodexAppServer();
let mainWindow: BrowserWindow | null = null;
let openImSdk: OpenIMSdkMain | null = null;
let imConfig: ImConfigStore;
let agentTeam: AgentTeamService;
let backend: BackendClient;
let remoteAgentHost: RemoteAgentHost;
const worktrees = new WorktreeManager();

const fileToDataUrl = async (path: string, mimeType: string) =>
  `data:${mimeType};base64,${(await readFile(path)).toString("base64")}`;

const requireDirectory = async (value: unknown) => {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error("请选择有效的项目目录。");
  const info = await stat(value);
  if (!info.isDirectory()) throw new Error("选择的路径不是目录。");
  return value;
};

const requireString = (value: unknown, label: string, maxLength = 100_000) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空。`);
  if (value.length > maxLength) throw new Error(`${label}过长。`);
  return value.trim();
};

const sendToRenderer = (channel: string, value: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, value);
  }
};

const openImLibraryPath = () => {
  const platform =
    process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  const filename =
    process.platform === "darwin"
      ? "libopenimsdk.dylib"
      : process.platform === "win32"
        ? "libopenimsdk.dll"
        : "libopenimsdk.so";
  const base = app.isPackaged
    ? join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "@openim",
        "electron-client-sdk",
        "assets",
      )
    : join(app.getAppPath(), "node_modules", "@openim", "electron-client-sdk", "assets");
  const path = join(base, `${platform}_${architecture}`, filename);
  if (!existsSync(path)) throw new Error(`找不到 OpenIM 原生库：${path}`);
  return path;
};

const attachOpenIm = (window: BrowserWindow) => {
  if (openImSdk) {
    openImSdk.addWebContent(window.webContents);
    return;
  }
  openImSdk = new OpenIMSdkMain(openImLibraryPath(), window.webContents);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: !app.isPackaged,
    backgroundColor: "#080b12",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachOpenIm(mainWindow);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const registerIpc = () => {
  ipcMain.handle("codex:connect", () => codex.connect());
  ipcMain.handle("codex:status", () => codex.getStatus());
  ipcMain.handle("codex:choose-workspace", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "选择 Codex 工作目录",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("codex:login", async () => {
    const result = await codex.login();
    if (result.authUrl) await shell.openExternal(result.authUrl);
    return result;
  });
  ipcMain.handle(
    "codex:start-thread",
    async (_event, options: { cwd?: unknown; model?: unknown; sandboxMode?: unknown }) => {
      const cwd = await requireDirectory(options.cwd);
      const model = typeof options.model === "string" ? options.model : undefined;
      const sandbox = options.sandboxMode === "read-only" ? "read-only" : "workspace-write";
      return codex.startThread(cwd, model, sandbox);
    },
  );
  ipcMain.handle(
    "codex:start-turn",
    async (
      _event,
      options: {
        threadId?: unknown;
        cwd?: unknown;
        text?: unknown;
        model?: unknown;
        attachments?: unknown;
      },
    ) => {
      const cwd = await requireDirectory(options.cwd);
      if (typeof options.threadId !== "string" || !options.threadId) {
        throw new Error("缺少 Codex 会话 ID。");
      }
      if (typeof options.text !== "string" || !options.text.trim()) {
        throw new Error("消息不能为空。");
      }
      const model = typeof options.model === "string" ? options.model : undefined;
      const attachments = Array.isArray(options.attachments)
        ? (options.attachments.filter(
            (value): value is CodexAttachment =>
              Boolean(value) &&
              typeof value === "object" &&
              typeof (value as CodexAttachment).id === "string",
          ) as CodexAttachment[])
        : [];
      return codex.startTurn(options.threadId, cwd, options.text, model, [], attachments);
    },
  );
  ipcMain.handle(
    "codex:list-threads",
    async (_event, options: { cwd?: unknown; search?: unknown; archived?: unknown }) => {
      const cwd = await requireDirectory(options.cwd);
      const projectWorktrees = await worktrees.list(cwd).catch(() => []);
      const directories = [...new Set([cwd, ...projectWorktrees.map((entry) => entry.path)])];
      const threads = await codex.listThreads(
        directories,
        typeof options.search === "string" ? options.search : undefined,
        options.archived === true,
      );
      return threads.filter(isCodexPrivateThread);
    },
  );
  ipcMain.handle("codex:read-thread", (_event, options: { threadId?: unknown }) =>
    codex.readThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:resume-thread", (_event, options: { threadId?: unknown }) =>
    codex.resumeThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:rename-thread", (_event, options: { threadId?: unknown; name?: unknown }) =>
    codex.renameThread(
      requireString(options.threadId, "会话 ID", 256),
      requireString(options.name, "会话名称", 120),
    ),
  );
  ipcMain.handle("codex:archive-thread", (_event, options: { threadId?: unknown }) =>
    codex.archiveThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:delete-thread", (_event, options: { threadId?: unknown }) =>
    codex.deleteThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:fork-thread", (_event, options: { threadId?: unknown }) =>
    codex.forkThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:compact-thread", (_event, options: { threadId?: unknown }) =>
    codex.compactThread(requireString(options.threadId, "会话 ID", 256)),
  );
  ipcMain.handle("codex:list-skills", async (_event, options: { cwd?: unknown }) =>
    codex.listSkills(await requireDirectory(options.cwd)),
  );
  ipcMain.handle("codex:list-mcp-servers", (_event, options: { threadId?: unknown }) =>
    codex.listMcpServers(typeof options.threadId === "string" ? options.threadId : undefined),
  );
  ipcMain.handle(
    "codex:create-worktree",
    async (_event, options: { cwd?: unknown; key?: unknown }) =>
      worktrees.create(
        await requireDirectory(options.cwd),
        requireString(options.key, "Worktree 标识", 64),
      ),
  );
  ipcMain.handle(
    "codex:remove-worktree",
    async (_event, options: { cwd?: unknown; path?: unknown }) => {
      const cwd = await requireDirectory(options.cwd);
      const path = requireString(options.path, "Worktree 路径", 4096);
      await worktrees.remove(cwd, path);
    },
  );
  ipcMain.handle(
    "codex:pick-attachments",
    async (_event, options: { cwd?: unknown }): Promise<CodexAttachment[]> => {
      const cwd = await requireDirectory(options.cwd);
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] })
        : await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
      if (result.canceled) return [];
      const sources = await Promise.all(
        result.filePaths.map(async (sourcePath) => ({ sourcePath, info: await stat(sourcePath) })),
      );
      const oversized = sources.find(({ info }) => info.size > 50 * 1024 * 1024);
      if (oversized) throw new Error(`${basename(oversized.sourcePath)} 超过 50 MiB 限制。`);
      if (sources.reduce((total, entry) => total + entry.info.size, 0) > 200 * 1024 * 1024) {
        throw new Error("单条消息附件总大小不能超过 200 MiB。");
      }
      await worktrees.ensureLocalExclude(cwd);
      const copiedTargets: string[] = [];
      try {
        const entries: CodexAttachment[] = [];
        for (const { sourcePath, info } of sources) {
          const extension = extname(sourcePath).toLowerCase();
          const image = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension);
          const mimeType = image
            ? extension === ".jpg" || extension === ".jpeg"
              ? "image/jpeg"
              : `image/${extension.slice(1)}`
            : "application/octet-stream";
          const attachmentDir = join(cwd, ".workteam", "attachments");
          await mkdir(attachmentDir, { recursive: true });
          const target = join(attachmentDir, `${randomUUID()}-${basename(sourcePath)}`);
          await copyFile(sourcePath, target);
          copiedTargets.push(target);
          entries.push({
            id: randomUUID(),
            name: basename(sourcePath),
            mimeType,
            size: info.size,
            kind: image ? ("image" as const) : ("file" as const),
            cwd,
            relativePath: relative(cwd, target),
            ...(image ? { dataUrl: await fileToDataUrl(sourcePath, mimeType) } : {}),
          });
        }
        return entries;
      } catch (error) {
        await Promise.all(copiedTargets.map((target) => rm(target, { force: true })));
        throw error;
      }
    },
  );
  ipcMain.handle(
    "codex:discard-attachment",
    async (_event, options: { cwd?: unknown; attachment?: unknown }) => {
      const cwd = await requireDirectory(options.cwd);
      const attachment = options.attachment as Partial<CodexAttachment> | undefined;
      if (!attachment || typeof attachment.relativePath !== "string") return;
      const attachmentRoot = resolve(cwd, ".workteam", "attachments");
      const target = resolve(cwd, attachment.relativePath);
      if (!target.startsWith(`${attachmentRoot}${sep}`)) {
        throw new Error("附件路径不在受控目录中。");
      }
      await rm(target, { force: true });
    },
  );
  ipcMain.handle(
    "codex:interrupt-turn",
    (_event, options: { threadId?: unknown; turnId?: unknown }) => {
      if (typeof options.threadId !== "string" || typeof options.turnId !== "string") {
        throw new Error("缺少要停止的 Codex turn。");
      }
      return codex.interruptTurn(options.threadId, options.turnId);
    },
  );
  ipcMain.handle(
    "codex:resolve-approval",
    (_event, options: { requestId?: unknown; decision?: unknown }) => {
      const decisions = new Set<ApprovalDecision>([
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ]);
      if (
        (typeof options.requestId !== "string" && typeof options.requestId !== "number") ||
        !decisions.has(options.decision as ApprovalDecision)
      ) {
        throw new Error("无效的审批结果。");
      }
      return codex.resolveApproval(
        options.requestId as RpcRequestId,
        options.decision as ApprovalDecision,
      );
    },
  );

  ipcMain.handle("agent-team:get-workspace", async (_event, options: { workspace?: unknown }) =>
    agentTeam.getWorkspace(await requireDirectory(options.workspace)),
  );
  ipcMain.handle(
    "agent-team:send-message",
    async (
      _event,
      options: {
        workspace?: unknown;
        roomId?: unknown;
        text?: unknown;
        model?: unknown;
        targetAgentIds?: unknown;
        agentAction?: unknown;
        transport?: unknown;
        externalId?: unknown;
      },
    ) => {
      const workspace = await requireDirectory(options.workspace);
      const text = requireString(options.text, "消息");
      const targetAgentIds = Array.isArray(options.targetAgentIds)
        ? options.targetAgentIds.filter((value): value is string => typeof value === "string")
        : undefined;
      return agentTeam.sendMessage({
        workspace,
        text,
        roomId: typeof options.roomId === "string" ? options.roomId : undefined,
        model: typeof options.model === "string" ? options.model : undefined,
        targetAgentIds,
        agentAction:
          options.agentAction === "propose-task" ? "propose-task" : ("chat" as AgentMessageAction),
        transport: options.transport === "openim" ? "openim" : "local",
        externalId: typeof options.externalId === "string" ? options.externalId : undefined,
      });
    },
  );
  ipcMain.handle(
    "agent-team:ingest-external-message",
    async (
      _event,
      options: {
        workspace?: unknown;
        message?: unknown;
        model?: unknown;
        targetAgentIds?: unknown;
        triggerAgents?: unknown;
        agentAction?: unknown;
      },
    ) => {
      const workspace = await requireDirectory(options.workspace);
      if (!options.message || typeof options.message !== "object") {
        throw new Error("OpenIM 消息格式无效。");
      }
      const raw = options.message as Record<string, unknown>;
      const message: ExternalTeamMessage = {
        externalId: requireString(raw.externalId, "消息 ID", 256),
        roomId: requireString(raw.roomId, "群组 ID", 256),
        senderId: requireString(raw.senderId, "发送者 ID", 256),
        senderName: requireString(raw.senderName, "发送者名称", 256),
        content: requireString(raw.content, "消息"),
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        runId: typeof raw.runId === "string" ? raw.runId : undefined,
        agentHop:
          typeof raw.agentHop === "number" && Number.isFinite(raw.agentHop)
            ? Math.max(0, Math.floor(raw.agentHop))
            : undefined,
        relayRootId:
          typeof raw.relayRootId === "string" && raw.relayRootId.trim()
            ? raw.relayRootId.trim().slice(0, 256)
            : undefined,
        loopId:
          typeof raw.loopId === "string" && raw.loopId.trim()
            ? raw.loopId.trim().slice(0, 256)
            : undefined,
        loopTurn:
          typeof raw.loopTurn === "number" && Number.isFinite(raw.loopTurn)
            ? Math.max(1, Math.floor(raw.loopTurn))
            : undefined,
        agentAction: raw.agentAction === "propose-task" ? "propose-task" : "chat",
      };
      return agentTeam.ingestExternalMessage({
        workspace,
        message,
        model: typeof options.model === "string" ? options.model : undefined,
        targetAgentIds: Array.isArray(options.targetAgentIds)
          ? options.targetAgentIds.filter((value): value is string => typeof value === "string")
          : undefined,
        triggerAgents: options.triggerAgents === true,
        agentAction: options.agentAction === "propose-task" ? "propose-task" : "chat",
      });
    },
  );
  ipcMain.handle("agent-team:stop-run", (_event, options: { runId?: unknown }) =>
    agentTeam.stopRun(requireString(options.runId, "run ID", 256)),
  );
  ipcMain.handle(
    "agent-team:promote-agents",
    async (_event, options: { workspace?: unknown; mappings?: unknown }) => {
      if (!Array.isArray(options.mappings) || options.mappings.length > 24) {
        throw new Error("Agent 云端映射格式无效。");
      }
      const mappings = options.mappings.map((value) => {
        if (!value || typeof value !== "object") throw new Error("Agent 云端映射格式无效。");
        const raw = value as Record<string, unknown>;
        return {
          localAgentId: requireString(raw.localAgentId, "本地 Agent ID", 64),
          cloudAgentId: requireString(raw.cloudAgentId, "云端 Agent ID", 64),
          openimUserId: requireString(raw.openimUserId, "Agent OpenIM ID", 128),
          version: typeof raw.version === "number" ? raw.version : 1,
        };
      });
      return agentTeam.promoteAgents(await requireDirectory(options.workspace), mappings);
    },
  );
  ipcMain.handle(
    "agent-team:control-loop",
    async (
      _event,
      options: { workspace?: unknown; loopId?: unknown; action?: unknown; model?: unknown },
    ) => {
      const actions = new Set(["pause", "resume", "cancel"]);
      if (!actions.has(String(options.action))) throw new Error("Loop 操作无效。");
      return agentTeam.controlLoop(
        await requireDirectory(options.workspace),
        requireString(options.loopId, "Loop ID", 256),
        options.action as "pause" | "resume" | "cancel",
        typeof options.model === "string" ? options.model : undefined,
      );
    },
  );
  ipcMain.handle(
    "agent-team:save-agents",
    async (_event, options: { workspace?: unknown; agents?: unknown }) => {
      const workspace = await requireDirectory(options.workspace);
      if (!Array.isArray(options.agents)) throw new Error("Agent 配置格式无效。");
      return agentTeam.saveAgents(workspace, options.agents as AgentDefinition[]);
    },
  );
  ipcMain.handle(
    "agent-team:save-humans",
    async (_event, options: { workspace?: unknown; humans?: unknown }) => {
      const workspace = await requireDirectory(options.workspace);
      if (!Array.isArray(options.humans)) throw new Error("好友列表格式无效。");
      return agentTeam.saveHumans(workspace, options.humans as HumanContact[]);
    },
  );
  ipcMain.handle(
    "agent-team:create-room",
    async (
      _event,
      options: { workspace?: unknown; name?: unknown; agentIds?: unknown; humanIds?: unknown },
    ) => {
      const workspace = await requireDirectory(options.workspace);
      const name = requireString(options.name, "群名称", 64);
      const agentIds = Array.isArray(options.agentIds)
        ? options.agentIds.filter((value): value is string => typeof value === "string")
        : [];
      const humanIds = Array.isArray(options.humanIds)
        ? options.humanIds.filter((value): value is string => typeof value === "string")
        : [];
      return agentTeam.createRoom(workspace, name, agentIds, humanIds);
    },
  );
  ipcMain.handle(
    "agent-team:update-room",
    async (
      _event,
      options: {
        workspace?: unknown;
        roomId?: unknown;
        name?: unknown;
        agentIds?: unknown;
        humanIds?: unknown;
      },
    ) => {
      const workspace = await requireDirectory(options.workspace);
      const roomId = requireString(options.roomId, "房间 ID", 256);
      const name = requireString(options.name, "群名称", 64);
      const agentIds = Array.isArray(options.agentIds)
        ? options.agentIds.filter((value): value is string => typeof value === "string")
        : [];
      const humanIds = Array.isArray(options.humanIds)
        ? options.humanIds.filter((value): value is string => typeof value === "string")
        : [];
      return agentTeam.updateRoom(workspace, roomId, name, agentIds, humanIds);
    },
  );
  ipcMain.handle(
    "agent-team:open-direct-room",
    async (_event, options: { workspace?: unknown; principalId?: unknown }) => {
      const workspace = await requireDirectory(options.workspace);
      const principalId = requireString(options.principalId, "联系人 ID", 256);
      return agentTeam.openDirectRoom(workspace, principalId);
    },
  );
  ipcMain.handle(
    "agent-team:update-task-status",
    async (_event, options: { workspace?: unknown; taskId?: unknown; status?: unknown }) => {
      const workspace = await requireDirectory(options.workspace);
      const taskId = requireString(options.taskId, "Task ID", 256);
      return agentTeam.updateTaskStatus(workspace, taskId, options.status as TaskStatus);
    },
  );
  ipcMain.handle(
    "agent-team:review-task",
    async (
      _event,
      options: {
        workspace?: unknown;
        taskId?: unknown;
        decision?: unknown;
        comment?: unknown;
      },
    ) => {
      const workspace = await requireDirectory(options.workspace);
      const taskId = requireString(options.taskId, "Task ID", 256);
      const decisions = new Set<TaskReviewDecision>(["approved", "changes_requested", "rejected"]);
      if (!decisions.has(options.decision as TaskReviewDecision)) {
        throw new Error("Task 审核结果无效。");
      }
      return agentTeam.reviewTask(
        workspace,
        taskId,
        options.decision as TaskReviewDecision,
        typeof options.comment === "string" ? options.comment : "",
      );
    },
  );
  ipcMain.handle(
    "agent-team:start-task",
    async (_event, options: { workspace?: unknown; taskId?: unknown; model?: unknown }) => {
      const workspace = await requireDirectory(options.workspace);
      const taskId = requireString(options.taskId, "Task ID", 256);
      return agentTeam.startTask(
        workspace,
        taskId,
        typeof options.model === "string" ? options.model : undefined,
      );
    },
  );

  ipcMain.handle("im:get-config", () => imConfig.getPublicConfig());
  ipcMain.handle("im:get-runtime-config", () =>
    imConfig.getRuntimeConfig(join(app.getPath("userData"), "openim-data")),
  );
  ipcMain.handle("im:save-config", (_event, value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("OpenIM 配置格式无效。");
    return imConfig.save(value as ImConfigInput);
  });

  ipcMain.handle("backend:get-state", () => backend.getState());
  ipcMain.handle("backend:configure", (_event, options: { apiUrl?: unknown }) =>
    backend.configure(requireString(options?.apiUrl, "后台地址", 2_048)),
  );
  ipcMain.handle("backend:register", async (_event, value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("注册信息格式无效。");
    const state = await backend.register(value as BackendRegisterInput);
    sendToRenderer("backend:event", { type: "auth.changed", authenticated: true });
    return state;
  });
  ipcMain.handle("backend:login", async (_event, value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("登录信息格式无效。");
    const state = await backend.login(value as BackendLoginInput);
    sendToRenderer("backend:event", { type: "auth.changed", authenticated: true });
    return state;
  });
  ipcMain.handle("backend:logout", async () => {
    const state = await backend.logout();
    remoteAgentHost.stop();
    agentTeam.clearRemoteWorkspaces();
    sendToRenderer("backend:event", { type: "auth.changed", authenticated: false });
    return state;
  });
  ipcMain.handle("backend:request", (_event, value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("后台请求格式无效。");
    return backend.request(value as BackendRequestInput);
  });
  ipcMain.handle("backend:get-im-runtime-config", () => backend.getImRuntimeConfig());
  ipcMain.handle("backend:sync-workspace", async (_event, options: { workspace?: unknown }) => {
    const workspace = await requireDirectory(options?.workspace);
    return agentTeam.mergeRemoteWorkspace(await backend.syncWorkspace(workspace));
  });
  ipcMain.handle("backend:start-host", async (_event, options: { workspace?: unknown }) =>
    remoteAgentHost.start(await requireDirectory(options?.workspace)),
  );
  ipcMain.handle("backend:stop-host", () => remoteAgentHost.stop());
  ipcMain.handle("backend:get-host-state", () => remoteAgentHost.getState());
  ipcMain.handle("backend:import-workspace", async (_event, options: { workspace?: unknown }) => {
    const workspace = await requireDirectory(options?.workspace);
    return backend.importWorkspace(await agentTeam.getWorkspace(workspace));
  });
};

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  imConfig = new ImConfigStore(imConfigPath(userDataPath));
  backend = new BackendClient(
    backendConfigPath(userDataPath),
    join(userDataPath, "openim-cloud-data"),
  );
  remoteAgentHost = new RemoteAgentHost(backend, codex);
  const publisher = new AgentGatewayPublisher(imConfig);
  agentTeam = new AgentTeamService(
    codex,
    join(userDataPath, "agent-team-rooms"),
    worktrees,
    (message, agent) => publisher.publish(message, agent),
  );
  registerIpc();
  codex.onEvent((event) => sendToRenderer("codex:event", event));
  agentTeam.onEvent((event) => sendToRenderer("agent-team:event", event));
  remoteAgentHost.onState((state) => sendToRenderer("backend:host-state", state));
  remoteAgentHost.onEvent((event) => sendToRenderer("backend:event", event));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  remoteAgentHost?.stop();
  openImSdk?.dispose();
  codex.dispose();
});
