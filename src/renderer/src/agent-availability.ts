import type { AgentDefinition } from "../../shared/agent-team";

export type AgentAvailabilityKind = "local_available" | "remote_online" | "no_host";

export type AgentAvailability = {
  kind: AgentAvailabilityKind;
  label: "本机可用" | "远程在线" | "暂无执行主机";
  detail: string;
  heartbeatLabel: string;
  executionLabel: "当前设备" | "远程主机";
  canMessage: boolean;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatAgentHeartbeat = (lastSeenAt?: number, now = Date.now()): string => {
  if (!lastSeenAt || !Number.isFinite(lastSeenAt) || lastSeenAt <= 0) {
    return "尚无心跳";
  }

  const elapsed = Math.max(0, now - lastSeenAt);
  if (elapsed < MINUTE_MS) {
    return "最后心跳 刚刚";
  }
  if (elapsed < HOUR_MS) {
    return `最后心跳 ${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  }
  if (elapsed < DAY_MS) {
    return `最后心跳 ${Math.floor(elapsed / HOUR_MS)} 小时前`;
  }

  const timestamp = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(lastSeenAt);
  return `最后心跳 ${timestamp}`;
};

export const agentAvailability = (agent: AgentDefinition, now = Date.now()): AgentAvailability => {
  const heartbeatLabel = formatAgentHeartbeat(agent.runtimeLastSeenAt, now);

  if (agent.ownerId === "local_user" && agent.executionLocation === "local") {
    return {
      kind: "local_available",
      label: "本机可用",
      detail: "由当前设备直接执行，不依赖远程心跳",
      heartbeatLabel,
      executionLabel: "当前设备",
      canMessage: true,
    };
  }

  if (agent.runtimeStatus === "online") {
    return {
      kind: "remote_online",
      label: "远程在线",
      detail: "远程执行主机已连接",
      heartbeatLabel,
      executionLabel: "远程主机",
      canMessage: true,
    };
  }

  return {
    kind: "no_host",
    label: "暂无执行主机",
    detail:
      agent.runtimeStatus === "offline" ? "最近连接的执行主机已离线" : "尚未发现可用的执行主机",
    heartbeatLabel,
    executionLabel: "远程主机",
    canMessage: false,
  };
};

export const splitAgentDirectory = (agents: AgentDefinition[]) => ({
  ownedAgents: agents.filter((agent) => agent.ownerId === "local_user"),
  publicAgents: agents.filter(
    (agent) => agent.ownerId !== "local_user" && agent.visibility === "public",
  ),
});
