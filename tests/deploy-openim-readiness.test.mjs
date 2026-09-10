import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");

test("BDD: deployment waits for OpenIM before parsing credentials", () => {
  assert.match(script, /等待 OpenIM API 就绪/);
  assert.match(script, /OPENIM_READY=false/);
  assert.match(script, /auth\/parse_token/);
  assert.match(script, /2>\/dev\/null/);
});

test("BDD: empty OpenIM responses do not produce JSON parser tracebacks", () => {
  assert.match(script, /except Exception:/);
  assert.match(script, /无法获取 OpenIM 管理 Token/);
  assert.match(script, /--max-time 5/);
});
