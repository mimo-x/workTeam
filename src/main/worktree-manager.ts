import { spawn } from "node:child_process";
import { appendFile, cp, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type WorktreeInfo = {
  path: string;
  branch: string;
  baseRef: string;
  createdAt: number;
};

const runGit = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `git ${args.join(" ")} 失败。`));
    });
  });

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "run";
const canonicalPath = (path: string) => realpath(path).catch(() => resolve(path));

export class WorktreeManager {
  async list(workspace: string): Promise<WorktreeInfo[]> {
    const output = await runGit(workspace, ["worktree", "list", "--porcelain"]);
    return output
      .split(/\n\s*\n/u)
      .map((block) => {
        const fields = new Map(
          block.split("\n").map((line) => {
            const separator = line.indexOf(" ");
            return separator < 0
              ? [line, ""]
              : [line.slice(0, separator), line.slice(separator + 1)];
          }),
        );
        const path = fields.get("worktree");
        if (!path) return null;
        return {
          path,
          branch: String(fields.get("branch") ?? "").replace(/^refs\/heads\//u, ""),
          baseRef: fields.get("HEAD") ?? "",
          createdAt: 0,
        } satisfies WorktreeInfo;
      })
      .filter((entry): entry is WorktreeInfo => Boolean(entry));
  }

  async ensureLocalExclude(workspace: string) {
    const commonDir = await runGit(workspace, ["rev-parse", "--git-common-dir"]).catch(() => "");
    if (!commonDir) return;
    const gitDir = isAbsolute(commonDir) ? commonDir : resolve(workspace, commonDir);
    const excludePath = join(gitDir, "info", "exclude");
    await mkdir(dirname(excludePath), { recursive: true });
    const current = await readFile(excludePath, "utf8").catch(() => "");
    if (!current.split("\n").some((line) => line.trim() === ".workteam/")) {
      await appendFile(
        excludePath,
        `${current && !current.endsWith("\n") ? "\n" : ""}.workteam/\n`,
      );
    }
  }

  async create(workspace: string, key: string): Promise<WorktreeInfo> {
    const inside = await runGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") throw new Error("Worktree 仅支持 Git 项目。请先初始化并提交项目。");
    const baseRef = await runGit(workspace, ["rev-parse", "HEAD"]);
    const id = safeSegment(key);
    const root = join(dirname(workspace), ".workteam-worktrees", safeSegment(basename(workspace)));
    const requestedPath = join(root, id);
    const branch = `workteam/${id}`;
    await mkdir(root, { recursive: true });
    try {
      await runGit(workspace, ["worktree", "add", "-b", branch, requestedPath, baseRef]);
    } catch (error) {
      // A previous app session may already own this worktree. Reuse only when Git confirms it.
      const known = await this.list(workspace).catch(() => []);
      const expectedPath = await canonicalPath(requestedPath);
      if (!known.some((worktree) => resolve(worktree.path) === expectedPath)) throw error;
    }
    const path = await canonicalPath(requestedPath);
    const sourceAttachments = join(workspace, ".workteam", "attachments");
    if (
      await stat(sourceAttachments)
        .then((info) => info.isDirectory())
        .catch(() => false)
    ) {
      await cp(sourceAttachments, join(path, ".workteam", "attachments"), { recursive: true });
    }
    await this.ensureLocalExclude(path);
    return { path, branch, baseRef, createdAt: Date.now() };
  }

  async remove(workspace: string, path: string) {
    const worktrees = await this.list(workspace);
    const targetPath = await canonicalPath(path);
    const target = worktrees.find((worktree) => resolve(worktree.path) === targetPath);
    const primary = worktrees[0];
    if (!target || !primary || targetPath === resolve(primary.path)) {
      throw new Error("只能移除当前 Git 项目中已登记的附属 Worktree。");
    }
    await runGit(workspace, ["worktree", "remove", "--force", target.path]);
    await runGit(workspace, ["worktree", "prune"]);
  }
}
