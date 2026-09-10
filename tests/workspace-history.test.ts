import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkspaceHistory,
  rememberWorkspace,
} from "../src/renderer/src/workspace-history";

test("keeps the active workspace visible and removes duplicates", () => {
  assert.deepEqual(
    normalizeWorkspaceHistory("/projects/current", ["/projects/old", "/projects/current"]),
    ["/projects/current", "/projects/old"],
  );
});

test("moves a reopened workspace to the front and keeps twelve entries", () => {
  const existing = Array.from({ length: 12 }, (_, index) => `/projects/${index}`);
  const updated = rememberWorkspace(existing, "/projects/8");

  assert.equal(updated[0], "/projects/8");
  assert.equal(updated.length, 12);
  assert.equal(new Set(updated).size, 12);
});

test("ignores malformed stored values", () => {
  assert.deepEqual(normalizeWorkspaceHistory("/projects/current", "not-an-array"), [
    "/projects/current",
  ]);
});
