import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Given 渲染层调用 Codex 会话 API When 主进程注册 IPC Then 每个调用都有处理器", async () => {
  const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const compactSource = source.replace(/\s+/g, "");
  for (const channel of [
    "codex:list-threads",
    "codex:read-thread",
    "codex:resume-thread",
    "codex:rename-thread",
    "codex:archive-thread",
    "codex:delete-thread",
    "codex:fork-thread",
    "codex:compact-thread",
    "codex:list-skills",
    "codex:list-mcp-servers",
    "codex:create-worktree",
    "codex:remove-worktree",
  ]) {
    assert.ok(
      compactSource.includes(`ipcMain.handle("${channel}"`),
      `${channel} should have an IPC handler`,
    );
  }
});
