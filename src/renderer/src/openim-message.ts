import { MessageStatus, MessageType, SessionType, type MessageItem } from "@openim/wasm-client-sdk";

export const buildFallbackTextMessage = (options: {
  text: string;
  atUserIds: string[];
  sessionType: SessionType;
  platformId: number;
}): MessageItem => {
  const now = Date.now();
  return {
    clientMsgID: globalThis.crypto.randomUUID(),
    createTime: now,
    sendTime: now,
    sessionType: options.sessionType,
    msgFrom: 0,
    contentType: options.atUserIds.length ? MessageType.AtTextMessage : MessageType.TextMessage,
    senderPlatformID: options.platformId,
    seq: 0,
    isRead: false,
    status: MessageStatus.Sending,
    ...(options.atUserIds.length
      ? { atTextElem: { text: options.text, atUserList: options.atUserIds } }
      : { textElem: { content: options.text } }),
  };
};

export const normalizeMessage = (
  value: unknown,
  options: Parameters<typeof buildFallbackTextMessage>[0],
): MessageItem =>
  value && typeof value === "object" ? (value as MessageItem) : buildFallbackTextMessage(options);
