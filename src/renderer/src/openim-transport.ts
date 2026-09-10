import { getWithRenderProcess } from "@openim/electron-client-sdk/render";
import {
  LogLevel,
  MessageViewType,
  SdkEvent,
  SessionType,
  type MessageItem,
  type SdkResponse,
} from "@openim/wasm-client-sdk";

import type {
  AgentMessageAction,
  ExternalTeamMessage,
  ImRuntimeConfig,
} from "../../shared/agent-team";
import { normalizeMessage } from "./openim-message";

export type OpenImConnectionState = {
  state: "local" | "connecting" | "connected" | "error";
  error?: string;
};

const { instance: sdk } = getWithRenderProcess();

const parseMessageMetadata = (value?: string) => {
  if (!value) return {} as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
};

const textContent = (message: MessageItem) => {
  if (message.textElem?.content) return message.textElem.content;
  if (message.atTextElem?.text) return message.atTextElem.text;
  if (message.advancedTextElem?.text) return message.advancedTextElem.text;
  if (message.customElem?.data) {
    try {
      const data = JSON.parse(message.customElem.data) as Record<string, unknown>;
      if (typeof data.content === "string") return data.content;
    } catch {
      return message.customElem.data;
    }
  }
  return "";
};

export const toExternalMessage = (
  message: MessageItem,
  fallback: { groupId: string; userId?: string; userName?: string; directPrincipalId?: string },
): ExternalTeamMessage | null => {
  const content = textContent(message).trim();
  const externalId = message.serverMsgID || message.clientMsgID;
  if (!content || !externalId) return null;
  const isDirect =
    message.sessionType === SessionType.Single || Boolean(fallback.directPrincipalId);
  const principalId = isDirect
    ? (fallback.directPrincipalId ??
      (message.sendID === fallback.userId ? message.recvID : message.sendID))
    : undefined;
  const sentByLocalUser = Boolean(fallback.userId && message.sendID === fallback.userId);
  const metadata = parseMessageMetadata(message.ex);
  return {
    externalId,
    roomId: message.groupID || principalId || fallback.groupId,
    conversationType: isDirect ? "direct" : "group",
    principalId,
    senderId: sentByLocalUser ? "local_user" : message.sendID || fallback.userId || "unknown_user",
    senderName: sentByLocalUser
      ? (fallback.userName ?? "我")
      : message.senderNickname || message.sendID || "群成员",
    content,
    createdAt: message.sendTime || message.createTime || Date.now(),
    runId: typeof metadata.runId === "string" ? metadata.runId : undefined,
    agentHop:
      typeof metadata.agentHop === "number" && Number.isFinite(metadata.agentHop)
        ? Math.max(0, Math.floor(metadata.agentHop))
        : undefined,
    relayRootId:
      typeof metadata.relayRootId === "string" && metadata.relayRootId
        ? metadata.relayRootId
        : undefined,
    loopId: typeof metadata.loopId === "string" && metadata.loopId ? metadata.loopId : undefined,
    loopTurn:
      typeof metadata.loopTurn === "number" && Number.isFinite(metadata.loopTurn)
        ? Math.max(1, Math.floor(metadata.loopTurn))
        : undefined,
    agentAction: metadata.agentAction === "propose-task" ? "propose-task" : "chat",
  };
};

class OpenImTransport {
  private connectedKey = "";
  private connecting: Promise<void> | null = null;
  private initialized = false;
  private config: ImRuntimeConfig | null = null;
  private messageListeners = new Set<(message: ExternalTeamMessage) => void>();
  private statusListeners = new Set<(status: OpenImConnectionState) => void>();
  private status: OpenImConnectionState = { state: "local" };

  constructor() {
    sdk.on(SdkEvent.OnConnectSuccess, () => this.setStatus({ state: "connected" }));
    sdk.on(SdkEvent.OnConnecting, () => this.setStatus({ state: "connecting" }));
    sdk.on(SdkEvent.OnConnectFailed, (response) =>
      this.setStatus({ state: "error", error: response.errMsg || "OpenIM 连接失败。" }),
    );
    sdk.on(SdkEvent.OnKickedOffline, () =>
      this.setStatus({ state: "error", error: "OpenIM 账号已在其他设备登录。" }),
    );
    sdk.on(SdkEvent.OnUserTokenExpired, () =>
      this.setStatus({ state: "error", error: "OpenIM 用户 Token 已过期。" }),
    );
    sdk.on(SdkEvent.OnRecvNewMessages, (response: SdkResponse<MessageItem[]>) => {
      const config = this.config;
      if (!config) return;
      for (const item of response.data ?? []) {
        if (config.groupId && item.groupID && item.groupID !== config.groupId) continue;
        const message = toExternalMessage(item, {
          groupId: config.groupId,
          userId: config.userId,
          userName: "我",
        });
        if (message) this.emitMessage(message);
      }
    });
    sdk.on(SdkEvent.OnRecvNewMessage, (response: SdkResponse<MessageItem>) => {
      const config = this.config;
      if (!config || !response.data) return;
      if (config.groupId && response.data.groupID && response.data.groupID !== config.groupId)
        return;
      const message = toExternalMessage(response.data, {
        groupId: config.groupId,
        userId: config.userId,
        userName: "我",
      });
      if (message) this.emitMessage(message);
    });
  }

