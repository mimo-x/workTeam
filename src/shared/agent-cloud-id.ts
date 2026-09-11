import type { AgentDefinition } from "./agent-team";
import { isUuid } from "./uuid";

// 后台 Agent 路径使用 UUID；本地 Agent 可以使用 agent_coder 一类的稳定 ID。
export const isCloudAgentId = (value: unknown): value is string => isUuid(value);

export const cloudAgentIdFor = (
  agent: Pick<AgentDefinition, "id" | "cloudAgentId" | "syncSource">,
) => {
  if (agent.cloudAgentId && isCloudAgentId(agent.cloudAgentId)) return agent.cloudAgentId.trim();
  if (agent.syncSource === "backend" && isCloudAgentId(agent.id)) return agent.id.trim();
  return undefined;
};

export const hasInvalidCloudAgentMapping = (agent: Pick<AgentDefinition, "cloudAgentId">) =>
  Boolean(agent.cloudAgentId && !isCloudAgentId(agent.cloudAgentId));
