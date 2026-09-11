import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseAgentChatRequest } from "../src/main/agent-chat-request";
import { locallyRoutableAgentIds } from "../src/renderer/src/cloud-agent-routing";
import type { AgentDefinition } from "../src/shared/agent-team";

const sourcePath = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);
const mainSourcePath = new URL("../src/main/index.ts", import.meta.url);

const agent = (
  values: Partial<AgentDefinition> & Pick<AgentDefinition, "id">,
): AgentDefinition => ({
  id: values.id,
  name: values.id,
  title: "Agent",
  mention: `@${values.id}`,
  initials: "A",
  theme: "violet",
  description: "",
  instructions: "",
  workspaceAccess: "read",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  ...values,
});

test("only owned local Agents are eligible for desktop routing", () => {
  assert.deepEqual(
    locallyRoutableAgentIds([
      agent({ id: "owned-local" }),
      agent({ id: "owned-hosted", executionLocation: "hosted" }),
      agent({ id: "other-local", ownerId: "another-user" }),
      agent({ id: "owned-local" }),
    ]),
    ["owned-local"],
  );
});

test("BDD: an owned local Agent mentioned in a cloud group is scheduled on this desktop", async () => {
  const source = await readFile(sourcePath, "utf8");
  const branchStart = source.indexOf(
    'if (connection.state === "connected" && room.syncSource === "backend" && room.externalId)',
  );
  const branchEnd = source.indexOf(
    '} else if (\n        connection.state === "connected" &&\n        room.type === "group"',
    branchStart,
  );

  assert.notEqual(branchStart, -1, "the cloud room send branch should exist");
  assert.notEqual(branchEnd, -1, "the cloud room send branch should have a stable boundary");
  const cloudRoomBranch = source.slice(branchStart, branchEnd);

  assert.match(cloudRoomBranch, /locallyRoutableAgentIds/);
  assert.match(cloudRoomBranch, /targetAgentIds:\s*localAgentIds/);
  assert.match(
    cloudRoomBranch,
    /triggerAgents:\s*agentAction\s*===\s*"chat"\s*&&\s*localAgentIds\.length\s*>\s*0/,
  );
  assert.match(cloudRoomBranch, /model,/);
});

test("BDD: Given Bob mentions Alice's Agent When the server targets it Then Alice's desktop schedules only that Agent", () => {
  const agents = [
    agent({ id: "alice-agent" }),
    agent({ id: "alice-other-agent" }),
    agent({ id: "bob-agent", ownerId: "bob" }),
  ];
  const request = parseAgentChatRequest(
    {
      type: "agent.chat.requested",
      roomId: "shared-room",
      serverMsgId: "server-message-1",
      senderUserId: "bob",
      senderName: "Bob",
      content: "@程序员 今天几号？",
      sentAt: "2026-09-11T08:22:00.000Z",
      agentAction: "chat",
      targetAgentIds: ["alice-agent", "bob-agent"],
    },
    agents,
    "alice",
  );

  assert.deepEqual(request, {
    message: {
      externalId: "server-message-1",
      roomId: "shared-room",
      senderId: "bob",
      senderName: "Bob",
      content: "@程序员 今天几号？",
      createdAt: Date.parse("2026-09-11T08:22:00.000Z"),
      agentAction: "chat",
    },
    targetAgentIds: ["alice-agent"],
  });
});

test("cross-user Agent chat requests reject self echoes, task proposals, and non-local targets", () => {
  const localAgent = agent({ id: "alice-agent" });
  const baseEvent = {
    type: "agent.chat.requested",
    roomId: "shared-room",
    serverMsgId: "server-message-1",
    senderUserId: "bob",
    senderName: "Bob",
    content: "@程序员 你好",
    sentAt: Date.now(),
    agentAction: "chat",
    targetAgentIds: [localAgent.id],
  };

  assert.equal(parseAgentChatRequest(baseEvent, [localAgent], "bob"), null);
  assert.equal(
    parseAgentChatRequest({ ...baseEvent, agentAction: "propose-task" }, [localAgent], "alice"),
    null,
  );
  assert.equal(
    parseAgentChatRequest({ ...baseEvent, targetAgentIds: ["unknown"] }, [localAgent], "alice"),
    null,
  );
});

test("desktop main process turns the targeted Host event into one exact external-message dispatch", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const eventStart = source.indexOf('if (event.type !== "agent.chat.requested") return;');
  const eventEnd = source.indexOf("createWindow();", eventStart);

  assert.notEqual(eventStart, -1);
  assert.notEqual(eventEnd, -1);
  const handler = source.slice(eventStart, eventEnd);
  assert.match(handler, /parseAgentChatRequest\(event, snapshot\.agents, auth\.user\.id\)/);
  assert.match(handler, /message:\s*request\.message/);
  assert.match(handler, /targetAgentIds:\s*request\.targetAgentIds/);
  assert.match(handler, /triggerAgents:\s*true/);
  assert.doesNotMatch(handler, /openImTransport/);
});
