import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);

const fixedDarkColors = /(?:bg-\[#|bg-(?:black|white)\/|border-white\/|text-zinc-)/;

const extractView = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should exist`);
  return source.slice(start, end);
};

test("BDD: message view uses semantic surfaces in light and dark themes", async () => {
  const source = await readFile(sourcePath, "utf8");
  const messageView = extractView(source, "  const conversations =", "      {settingsOpen &&");
  assert.doesNotMatch(
    messageView,
    fixedDarkColors,
    "message view must not bypass theme tokens with fixed dark colors",
  );
  assert.match(messageView, /bg-(?:background|card|secondary|muted)/);
  assert.match(messageView, /border-border/);
  assert.match(messageView, /text-(?:foreground|muted-foreground)/);
});

test("BDD: contacts view uses semantic surfaces in light and dark themes", async () => {
  const source = await readFile(sourcePath, "utf8");
  const contactsView = extractView(source, "const ContactsView =", "const TaskBoard =");

  assert.doesNotMatch(
    contactsView,
    fixedDarkColors,
    "contacts view must not bypass theme tokens with fixed dark colors",
  );
  assert.match(contactsView, /bg-(?:background|card|secondary|muted)/);
  assert.match(contactsView, /border-border/);
  assert.match(contactsView, /text-(?:foreground|muted-foreground)/);
});

test("BDD: task board uses semantic surfaces in light and dark themes", async () => {
  const source = await readFile(sourcePath, "utf8");
  const taskBoard = extractView(source, "const TaskBoard =", "export const TeamChat =");

  assert.doesNotMatch(
    taskBoard,
    fixedDarkColors,
    "task board must not bypass theme tokens with fixed dark colors",
  );
  assert.match(taskBoard, /bg-(?:background|card|secondary|muted)/);
  assert.match(taskBoard, /border-border/);
  assert.match(taskBoard, /text-(?:foreground|muted-foreground)/);
});
