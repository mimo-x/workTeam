import { contextBridge, ipcRenderer } from "electron";
import "@openim/electron-client-sdk/preload";

import type { AgentTeamApi, ImDesktopApi, TeamEvent } from "../shared/agent-team";
import type { CodexDesktopApi, CodexEvent } from "../shared/codex";
import type { BackendDesktopApi } from "../shared/backend";

const api: CodexDesktopApi = {
  connect: () => ipcRenderer.invoke("codex:connect"),
  getStatus: () => ipcRenderer.invoke("codex:status"),
  chooseWorkspace: () => ipcRenderer.invoke("codex:choose-workspace"),
  login: () => ipcRenderer.invoke("codex:login"),
  startThread: (options) => ipcRenderer.invoke("codex:start-thread", options),
  startTurn: (options) => ipcRenderer.invoke("codex:start-turn", options),
  interruptTurn: (options) => ipcRenderer.invoke("codex:interrupt-turn", options),
  resolveApproval: (options) => ipcRenderer.invoke("codex:resolve-approval", options),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CodexEvent) => listener(payload);
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.removeListener("codex:event", handler);
  },
};

contextBridge.exposeInMainWorld("codex", api);

const agentTeam: AgentTeamApi = {
  getWorkspace: (options) => ipcRenderer.invoke("agent-team:get-workspace", options),
  sendMessage: (options) => ipcRenderer.invoke("agent-team:send-message", options),
  ingestExternalMessage: (options) =>
    ipcRenderer.invoke("agent-team:ingest-external-message", options),
  stopRun: (options) => ipcRenderer.invoke("agent-team:stop-run", options),
  promoteAgents: (options) => ipcRenderer.invoke("agent-team:promote-agents", options),
  controlLoop: (options) => ipcRenderer.invoke("agent-team:control-loop", options),
  saveAgents: (options) => ipcRenderer.invoke("agent-team:save-agents", options),
  getRuntimeCredentialStatus: (options) =>
    ipcRenderer.invoke("agent-team:get-runtime-credential-status", options),
  saveRuntimeCredential: (options) =>
    ipcRenderer.invoke("agent-team:save-runtime-credential", options),
  saveHumans: (options) => ipcRenderer.invoke("agent-team:save-humans", options),
  createRoom: (options) => ipcRenderer.invoke("agent-team:create-room", options),
  updateRoom: (options) => ipcRenderer.invoke("agent-team:update-room", options),
  openDirectRoom: (options) => ipcRenderer.invoke("agent-team:open-direct-room", options),
  updateTaskStatus: (options) => ipcRenderer.invoke("agent-team:update-task-status", options),
  reviewTask: (options) => ipcRenderer.invoke("agent-team:review-task", options),
  startTask: (options) => ipcRenderer.invoke("agent-team:start-task", options),
  onEvent: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, event: TeamEvent) => listener(event);
    ipcRenderer.on("agent-team:event", subscription);
    return () => ipcRenderer.removeListener("agent-team:event", subscription);
  },
};

const im: ImDesktopApi = {
  getConfig: () => ipcRenderer.invoke("im:get-config"),
  getRuntimeConfig: () => ipcRenderer.invoke("im:get-runtime-config"),
  saveConfig: (config) => ipcRenderer.invoke("im:save-config", config),
};

contextBridge.exposeInMainWorld("agentTeam", agentTeam);
contextBridge.exposeInMainWorld("im", im);

const backend: BackendDesktopApi = {
  getState: () => ipcRenderer.invoke("backend:get-state"),
  configure: (options) => ipcRenderer.invoke("backend:configure", options),
  register: (options) => ipcRenderer.invoke("backend:register", options),
  login: (options) => ipcRenderer.invoke("backend:login", options),
  logout: () => ipcRenderer.invoke("backend:logout"),
  request: (options) => ipcRenderer.invoke("backend:request", options),
  getImRuntimeConfig: () => ipcRenderer.invoke("backend:get-im-runtime-config"),
  syncWorkspace: (options) => ipcRenderer.invoke("backend:sync-workspace", options),
  importWorkspace: (options) => ipcRenderer.invoke("backend:import-workspace", options),
  startHost: (options) => ipcRenderer.invoke("backend:start-host", options),
  stopHost: () => ipcRenderer.invoke("backend:stop-host"),
  getHostState: () => ipcRenderer.invoke("backend:get-host-state"),
  onHostState: (listener) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      state: import("../shared/backend").RemoteAgentHostState,
    ) => listener(state);
    ipcRenderer.on("backend:host-state", subscription);
    return () => ipcRenderer.removeListener("backend:host-state", subscription);
  },
  onEvent: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) =>
      listener(payload);
    ipcRenderer.on("backend:event", subscription);
    return () => ipcRenderer.removeListener("backend:event", subscription);
  },
};

contextBridge.exposeInMainWorld("backend", backend);
