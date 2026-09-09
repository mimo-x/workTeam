import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;

const record = (overrides = "") => `---
bug_id: BUG-20260909-001
status: fixed
openspec_change: bug-governance-workflow
tests:
  - tests/error.test.ts
commit: TBD
---
## 复现 Case
Given 前置条件
When 触发问题
Then 得到结果
${overrides}`;

test("BDD: complete bug record passes the governance gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bug-governance-pass-"));
  try {
    await writeFile(join(dir, "BUG-20260909-001.md"), record());
    const result = await run("node", ["scripts/validate-bug-governance.mjs"], {
      cwd: root,
      env: { ...process.env, BUG_GOVERNANCE_DIR: dir },
    });
    assert.match(result.stdout, /1 个 Bug 记录通过/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("BDD: missing test metadata fails with an actionable error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bug-governance-fail-"));
  try {
    await writeFile(join(dir, "BUG-20260909-001.md"), record().replace("tests:\n", ""));
    await assert.rejects(
      run("node", ["scripts/validate-bug-governance.mjs"], {
        cwd: root,
        env: { ...process.env, BUG_GOVERNANCE_DIR: dir },
      }),
      /缺少字段 tests/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
