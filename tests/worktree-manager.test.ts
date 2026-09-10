import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { WorktreeManager } from "../src/main/worktree-manager";

const execute = promisify(execFile);
const git = (cwd: string, args: string[]) => execute("git", ["-C", cwd, ...args]);

test("WorktreeManager creates, discovers, seeds, ignores, and removes an isolated worktree", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "workteam-worktree-"));
  const generatedRoot = join(dirname(workspace), ".workteam-worktrees", basename(workspace));
  const manager = new WorktreeManager();

  try {
    await git(workspace, ["init", "-b", "main"]);
    await git(workspace, ["config", "user.email", "test@workteam.local"]);
    await git(workspace, ["config", "user.name", "WorkTeam Test"]);
    await writeFile(join(workspace, "README.md"), "fixture\n");
    await git(workspace, ["add", "README.md"]);
    await git(workspace, ["commit", "-m", "fixture"]);
    await mkdir(join(workspace, ".workteam", "attachments"), { recursive: true });
    await writeFile(join(workspace, ".workteam", "attachments", "brief.txt"), "brief\n");

    const created = await manager.create(workspace, "task-review");
    assert.equal(
      await readFile(join(created.path, ".workteam", "attachments", "brief.txt"), "utf8"),
      "brief\n",
    );
    assert.ok((await manager.list(workspace)).some((entry) => entry.path === created.path));

    const commonDir = (await git(workspace, ["rev-parse", "--git-common-dir"])).stdout.trim();
    const gitDir = isAbsolute(commonDir) ? commonDir : join(workspace, commonDir);
    const exclude = await readFile(join(gitDir, "info", "exclude"), "utf8");
    assert.match(exclude, /^\.workteam\/$/mu);

    await manager.remove(workspace, created.path);
    await assert.rejects(stat(created.path));
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(generatedRoot, { recursive: true, force: true });
  }
});
