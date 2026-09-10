import assert from "node:assert/strict";
import test from "node:test";

import { isCodexPrivateThread } from "../src/main/codex-thread-visibility";
import type { CodexThreadSummary } from "../src/shared/codex";

function thread(overrides: Partial<CodexThreadSummary>): CodexThreadSummary {
  return {
    id: "thread-1",
    name: "未命名会话",
    cwd: "/workspace",
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    ...overrides,
  };
}

test("keeps regular Codex conversations", () => {
  assert.equal(isCodexPrivateThread(thread({ preview: "请帮我修复登录页" })), true);
  assert.equal(isCodexPrivateThread(thread({ preview: "hi", source: "vscode" })), true);
});

test("hides newly tagged Agent Team execution threads", () => {
  assert.equal(isCodexPrivateThread(thread({ threadSource: "agent-team" })), false);
});

test("hides legacy Agent Team prompts without a thread source", () => {
  assert.equal(
    isCodexPrivateThread(
      thread({ preview: "你正在以 程序员（Coder）的身份参与群聊。\n\n用户的新消息：\nhi" }),
    ),
    false,
  );
  assert.equal(
    isCodexPrivateThread(
      thread({ preview: "你正在处理 Task「发布版本」。它来自主群「研发群」。" }),
    ),
    false,
  );
  assert.equal(
    isCodexPrivateThread(thread({ preview: '<agent-team-platform-agent name="Agent Team 平台">' })),
    false,
  );
});
