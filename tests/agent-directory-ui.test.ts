import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const teamChatPath = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);
const availabilityPath = new URL("../src/renderer/src/agent-availability.ts", import.meta.url);
const designSystemPath = new URL(
  "../app/design-system/_components/workteam-design-system.tsx",
  import.meta.url,
);

const extractContactsView = (source: string) => {
  const start = source.indexOf("const ContactsView =");
  const end = source.indexOf("const TaskBoard =", start);

  assert.notEqual(start, -1, "ContactsView should exist");
  assert.notEqual(end, -1, "TaskBoard should follow ContactsView");
  return source.slice(start, end);
};

test("BDD: 通讯录使用 Tabs 将好友和 Agent 目录分成独立视图", async () => {
  const contactsView = extractContactsView(await readFile(teamChatPath, "utf8"));

  assert.match(contactsView, /<Tabs[\s\S]*value=\{activeDirectory\}/);
  assert.match(contactsView, /<TabsList[^>]*aria-label="通讯录视图"/);
  assert.match(contactsView, /<TabsTrigger value="friends">好友<\/TabsTrigger>/);
  assert.match(contactsView, /<TabsTrigger value="agents">Agent 目录<\/TabsTrigger>/);
  assert.match(contactsView, /<TabsContent value="friends"/);
  assert.match(contactsView, /<TabsContent value="agents"/);
});

test("BDD: Agent 目录分别展示我的 Agent 和其他用户的公开 Agent", async () => {
  const [contactsView, availabilitySource] = await Promise.all([
    readFile(teamChatPath, "utf8").then(extractContactsView),
    readFile(availabilityPath, "utf8"),
  ]);

  assert.match(contactsView, /<h2[^>]*>我的 Agent<\/h2>/);
  assert.match(contactsView, /<h2[^>]*>公开 Agent<\/h2>/);
  assert.match(contactsView, /ownedAgents\.filter\(matches\)/);
  assert.match(contactsView, /publicAgents\.filter\(matches\)/);
  assert.match(availabilitySource, /agent\.ownerId === "local_user"/);
  assert.match(
    availabilitySource,
    /agent\.ownerId !== "local_user" && agent\.visibility === "public"/,
  );
});

test("BDD: Agent 卡片以三态可用性控制私聊入口并展示心跳", async () => {
  const [contactsView, availabilitySource] = await Promise.all([
    readFile(teamChatPath, "utf8").then(extractContactsView),
    readFile(availabilityPath, "utf8"),
  ]);

  for (const label of ["本机可用", "远程在线", "暂无执行主机", "尚无心跳"]) {
    assert.match(availabilitySource, new RegExp(label));
  }
  assert.match(contactsView, /<Badge[\s\S]*\{availability\.label\}/);
  assert.match(contactsView, /\{availability\.heartbeatLabel\}/);
  assert.match(contactsView, /disabled=\{!availability\.canMessage\}/);
  assert.doesNotMatch(contactsView, /状态未知/);
});

test("BDD: 目录改版保留好友私聊及 Agent 创建、编辑和私聊行为", async () => {
  const contactsView = extractContactsView(await readFile(teamChatPath, "utf8"));

  assert.match(contactsView, /onClick=\{onEditHumans\}/);
  assert.match(contactsView, /onClick=\{onCreateAgent\}/);
  assert.match(contactsView, /onEditAgents\(agent\.id\)/);
  assert.match(contactsView, /onOpenDirect\(human\.id\)/);
  assert.match(contactsView, /onOpenDirect\(agent\.id\)/);
});

test("design-system 记录 Agent 三态与目录分组", async () => {
  const designSystemSource = await readFile(designSystemPath, "utf8");

  for (const label of ["本机可用", "远程在线", "暂无执行主机", "我的 Agent", "公开 Agent"]) {
    assert.match(designSystemSource, new RegExp(label));
  }
});
