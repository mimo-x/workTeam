import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { teamMessageAlignment } from "../src/renderer/src/team-message-layout";

import type { TeamMessage } from "../src/shared/agent-team";

const message = (senderId: string, senderType: TeamMessage["senderType"]): TeamMessage => ({
  id: `message-${senderId}`,
  workspace: "/tmp/workspace",
  roomId: "room",
  seq: 1,
  senderId,
  senderName: senderId,
  senderType,
  content: "hello",
  createdAt: 100,
  updatedAt: 100,
  status: "complete",
  transport: "openim",
});

test("BDD: only the current user's messages align to the end", () => {
  assert.equal(teamMessageAlignment(message("local_user", "user")), "end");
  assert.equal(
    teamMessageAlignment(message("friend_1", "user")),
    "start",
    "a friend's user message must not be mistaken for the current user",
  );
  assert.equal(teamMessageAlignment(message("agent_1", "agent")), "start");
  assert.equal(teamMessageAlignment(message("system", "system")), "center");
});

test("BDD: the shared group and direct message renderer uses identity-based alignment", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const MessageRow =");
  const end = source.indexOf("const Modal =", start);
  const messageRow = source.slice(start, end);

  assert.match(messageRow, /teamMessageAlignment\(message\)/);
  assert.doesNotMatch(messageRow, /message\.senderType === ["']user["']/);
});
