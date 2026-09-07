import type { AgentDefinition, TeamMessage } from "../shared/agent-team";
import { ImConfigStore } from "./im-config";

type GatewayResponse = {
  ok?: boolean;
  error?: string;
};

export class AgentGatewayPublisher {
  constructor(private readonly config: ImConfigStore) {}

  async publish(message: TeamMessage, agent: AgentDefinition) {
    if (message.transport !== "openim") return;
    const config = await this.config.getGatewayConfig();
    if (!config.gatewayUrl) throw new Error("尚未配置 Agent Gateway 地址。");
    if (!config.gatewaySecret) throw new Error("尚未配置 Agent Gateway 密钥。");

    const response = await fetch(`${config.gatewayUrl}/v1/agent-messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.gatewaySecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId: agent.id,
        senderOpenimId: agent.openimUserId ?? agent.id,
        senderName: agent.name,
        groupId: message.roomId,
        content: message.content,
        deliveryId: message.id,
        runId: message.runId,
        parentMessageId: message.replyTo,
        atUserIds: message.atUserIds ?? [],
        agentHop: message.agentHop ?? 1,
        relayRootId: message.relayRootId,
        loopId: message.loopId,
        loopTurn: message.loopTurn,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json().catch(() => ({}))) as GatewayResponse;
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || `Gateway 返回 HTTP ${response.status}`);
    }
  }
}
