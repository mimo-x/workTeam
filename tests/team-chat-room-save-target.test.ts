import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveRoomSaveTarget } from "../src/renderer/src/room-save-target";

test("BDD: an existing local room with a cloud-bound Agent still saves locally", () => {
  const target = resolveRoomSaveTarget({
    hasExistingRoom: true,
    existingRoomSource: "local",
    cloudMode: true,
    hasRemoteSelection: true,
  });

  assert.equal(
    target,
    "local",
    "a local room ID must never be sent to the backend room-members route",
  );
});

test("BDD: a legacy local room without an explicit sync source still saves locally", () => {
  assert.equal(
    resolveRoomSaveTarget({
      hasExistingRoom: true,
      cloudMode: true,
      hasRemoteSelection: true,
    }),
    "local",
  );
});

test("BDD: an existing backend room always saves through the cloud", () => {
  assert.equal(
    resolveRoomSaveTarget({
      hasExistingRoom: true,
      existingRoomSource: "backend",
      cloudMode: true,
      hasRemoteSelection: false,
    }),
    "cloud",
  );
});

test("BDD: only a new room with cloud mode and a remote member is created in the cloud", () => {
  assert.equal(
    resolveRoomSaveTarget({
      hasExistingRoom: false,
      cloudMode: true,
      hasRemoteSelection: true,
    }),
    "cloud",
  );
  assert.equal(
    resolveRoomSaveTarget({
      hasExistingRoom: false,
      cloudMode: true,
      hasRemoteSelection: false,
    }),
    "local",
  );
  assert.equal(
    resolveRoomSaveTarget({
      hasExistingRoom: false,
      cloudMode: false,
      hasRemoteSelection: true,
    }),
    "local",
  );
});

test("BDD: RoomDialog delegates save routing to the shared decision", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/team-chat.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const RoomDialog =");
  const end = source.indexOf("const ContactsView =", start);
  const roomDialog = source.slice(start, end);

  assert.match(roomDialog, /resolveRoomSaveTarget\(\{/);
});
