import assert from "node:assert/strict";
import test from "node:test";

import { AgentGatewayPublisher } from "../src/main/agent-gateway";
import type { BackendClient } from "../src/main/backend-client";
import type { ImConfigStore } from "../src/main/im-config";
import type { BackendRequestInput } from "../src/shared/backend";
import type { AgentDefinition, TeamMessage, TeamRoomSnapshot } from "../src/shared/agent-team";

test("a backend-synced room publishes an Agent reply with the authenticated backend client", async () => {
  const requests: BackendRequestInput[] = [];
  const backend = {
    request: async (input: BackendRequestInput) => {
      requests.push(input);
      return { accepted: true };
    },
  } as unknown as BackendClient;
  const config = {
    getGatewayConfig: async () => {
      throw new Error("the legacy gateway must not be used for a backend room");
    },
  } as unknown as ImConfigStore;
  const publisher = new AgentGatewayPublisher(config, backend);
  const agent = {
    id: "57b3bab9-d044-43e7-bf8e-07df5a24e51a",
  } as AgentDefinition;
  const room = {
    roomId: "67aa59ad-e315-4f2f-b3f6-63f3216a863f",
    syncSource: "backend",
  } as TeamRoomSnapshot;
  const message = {
    id: "5f67bdd0-59fc-4d48-854b-cecfebfb15e6",
    content: "Agent 分析完成。",
    runId: "dbb7895c-08c3-4a7e-a86f-b42d567940fe",
    replyTo: "server-source-message",
    transport: "openim",
  } as TeamMessage;

  await publisher.publish(message, agent, room);

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/v1/rooms/67aa59ad-e315-4f2f-b3f6-63f3216a863f/agent-messages",
      body: {
        agentId: agent.id,
        content: message.content,
        deliveryId: message.id,
        runId: message.runId,
        parentMessageId: message.replyTo,
        agentHop: 1,
        relayRootId: undefined,
        loopId: undefined,
        loopTurn: undefined,
      },
    },
  ]);
});
