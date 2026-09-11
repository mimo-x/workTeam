import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TaskCompletionCard } from "../src/renderer/src/task-completion-card";
import type { AgentTask } from "../src/shared/agent-team";
import {
  aggregateTaskCompletionSummaries,
  formatTaskCompletionMessage,
} from "../src/shared/task-completion-summary";

const task: AgentTask = {
  id: "task-summary",
  title: "读取桌面文件",
  objective: "读取并分析文件",
  expectedResult: "文件分析报告",
  plan: ["读取", "分析"],
  acceptanceCriteria: ["结果可复核"],
  requestedAccess: "read",
  creatorId: "local_user",
  sourceRoomId: "source-room",
  anchorMessageId: "anchor-message",
  anchorSeq: 1,
  taskRoomId: "task-room",
  assigneeIds: ["agent-reviewer"],
  status: "done",
  revision: 1,
  reviews: [],
  artifactRefs: ["reports/desktop-files.md"],
  completionSummary: "静态分析已完成。",
  contextVersion: 1,
  latestSourceSeq: 1,
  consumedContextVersionByAgent: {},
  contextEvents: [],
  runs: [],
  createdAt: 1,
  updatedAt: 2,
};

test("completion summaries aggregate child results deterministically", () => {
  assert.equal(
    aggregateTaskCompletionSummaries([
      { title: "实现", completionSummary: "登录流程已完成。" },
      { title: "复核", completionSummary: "未发现阻塞问题。" },
    ]),
    "- 实现：登录流程已完成。\n- 复核：未发现阻塞问题。",
  );
});

test("source-group completion messages redact host paths and credentials", () => {
  const message = formatTaskCompletionMessage({
    title: task.title,
    completionSummary:
      "读取 /Users/alice/Desktop/private/report.md，token=super-secret，分析已完成。",
    artifactRefs: ["reports/desktop-files.md", "/Users/alice/Desktop/private/output.md"],
  });
  assert.match(message, /Task「读取桌面文件」已验收完成/);
  assert.match(message, /\[redacted-path\]/);
  assert.match(message, /token=\[redacted\]/);
  assert.match(message, /reports\/desktop-files.md/);
  assert.doesNotMatch(message, /alice|super-secret/);
  assert.match(formatTaskCompletionMessage({ title: task.title }), /未提供文本摘要/);

  const markup = renderToStaticMarkup(
    <TaskCompletionCard
      task={task}
      artifactRefs={["/Users/alice/Desktop/private/output.md"]}
      onOpenTask={() => undefined}
    />,
  );
  assert.match(markup, /\[redacted-path\]/);
  assert.doesNotMatch(markup, /alice/);
});

test("Task completion card uses the accepted Task and artifact metadata", () => {
  const markup = renderToStaticMarkup(
    <TaskCompletionCard
      task={task}
      artifactRefs={["reports/desktop-files.md"]}
      onOpenTask={() => undefined}
    />,
  );
  assert.match(markup, /Task 已完成/);
  assert.match(markup, /读取桌面文件/);
  assert.match(markup, /reports\/desktop-files.md/);
  assert.match(markup, /查看 Task/);
  assert.match(markup, /data-testid="task-completion-card"/);
});
