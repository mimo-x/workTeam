import type { AgentCapability, AgentDefinition } from "./agent-team";

export type CloudRoomAgentSummary = {
  id: string;
  ownerId: string;
  openimUserId: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  visibility: "private" | "public";
  executionTarget: "local" | "hosted";
  provider: string;
  protocol: string;
  runtimeModel?: string | null;
  runtimeEndpoint?: string | null;
  runtimeAuth?: "bearer" | "none";
  capabilities?: AgentCapability[];
  runtimeStatus?: "online" | "offline" | "unknown";
  runtimeLastSeenAt?: string | number | null;
  version: number;
};

const themes: AgentDefinition["theme"][] = ["cyan", "violet", "amber", "emerald"];

const themeFor = (value: string) =>
  themes[
    [...value].reduce((total, character) => total + character.charCodeAt(0), 0) % themes.length
  ];

const optionalTimestamp = (value: string | number | null | undefined) => {
  const parsed = typeof value === "number" ? value : Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
};

const definitionFromRoomSummary = (
  agent: CloudRoomAgentSummary,
  currentUserId: string,
): AgentDefinition => ({
  id: agent.id,
  cloudAgentId: agent.id,
  name: agent.name,
  title: agent.title,
  mention: agent.mention,
  initials: agent.name.slice(0, 2) || "AI",
  theme: themeFor(agent.id),
  description: agent.description,
  instructions: `你是 ${agent.name}（${agent.title}）。请根据群聊中的请求提供帮助。`,
  workspaceAccess: "read",
  visibility: agent.visibility,
  ownerId: agent.ownerId === currentUserId ? "local_user" : agent.ownerId,
  executionLocation: agent.executionTarget,
  source: "registry",
  runtime: {
    provider: agent.provider,
    protocol: agent.protocol,
    target: agent.executionTarget,
    model: agent.runtimeModel ?? undefined,
    endpoint: agent.runtimeEndpoint ?? undefined,
    auth: agent.runtimeAuth ?? "none",
  },
  capabilities: agent.capabilities ?? ["chat", "read_workspace"],
  runtimeStatus: agent.runtimeStatus ?? "unknown",
  runtimeLastSeenAt: optionalTimestamp(agent.runtimeLastSeenAt),
  openimUserId: agent.openimUserId,
  skillPolicy: "none",
  skillRefs: [],
  version: agent.version,
  syncSource: "backend",
});

export const mergeRoomAgentsIntoDirectory = (
  directoryAgents: AgentDefinition[],
  roomAgents: CloudRoomAgentSummary[],
  currentUserId: string,
) => {
  const merged = [...directoryAgents];
  const knownIds = new Set(directoryAgents.map((agent) => agent.id));
  for (const roomAgent of roomAgents) {
    if (knownIds.has(roomAgent.id)) continue;
    merged.push(definitionFromRoomSummary(roomAgent, currentUserId));
    knownIds.add(roomAgent.id);
  }
  return merged;
};
