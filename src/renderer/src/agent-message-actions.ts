import type { AgentDefinition, TeamMessage } from "../../shared/agent-team";

export const canRetryAgentReply = (options: {
  reply: TeamMessage;
  replyTarget?: TeamMessage;
  executionLocation?: AgentDefinition["executionLocation"];
  belongsToLoop: boolean;
}) => {
  const { reply, replyTarget, executionLocation, belongsToLoop } = options;
  return (
    reply.senderType === "agent" &&
    ["complete", "error", "cancelled"].includes(reply.status) &&
    replyTarget?.senderType === "user" &&
    !reply.taskId &&
    !reply.loopId &&
    !replyTarget.taskId &&
    replyTarget.agentAction !== "propose-task" &&
    executionLocation === "local" &&
    !belongsToLoop
  );
};
