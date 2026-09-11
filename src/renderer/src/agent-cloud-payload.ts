import type { AgentDefinition } from "../../shared/agent-team";

const mentionPattern = /^@[\p{L}\p{N}_-]{2,40}$/u;

const validRuntimeEndpoint = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};

export const cloudAgentBody = (agent: AgentDefinition, runtimeToken = "") => ({
  name: agent.name,
  title: agent.title,
  mention: agent.mention,
  description: agent.description,
  instructions: agent.instructions,
  visibility: agent.visibility,
  workspaceAccess: agent.workspaceAccess,
  executionTarget: agent.executionLocation,
  provider: agent.runtime?.provider ?? "codex",
  protocol: agent.runtime?.protocol ?? "app-server",
  runtimeModel: agent.runtime?.model,
  runtimeEndpoint: agent.runtime?.endpoint,
  runtimeCommand: agent.runtime?.command,
  runtimeArgs: agent.runtime?.args ?? [],
  runtimeAuth: agent.runtime?.auth ?? "none",
  capabilities: agent.capabilities ?? [
    "chat",
    "stream_progress",
    "read_workspace",
    ...(agent.workspaceAccess === "write" ? ["write_workspace", "run_command"] : []),
  ],
  skillPolicy: agent.skillPolicy ?? "none",
  skillRefs: agent.skillRefs ?? [],
  secrets: runtimeToken ? { bearerToken: runtimeToken } : {},
});

export const cloudAgentUpdateBody = (agent: AgentDefinition, runtimeToken?: string) => {
  const { secrets: _secrets, ...body } = cloudAgentBody(agent);
  return runtimeToken === undefined ? body : { ...body, secrets: { bearerToken: runtimeToken } };
};

export const validateAgentForCloud = (agent: AgentDefinition, runtimeToken = "") => {
  const name = agent.name.trim();
  if (!name || name.length > 64) return "Agent 名称不能为空且不能超过 64 个字符。";
  if (!agent.title.trim() || agent.title.trim().length > 64) {
    return "Agent 角色不能为空且不能超过 64 个字符。";
  }
  if (!mentionPattern.test(agent.mention.trim())) {
    return "Agent 提及名称必须使用 @ 开头，并且只能包含中文、字母、数字、下划线或短横线。";
  }
  if (agent.description.trim().length > 500) return "Agent 简介不能超过 500 个字符。";
  if (!agent.instructions.trim() || agent.instructions.trim().length > 20_000) {
    return "Agent 角色指令不能为空且不能超过 20,000 个字符。";
  }
  if (agent.runtime?.endpoint !== undefined) {
    const endpoint = agent.runtime.endpoint.trim();
    if (endpoint.length > 2_048 || !validRuntimeEndpoint(endpoint)) {
      return "Runtime Endpoint 必须是 HTTPS 地址；本地开发只允许 localhost、127.0.0.1 或 [::1]。";
    }
  }
  if ((agent.runtime?.command?.length ?? 0) > 1_024) {
    return "Runtime 命令不能超过 1,024 个字符。";
  }
  if ((agent.runtime?.args?.length ?? 0) > 32) return "Runtime 参数最多 32 个。";
  if (agent.runtime?.args?.some((value) => value.length > 256)) {
    return "单个 Runtime 参数不能超过 256 个字符。";
  }
  if (
    agent.capabilities &&
    (agent.capabilities.length > 64 ||
      agent.capabilities.some((value) => {
        const normalized = value.trim();
        return normalized.length < 1 || normalized.length > 80;
      }))
  ) {
    return "Agent 能力配置不合法。";
  }
  if (agent.skillRefs && agent.skillRefs.length > 64) return "Skill 列表最多 64 项。";
  if (
    agent.skillRefs?.some(
      (skill) =>
        !skill.name.trim() || skill.name.trim().length > 80 || (skill.path?.length ?? 0) > 1_024,
    )
  ) {
    return "Skill 名称或路径不符合后台校验规则。";
  }
  if (runtimeToken.length > 20_000) return "Runtime Token 不能超过 20,000 个字符。";
  return undefined;
};
