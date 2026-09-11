import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AgentDefinition } from "../src/shared/agent-team";
import {
  appendAgentDraft,
  initialAgentSettingsState,
} from "../src/renderer/src/agent-settings-model";

const sourcePath = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);

const agent = (id: string, ownerId = "local_user"): AgentDefinition => ({
  id,
  name: id,
  title: "Agent",
  mention: `@${id}`,
  initials: "A",
  theme: "cyan",
  description: "test agent",
  instructions: "执行测试职责并报告结果。",
  workspaceAccess: "read",
  visibility: "private",
  ownerId,
  executionLocation: "local",
});

const extractView = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should exist`);
  return source.slice(start, end);
};

test("BDD: 用户从通讯录点击创建 Agent 时直接进入新 Agent 草稿", async () => {
  // Given: 用户进入通讯录，并准备创建一个新的 Agent。
  const source = await readFile(sourcePath, "utf8");
  const contactsView = extractView(source, "const ContactsView =", "const TaskBoard =");
  const agentSettings = extractView(source, "const AgentSettings =", "const ContactSettings =");
  const contactsRoute = extractView(source, 'if (view === "contacts")', 'if (view === "tasks")');

  // When: 用户点击通讯录外层的创建入口。
  // Then: 弹窗必须以创建模式打开，并直接选中新 Agent 草稿。
  assert.match(contactsView, /onCreateAgent/);
  assert.match(contactsRoute, /setCreateAgentOnOpen\(true\)/);
  assert.match(contactsRoute, /createOnOpen=\{createAgentOnOpen\}/);
  assert.match(contactsView, /<PlusIcon data-icon="inline-start" \/>[\s\S]*创建 Agent/);
  assert.match(agentSettings, /const addAgent = \(\) =>/);
  assert.match(
    agentSettings,
    /initialAgentSettingsState\(agents, \{ initialAgentId, createOnOpen \}\)/,
  );
  assert.match(agentSettings, /setDrafts\(next\.agents\)/);
  assert.match(agentSettings, /<Button[^>]+onClick=\{addAgent\}[\s\S]*创建 Agent/);
  assert.match(agentSettings, /onClick=\{\(\) => void save\(\)\}/);
  assert.match(agentSettings, /保存 Agent/);
});

test("BDD: 创建模式打开设置时自动新增并选中新 Agent 草稿", () => {
  // Given: 工作区已有一个 Agent，用户从通讯录进入创建模式。
  const existing = [agent("agent_existing")];

  // When: 初始化 Agent 设置草稿。
  const state = initialAgentSettingsState(existing, { createOnOpen: true, now: 12345 });

  // Then: 新草稿被追加并成为当前编辑项，已有 Agent 保持不变。
  assert.equal(state.agents.length, 2);
  assert.equal(state.agents[0]?.id, "agent_existing");
  assert.equal(state.activeId, state.agents[1]?.id);
  assert.equal(state.agents[1]?.name, "新 Agent");
  assert.equal(state.agents[1]?.ownerId, "local_user");
});

test("BDD: 本地 Agent 达到 24 个时创建入口不再追加草稿", () => {
  // Given: 用户已经拥有 24 个本地 Agent。
  const existing = Array.from({ length: 24 }, (_, index) => agent(`agent_${index}`));

  // When: 用户尝试进入创建模式并再次点击创建。
  const initial = initialAgentSettingsState(existing, { createOnOpen: true, now: 12345 });
  const appended = appendAgentDraft(initial.agents, 67890);

  // Then: 草稿数量保持不变，不会突破本地 Agent 上限。
  assert.equal(initial.agents.length, 24);
  assert.equal(appended.agents.length, 24);
  assert.equal(appended.agent, undefined);
});

test("BDD: 添加 Agent 弹窗提供全部 Runtime 和权限类型", async () => {
  // Given: 用户打开 Agent 设置弹窗。
  const source = await readFile(sourcePath, "utf8");
  const agentSettings = extractView(source, "const AgentSettings =", "const ContactSettings =");

  // When: 用户查看 Runtime、权限和可见性选项。
  // Then: 所有支持的 Agent 类型都能在设置中选择。
  for (const provider of [
    "codex",
    "claude",
    "opencode",
    "antigravity",
    "custom-http",
    "custom-cli",
  ]) {
    assert.match(agentSettings, new RegExp(`<option value="${provider}">`));
  }
  for (const value of ["private", "public", "read", "write", "local", "hosted"]) {
    assert.match(agentSettings, new RegExp(`<option value="${value}">`));
  }
  assert.match(agentSettings, /activeRuntime\.provider === "custom-http"/);
  assert.match(agentSettings, /activeRuntime\.provider === "custom-cli"/);
});
