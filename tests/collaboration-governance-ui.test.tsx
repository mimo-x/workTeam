import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  TaskInspector,
  redactGovernanceText,
} from "../src/renderer/src/collaboration-governance-panels";
import type { AgentTask, TeamWorkspaceSnapshot } from "../src/shared/agent-team";

const task = (overrides: Partial<AgentTask> = {}): AgentTask => ({
  id: "task-1",
  title: "实现群聊协作",
  objective: "让团队和 Agent 在群内工作",
  expectedResult: "可验收功能",
  plan: ["实现权限", "完成验证"],
  acceptanceCriteria: ["权限不越界"],
  requestedAccess: "write",
  requestedScopes: ["workspace.read", "workspace.write", "command.run"],
  creatorId: "local_user",
  sourceRoomId: "room-1",
  anchorMessageId: "message-1",
  anchorSeq: 1,
  taskRoomId: "task-room-1",
  rootTaskId: "task-1",
  depth: 0,
  assigneeIds: ["agent-1"],
  status: "pending_review",
  revision: 1,
  reviews: [],
  workspaceBinding: {
    id: "binding-1",
    hostUserId: "local_user",
    hostDeviceId: "private-device-id",
    label: "Agent Team",
    repositoryUrl: "github.com/example/agent-team",
    revision: 2,
    baselineScopes: ["workspace.read", "workspace.write", "command.run"],
    status: "online",
  },
  workspaceBindingRevision: 2,
  budget: { maxDepth: 3, maxDescendants: 12, maxRuns: 24, maxWallTimeMs: 1_800_000 },
  budgetUsage: { descendants: 1, runs: 2, startedAt: Date.now() - 1_000 },
  contextVersion: 1,
  latestSourceSeq: 1,
  consumedContextVersionByAgent: {},
  contextEvents: [],
  runs: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  syncSource: "backend",
  ...overrides,
});

const snapshot = (value: AgentTask): TeamWorkspaceSnapshot => ({
  workspace: "/Users/alice/private/agent-team",
  agents: [
    {
      id: "agent-1",
      name: "程序员",
      title: "Coder",
      mention: "@程序员",
      initials: "程",
      theme: "cyan",
      description: "实现功能",
      instructions: "实现功能",
      workspaceAccess: "write",
      visibility: "private",
      ownerId: "local_user",
      executionLocation: "local",
    },
  ],
  humans: [],
  rooms: [],
  tasks: [value],
  sessions: [],
  loops: [],
});

const handlers = {
  onOpenTask() {},
  onReview() {},
  onStart() {},
  onGrant() {},
  onComplete() {},
};

test("BDD: Task inspector renders role-aware governance controls", () => {
  const pending = task();
  const admin = renderToStaticMarkup(
    <TaskInspector task={pending} state={snapshot(pending)} role="admin" {...handlers} />,
  );
  const member = renderToStaticMarkup(
    <TaskInspector task={pending} state={snapshot(pending)} role="member" {...handlers} />,
  );
  const hostWaiting = task({ status: "waiting_for_permission", waitReason: "需要最小范围授权" });
  const host = renderToStaticMarkup(
    <TaskInspector
      task={hostWaiting}
      state={snapshot(hostWaiting)}
      role="member"
      currentUserId="local_user"
      {...handlers}
    />,
  );
  const nonHost = renderToStaticMarkup(
    <TaskInspector
      task={hostWaiting}
      state={snapshot(hostWaiting)}
      role="member"
      currentUserId="another-user"
      {...handlers}
    />,
  );

  assert.match(admin, /审核通过/);
  assert.doesNotMatch(member, /审核通过/);
  assert.match(member, /群主或管理员处理/);
  assert.match(host, /授权当前 Task 范围/);
  assert.doesNotMatch(nonHost, /授权当前 Task 范围/);
  assert.match(host, /Runs/);
  assert.doesNotMatch(host, /private-device-id/);
});

test("BDD: Task board hides governance actions from ordinary members", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );
  const board = source.slice(
    source.indexOf("const TaskBoard ="),
    source.indexOf("export const TeamChat"),
  );
  assert.match(board, /room\?\.memberRole === "owner"/);
  assert.match(board, /canAdmin && task\.status === "approved"/);
  assert.match(board, /canAdmin && task\.status === "review"/);
});

test("own messages use the compact governed-collaboration bubble", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /max-w-\[min\(32rem,68%\)\]/);
  assert.match(
    source,
    /rounded-xl rounded-tr-sm border border-primary\/15 bg-primary\/8 px-3 py-2/,
  );
  assert.doesNotMatch(source, /max-w-\[min\(40rem,76%\)\]/);
});

test("design system defines governed collaboration patterns and semantic tokens", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL("../app/design-system/_components/workteam-design-system.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /id="governance"/);
  assert.match(source, /双重授权/);
  assert.match(source, /Task tree 与预算/);
  assert.match(source, /电脑操作审批卡/);
  assert.match(source, /max-w-\[68%\]/);
  assert.match(css, /--governance-ready: var\(--success\)/);
  assert.match(css, /--governance-waiting: var\(--warning\)/);
  assert.match(css, /--governance-blocked: var\(--destructive\)/);
});

test("BDD: host binding setup documents path privacy and readiness states", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/collaboration-governance-panels.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /绝对路径仅加密保存在你的电脑上/);
  assert.match(source, /正在加载项目主机/);
  assert.match(source, /群里还没有项目主机/);
  assert.match(source, /binding\.repositoryUrl/);
  assert.doesNotMatch(source, /<[^>]+>\{workspace\}<\//);
});

test("BDD: approval cards expose exact constraints and no private details", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/collaboration-governance-panels.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /requestedConstraints/);
  assert.match(source, /命令：/);
  assert.match(source, /仅这一次/);
  assert.match(source, /本 Task/);
  const approvalCard = source.slice(
    source.indexOf("export function ApprovalInboxDialog"),
    source.indexOf("export function TaskGrantDialog"),
  );
  assert.doesNotMatch(approvalCard, /\.details|sessionId|providerRequestId|encryptedDetails/);
});

test("governance diagnostics redact paths and credentials before copy", () => {
  assert.equal(
    redactGovernanceText("cwd=/Users/alice/private token=super-secret"),
    "cwd=[本机路径] token=[已隐藏]",
  );
});
