import type { AgentDefinition, ExternalTeamMessage } from "../shared/agent-team";

export type ParsedAgentChatRequest = {
  message: ExternalTeamMessage;
  targetAgentIds: string[];
};

const requiredString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const timestamp = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

export const parseAgentChatRequest = (
  event: Record<string, unknown>,
  agents: AgentDefinition[],
  currentUserId: string,
): ParsedAgentChatRequest | null => {
  if (event.type !== "agent.chat.requested" || event.agentAction !== "chat") return null;
  const senderId = requiredString(event.senderUserId);
  const roomId = requiredString(event.roomId);
  const externalId = requiredString(event.serverMsgId);
  const content = requiredString(event.content);
  if (!senderId || senderId === currentUserId || !roomId || !externalId || !content) return null;

  const requestedIds = new Set(
    Array.isArray(event.targetAgentIds)
      ? event.targetAgentIds.filter(
          (value): value is string => typeof value === "string" && Boolean(value.trim()),
        )
      : [],
  );
  const targetAgentIds = [
    ...new Set(
      agents
        .filter(
          (agent) =>
            requestedIds.has(agent.id) &&
            agent.ownerId === "local_user" &&
            agent.executionLocation === "local",
        )
        .map((agent) => agent.id),
    ),
  ];
  if (!targetAgentIds.length) return null;

  return {
    message: {
      externalId,
      roomId,
      senderId,
      senderName: requiredString(event.senderName) || "群成员",
      content,
      createdAt: timestamp(event.sentAt),
      agentAction: "chat",
    },
    targetAgentIds,
  };
};
