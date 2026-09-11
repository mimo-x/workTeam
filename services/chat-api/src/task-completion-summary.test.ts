import assert from "node:assert/strict";
import test from "node:test";

import { taskSummaryMessageMetadata } from "./rooms.js";
import {
  aggregateTaskCompletionSummaries,
  formatTaskCompletionMessage,
} from "./task-completion-summary.js";

test("task summary metadata accepts only the whitelisted OpenIM extension", () => {
  const taskId = "4cf1db0b-1786-4ae1-889a-33adaf47d71f";
  assert.deepEqual(
    taskSummaryMessageMetadata({
      ex: JSON.stringify({
        kind: "task-summary",
        taskId,
        artifactRefs: ["reports/review.md", "reports/review.md", "/Users/alice/private/report.md"],
        privatePath: "/Users/alice/private",
      }),
    }),
    {
      kind: "task-summary",
      taskId,
      artifactRefs: ["reports/review.md", "[redacted-path]"],
    },
  );
  assert.deepEqual(
    taskSummaryMessageMetadata({
      ex: JSON.stringify({ kind: "task-summary", taskId: "not-a-uuid" }),
    }),
    {},
  );
  assert.deepEqual(taskSummaryMessageMetadata({ ex: "not-json" }), {});
});

test("backend summary aggregation and formatting use existing results without a model call", () => {
  const summary = aggregateTaskCompletionSummaries([
    { title: "实现", completion_summary: "功能已完成。" },
    { title: "复核", completion_summary: null },
  ]);
  assert.equal(summary, "- 实现：功能已完成。\n- 复核：已完成，但未提供文本摘要。");

  const message = formatTaskCompletionMessage({
    title: "登录实现",
    completionSummary: "检查 /Users/alice/private/login.ts，password=hunter2",
    artifactRefs: ["reports/login.md"],
  });
  assert.match(message, /\[redacted-path\]/);
  assert.match(message, /password=\[redacted\]/);
  assert.doesNotMatch(message, /alice|hunter2/);
});
