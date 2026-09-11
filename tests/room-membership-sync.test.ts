import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { missingSavedRoomAgentIds } from "../src/renderer/src/room-membership-sync";

test("BDD: 群保存后只对正式 Agent 成员执行一致性核对", () => {
  assert.deepEqual(
    missingSavedRoomAgentIds({
      requestedAgentIds: ["owned-agent", "external-agent"],
      pendingAgentIds: ["external-agent"],
      syncedAgentIds: ["owned-agent"],
    }),
    [],
  );
  assert.deepEqual(
    missingSavedRoomAgentIds({
      requestedAgentIds: ["owned-agent"],
      pendingAgentIds: [],
      syncedAgentIds: [],
    }),
    ["owned-agent"],
  );
});

test("BDD: 群管理页不会静默关闭不一致的保存结果", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );
  const dialog = source.slice(
    source.indexOf("const RoomDialog ="),
    source.indexOf("const ContactsView ="),
  );

  assert.match(dialog, /missingSavedRoomAgentIds\(\{/);
  assert.match(dialog, /群已保存，但以下 Agent 尚未同步/);
  assert.match(dialog, /保存后将以当前选择替换群成员/);
  assert.match(dialog, /Agent 变更：/);
});
