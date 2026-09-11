import assert from "node:assert/strict";
import test from "node:test";

import { MessageType, SessionType } from "@openim/wasm-client-sdk";

import {
  conversationListStorageKey,
  parseConversationListPreferences,
} from "../src/renderer/src/conversation-list";
import { buildFallbackTextMessage } from "../src/renderer/src/openim-message";
import { buildMentionCandidates, mentionedCandidates } from "../src/renderer/src/openim-mentions";
import { normalizeWorkspaceHistory } from "../src/renderer/src/workspace-history";

import type { AgentDefinition, HumanContact } from "../src/shared/agent-team";

const agent = (id: string, mention: string): AgentDefinition => ({
  id,
  name: id,
  title: "Agent",
  mention,
  initials: id.slice(0, 2),
  theme: "cyan",
  description: "BDD 测试 Agent",
  instructions: "完成测试任务",
  workspaceAccess: "read",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
});

const human = (id: string, handle: string): HumanContact => ({
  id,
  name: handle,
  initials: handle.slice(0, 2),
  title: "好友",
  handle,
  status: "online",
});

test("BDD: 应用恢复工作区历史时保留当前目录并忽略非法条目", () => {
  // Given: 本地历史中包含旧目录、空字符串、非字符串和当前目录。
  const stored = ["/repo/old", "", 42, "/repo/current"] as unknown[];

  // When: 应用用当前目录恢复工作区历史。
  const history = normalizeWorkspaceHistory("/repo/current", stored);

  // Then: 当前目录位于首位，非法条目被忽略，且重复目录只保留一次。
  assert.deepEqual(history, ["/repo/current", "/repo/old"]);
});

test("BDD: 会话列表偏好从持久化文本恢复时只接受有限时间戳", () => {
  // Given: 当前工作区的偏好文本混合了有效和非法值。
  const workspace = "/repo/demo";
  const raw = JSON.stringify({
    pinnedAt: { room_a: 100, room_b: "invalid" },
    hiddenThrough: { room_a: 200, room_b: Number.POSITIVE_INFINITY },
  });

  // When: 应用读取会话列表偏好。
  const preferences = parseConversationListPreferences(raw);

  // Then: 有效值被保留，非法值不会进入会话排序状态。
  assert.equal(conversationListStorageKey(workspace), "codex.team-conversation-list:/repo/demo");
  assert.deepEqual(preferences, {
    pinnedAt: { room_a: 100 },
    hiddenThrough: { room_a: 200 },
  });
});

test("BDD: 群聊输入提及时只选中被提及的 Agent 和好友", () => {
  // Given: 当前群包含两个 Agent、一个好友和本机用户。
  const candidates = buildMentionCandidates(
    [agent("planner", "@架构师"), agent("coder", "@程序员")],
    [human("friend_1", "xuxin"), human("local_user", "me")],
  );

  // When: 用户同时提及一个 Agent 和一个好友。
  const selected = mentionedCandidates(candidates, "@架构师 @xuxin 请协作");

  // Then: 路由目标只包含这两个成员，不包含未提及的 Agent 或本机用户。
  assert.deepEqual(
    selected.map((candidate) => [candidate.kind, candidate.id]),
    [
      ["agent", "planner"],
      ["human", "friend_1"],
    ],
  );
});

test("BDD: 私聊发送普通文本时创建普通 OpenIM 文本消息", () => {
  // Given: 用户在私聊输入一条普通文本，且没有 @ 目标。
  const text = "你好，今天的任务进展如何？";

  // When: 应用创建发送中的回退消息。
  const message = buildFallbackTextMessage({
    text,
    atUserIds: [],
    sessionType: SessionType.Single,
    platformId: 4,
  });

  // Then: 消息是私聊普通文本，并保留原始内容。
  assert.equal(message.contentType, MessageType.TextMessage);
  assert.equal(message.sessionType, SessionType.Single);
  assert.equal(message.textElem?.content, text);
  assert.equal(message.atTextElem, undefined);
});
