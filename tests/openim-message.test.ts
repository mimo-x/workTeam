import assert from "node:assert/strict";
import test from "node:test";

import { MessageType, SessionType } from "@openim/wasm-client-sdk";

import { buildFallbackTextMessage, normalizeMessage } from "../src/renderer/src/openim-message";
import { buildMentionCandidates, mentionedCandidates } from "../src/renderer/src/openim-mentions";

test("Given 原生消息工厂返回空字符串 When 发送好友私聊 Then 使用合法文本消息并保留元数据", () => {
  const message = normalizeMessage("", {
    text: "私聊回归消息",
    atUserIds: [],
    sessionType: SessionType.Single,
    platformId: 4,
  });
  message.ex = JSON.stringify({ agentAction: "chat" });

  assert.equal(message.contentType, MessageType.TextMessage);
  assert.equal(message.sessionType, SessionType.Single);
  assert.equal(message.textElem?.content, "私聊回归消息");
  assert.match(message.clientMsgID, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(message.ex), { agentAction: "chat" });
});

test("Given 群聊已有好友 When 输入 @ 并选择好友 Then 目标包含好友且不混入 Agent 路由", () => {
  const candidates = buildMentionCandidates(
    [
      {
        id: "agent-1",
        name: "程序员",
        title: "Agent",
        mention: "@程序员",
        initials: "程",
        description: "实现代码",
        theme: "cyan",
        visibility: "private",
        workspaceAccess: "write",
        ownerId: "local_user",
        executionLocation: "local",
        runtimeStatus: "ready",
        skillPolicy: "none",
        skillRefs: [],
      },
    ],
    [
      {
        id: "friend-1",
        name: "xuxin",
        initials: "xu",
        title: "好友",
        handle: "xuxin",
        openimUserId: "usr_friend_1",
        status: "online",
      },
    ],
  );
  const selected = mentionedCandidates(candidates, "@xuxin 请查收");

  assert.deepEqual(
    selected.map((candidate) => candidate.kind),
    ["human"],
  );
  assert.equal(selected[0]?.openimUserId, "usr_friend_1");
  assert.equal(selected[0]?.mention, "@xuxin");
});

test("Given @ 目标 When 构造回退消息 Then 使用 OpenIM at 文本类型", () => {
  const message = buildFallbackTextMessage({
    text: "@xuxin 请查收",
    atUserIds: ["usr_friend_1"],
    sessionType: SessionType.Group,
    platformId: 4,
  });

  assert.equal(message.contentType, MessageType.AtTextMessage);
  assert.deepEqual(message.atTextElem?.atUserList, ["usr_friend_1"]);
});
