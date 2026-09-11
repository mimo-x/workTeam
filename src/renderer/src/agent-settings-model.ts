import type { AgentDefinition } from "../../shared/agent-team";

export const MAX_LOCAL_AGENT_COUNT = 24;

export const createAgentDraft = (agentCount: number, now = Date.now()): AgentDefinition => {
  const suffix = now.toString(36);
  return {
    id: `agent_custom_${suffix}`,
    name: "新 Agent",
    title: "Custom Agent",
    mention: `@新Agent${agentCount + 1}`,
    initials: "新",
    theme: "cyan",
    description: "自定义 Agent 工作者",
    instructions: "你是协作群中的自定义 Agent。围绕自己的职责回答，不要替其他 Agent 发言。",
    workspaceAccess: "read",
    visibility: "private",
    ownerId: "local_user",
    executionLocation: "local",
    source: "local",
    runtime: { provider: "codex", protocol: "app-server", target: "local" },
    capabilities: ["chat", "stream_progress", "read_workspace"],
  };
};

export const appendAgentDraft = (agents: AgentDefinition[], now = Date.now()) => {
  const current = structuredClone(agents);
  if (current.filter((agent) => agent.ownerId === "local_user").length >= MAX_LOCAL_AGENT_COUNT) {
    return { agents: current, agent: undefined };
  }
  const agent = createAgentDraft(current.length, now);
  return { agents: [...current, agent], agent };
};

export const initialAgentSettingsState = (
  agents: AgentDefinition[],
  options: {
    initialAgentId?: string;
    createOnOpen?: boolean;
    now?: number;
  } = {},
) => {
  const current = structuredClone(agents);
  if (!options.createOnOpen) {
    return {
      agents: current,
      activeId: options.initialAgentId ?? current[0]?.id ?? "",
    };
  }
  const next = appendAgentDraft(current, options.now);
  return {
    agents: next.agents,
    activeId: next.agent?.id ?? options.initialAgentId ?? current[0]?.id ?? "",
  };
};
