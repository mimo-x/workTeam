import type { AgentDefinition } from "../../shared/agent-team";

export const locallyRoutableAgentIds = (agents: AgentDefinition[]) => [
  ...new Set(
    agents
      .filter((agent) => agent.ownerId === "local_user" && agent.executionLocation === "local")
      .map((agent) => agent.id),
  ),
];
