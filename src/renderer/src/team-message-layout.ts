import type { TeamMessage } from "../../shared/agent-team";

export type TeamMessageAlignment = "start" | "end" | "center";

export const teamMessageAlignment = (
  message: Pick<TeamMessage, "senderId" | "senderType">,
): TeamMessageAlignment => {
  if (message.senderType === "system") return "center";
  return message.senderId === "local_user" ? "end" : "start";
};
