import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("Given 渲染层调用 Codex 会话 API When 主进程注册 IPC Then 每个调用都有处理器", async () => {
  const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
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
    assert.match(source, new RegExp(`ipcMain\\.handle\\(\\"${channel}\\"`));
  }
});
