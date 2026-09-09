import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const record = await readFile(new URL("../docs/bugs/BUG-20260910-006.md", import.meta.url), "utf8");
const design = await readFile(
  new URL("../openspec/changes/fix-electron-startup-crash/design.md", import.meta.url),
  "utf8",
);

test("BDD: Electron startup crash is recorded with concrete system evidence", () => {
  assert.match(record, /SIGABRT/);
  assert.match(record, /RegisterApplication/);
  assert.match(record, /launchservicesd/);
  assert.match(design, /Electron issue #52815/);
});