  getStatus() {
    return this.status;
  }

  onStatus(listener: (status: OpenImConnectionState) => void) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onMessage(listener: (message: ExternalTeamMessage) => void) {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  async connect(config: ImRuntimeConfig) {
    const key = [config.apiAddr, config.wsAddr, config.userId, config.groupId].join("\u0000");
    if (this.connectedKey === key && this.status.state === "connected") return;
    if (this.connecting) return this.connecting;
    if (!config.apiAddr || !config.wsAddr || !config.userId || !config.userToken) {
      if (this.initialized) {
        await sdk.logout().catch(() => undefined);
        await sdk.unInitSDK().catch(() => undefined);
      }
      this.initialized = false;
      this.connectedKey = "";
      this.config = null;
      this.setStatus({ state: "local" });
      return;
    }

    this.connecting = (async () => {
      this.setStatus({ state: "connecting" });
      if (this.initialized && this.connectedKey !== key) {
        await sdk.logout().catch(() => undefined);
        await sdk.unInitSDK().catch(() => undefined);
        this.initialized = false;
      }
      this.config = config;
      if (!this.initialized) {
        await sdk.initSDK({
          apiAddr: config.apiAddr,
          wsAddr: config.wsAddr,
          platformID: config.platformId,
          dataDir: config.dataDir,
          systemType: "electron",
          logLevel: LogLevel.Warn,
          isLogStandardOutput: false,
        });
        this.initialized = true;
      }
      await sdk.login({ userID: config.userId, token: config.userToken });
      this.connectedKey = key;
      this.setStatus({ state: "connected" });
    })()
      .catch((error) => {
        this.setStatus({
          state: "error",
          error:
            error && typeof error === "object" && "errMsg" in error
              ? String(error.errMsg)
              : error instanceof Error
                ? error.message
                : String(error),
        });
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async sendText(
    text: string,
    directPrincipalId?: string,
    groupId?: string,
    targetOpenimIds: string[] = [],
    metadata: { agentAction?: AgentMessageAction } = {},
  ) {
    if (!this.config || this.status.state !== "connected") throw new Error("OpenIM 尚未连接。");
    const sessionType = directPrincipalId ? SessionType.Single : SessionType.Group;
    const created = targetOpenimIds.length
      ? await sdk.createTextAtMessage({ text, atUserIDList: targetOpenimIds })
      : await sdk.createTextMessage(text);
    const outgoing = normalizeMessage(created.data, {
      text,
      atUserIds: targetOpenimIds,
      sessionType,
      platformId: this.config.platformId,
    });
    outgoing.ex = JSON.stringify({
      ...parseMessageMetadata(outgoing.ex),
      agentAction: metadata.agentAction ?? "chat",
      targetAgentIds: targetOpenimIds,
    });
    const targetGroupId = directPrincipalId ? "" : groupId || this.config.groupId;
    if (!directPrincipalId && !targetGroupId) throw new Error("当前会话没有 OpenIM 群组 ID。");
    const sent = await sdk.sendMessage({
      recvID: directPrincipalId ?? "",
      groupID: targetGroupId,
      message: outgoing,
    });
    const message = toExternalMessage(sent.data, {
      groupId: targetGroupId,
      userId: this.config.userId,
      userName: "我",
      directPrincipalId,
    });
    if (!message) throw new Error("OpenIM 没有返回可识别的消息。");
    return message;
  }

  async loadHistory(groupId = this.config?.groupId ?? "", limit = 50) {
    if (!this.config || this.status.state !== "connected") return [];
    if (!groupId) return [];
    const conversation = await sdk.getOneConversation({
      sourceID: groupId,
      sessionType: SessionType.Group,
    });
    const history = await sdk.getAdvancedHistoryMessageList({
      count: limit,
      viewType: MessageViewType.History,
      startClientMsgID: "",
      conversationID: conversation.data.conversationID,
    });
    return (history.data.messageList ?? [])
      .map((item) =>
        toExternalMessage(item, {
          groupId,
          userId: this.config!.userId,
          userName: "我",
        }),
      )
      .filter((item): item is ExternalTeamMessage => Boolean(item));
  }

  async loadDirectHistory(principalId: string, limit = 50) {
    if (!this.config || this.status.state !== "connected") return [];
    const conversation = await sdk.getOneConversation({
      sourceID: principalId,
      sessionType: SessionType.Single,
    });
    const history = await sdk.getAdvancedHistoryMessageList({
      count: limit,
      viewType: MessageViewType.History,
      startClientMsgID: "",
      conversationID: conversation.data.conversationID,
    });
    return (history.data.messageList ?? [])
      .map((item) =>
        toExternalMessage(item, {
          groupId: this.config!.groupId,
          userId: this.config!.userId,
          userName: "我",
          directPrincipalId: principalId,
        }),
      )
      .filter((item): item is ExternalTeamMessage => Boolean(item));
  }

  private emitMessage(message: ExternalTeamMessage) {
    for (const listener of this.messageListeners) listener(message);
  }

  private setStatus(status: OpenImConnectionState) {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const openImTransport = new OpenImTransport();
