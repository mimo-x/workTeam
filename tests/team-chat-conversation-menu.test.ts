import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hideConversation,
  orderVisibleConversations,
  setConversationPinned,
} from "../src/renderer/src/conversation-list";

import type { TeamRoomSnapshot } from "../src/shared/agent-team";

const room = (roomId: string, createdAt: number, updatedAt?: number): TeamRoomSnapshot => ({
  workspace: "/tmp/workspace",
  roomId,
  name: roomId,
  type: "direct",
  agentIds: [],
  humanIds: ["local_user"],
  createdAt,
  nextSeq: updatedAt ? 2 : 1,
  messages: updatedAt
    ? [
        {
          id: `message-${roomId}`,
          roomId,
          seq: 1,
          senderType: "user",
          senderId: "local_user",
          senderName: "我",
          content: "hello",
          createdAt: updatedAt,
          updatedAt,
          status: "completed",
        },
      ]
    : [],
});

test("BDD: a pinned conversation stays above a newer conversation", () => {
  const older = room("older", 100, 200);
  const newer = room("newer", 100, 300);

  const preferences = setConversationPinned(
    { pinnedAt: {}, hiddenThrough: {} },
    older.roomId,
    true,
    400,
  );
  const ordered = orderVisibleConversations([newer, older], preferences);

  assert.deepEqual(
    ordered.map((item) => item.roomId),
    ["older", "newer"],
  );
});

test("BDD: deleting a conversation hides it until a newer message arrives", () => {
  const existing = room("direct", 100, 200);
  const preferences = hideConversation({ pinnedAt: {}, hiddenThrough: {} }, existing);

  assert.deepEqual(orderVisibleConversations([existing], preferences), []);

  const revived = room("direct", 100, 201);
  assert.deepEqual(
    orderVisibleConversations([revived], preferences).map((item) => item.roomId),
    ["direct"],
  );
});

test("BDD: every Team Chat conversation exposes pin and delete context actions", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<ContextMenuTrigger/);
  assert.match(source, /取消置顶/);
  assert.match(source, /置顶会话/);
  assert.match(source, /删除会话/);
  assert.match(source, /<DialogTitle>删除会话<\/DialogTitle>/);
});
