import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { locallyRoutableAgentIds } from "../src/renderer/src/cloud-agent-routing";
import type { AgentDefinition } from "../src/shared/agent-team";

const sourcePath = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);

const agent = (
  values: Partial<AgentDefinition> & Pick<AgentDefinition, "id">,
): AgentDefinition => ({
  id: values.id,
  name: values.id,
  title: "Agent",
  mention: `@${values.id}`,
  initials: "A",
  theme: "violet",
  description: "",
  instructions: "",
  workspaceAccess: "read",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  ...values,
});

test("only owned local Agents are eligible for desktop routing", () => {
  assert.deepEqual(
    locallyRoutableAgentIds([
      agent({ id: "owned-local" }),
      agent({ id: "owned-hosted", executionLocation: "hosted" }),
      agent({ id: "other-local", ownerId: "another-user" }),
      agent({ id: "owned-local" }),
    ]),
    ["owned-local"],
  );
});

test("BDD: an owned local Agent mentioned in a cloud group is scheduled on this desktop", async () => {
  const source = await readFile(sourcePath, "utf8");
  const branchStart = source.indexOf(
    'if (connection.state === "connected" && room.syncSource === "backend" && room.externalId)',
  );
  const branchEnd = source.indexOf(
    '} else if (\n        connection.state === "connected" &&\n        room.type === "group"',
    branchStart,
  );

  assert.notEqual(branchStart, -1, "the cloud room send branch should exist");
  assert.notEqual(branchEnd, -1, "the cloud room send branch should have a stable boundary");
  const cloudRoomBranch = source.slice(branchStart, branchEnd);

  assert.match(cloudRoomBranch, /locallyRoutableAgentIds/);
  assert.match(cloudRoomBranch, /targetAgentIds:\s*localAgentIds/);
  assert.match(
    cloudRoomBranch,
    /triggerAgents:\s*agentAction\s*===\s*"chat"\s*&&\s*localAgentIds\.length\s*>\s*0/,
  );
  assert.match(cloudRoomBranch, /model,/);
});
