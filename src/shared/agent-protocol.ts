import type { AgentCapability } from "./agent-team";

export const CUSTOM_AGENT_PROTOCOL_VERSION = 1 as const;

export type CustomAgentTransport = "http" | "cli-jsonl";

export type CustomAgentManifest = {
  protocolVersion: typeof CUSTOM_AGENT_PROTOCOL_VERSION;
  agentId: string;
  name: string;
  version: string;
  capabilities: AgentCapability[];
  transport: CustomAgentTransport;
  endpoint?: string;
  command?: string;
  args?: string[];
  auth?: "bearer" | "none";
};

export type CustomAgentEvent = {
  type:
    | "session.started"
    | "message.delta"
    | "message.completed"
    | "activity"
    | "approval.requested"
    | "turn.completed"
    | "turn.failed";
  sessionId?: string;
  turnId?: string;
  data?: Record<string, unknown>;
};

export const parseCustomAgentManifest = (value: unknown): CustomAgentManifest => {
  if (!value || typeof value !== "object") throw new Error("Agent Manifest 必须是对象。");
  const record = value as Record<string, unknown>;
  const protocolVersion = Number(record.protocolVersion);
  if (protocolVersion !== CUSTOM_AGENT_PROTOCOL_VERSION) {
    throw new Error(`不支持的 Agent 协议版本：${String(record.protocolVersion ?? "")}。`);
  }
  const requiredString = (key: string, max = 256) => {
    const result = String(record[key] ?? "").trim();
    if (!result || result.length > max) throw new Error(`Agent Manifest 字段无效：${key}。`);
    return result;
  };
  const transport =
    record.transport === "http" || record.transport === "cli-jsonl" ? record.transport : null;
  if (!transport) throw new Error("Agent Manifest transport 必须是 http 或 cli-jsonl。");
  const capabilities = Array.isArray(record.capabilities)
    ? [
        ...new Set(
          record.capabilities
            .map(String)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (transport === "http" && !String(record.endpoint ?? "").trim()) {
    throw new Error("HTTP Agent Manifest 缺少 endpoint。");
  }
  if (transport === "cli-jsonl" && !String(record.command ?? "").trim()) {
    throw new Error("CLI Agent Manifest 缺少 command。");
  }
  return {
    protocolVersion: CUSTOM_AGENT_PROTOCOL_VERSION,
    agentId: requiredString("agentId", 128),
    name: requiredString("name", 128),
    version: requiredString("version", 64),
    capabilities,
    transport,
    endpoint: transport === "http" ? requiredString("endpoint", 2_048) : undefined,
    command: transport === "cli-jsonl" ? requiredString("command", 1_024) : undefined,
    args:
      transport === "cli-jsonl" && Array.isArray(record.args)
        ? record.args
            .map(String)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 32)
        : undefined,
    auth: record.auth === "none" ? "none" : "bearer",
  };
};
