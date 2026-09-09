import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");

test("BDD: deployment disables the broken mage healthcheck and probes the real API", () => {
  assert.match(script, /docker-compose\.override\.yaml/);
  assert.match(script, /disable: true/);
  assert.match(script, /auth\/get_admin_token/);
  assert.match(script, /auth\/parse_token/);
});

test("BDD: deployment keeps bounded failure handling", () => {
  assert.match(script, /--connect-timeout/);
  assert.match(script, /--max-time/);
  assert.match(script, /部署未完成/);
  assert.doesNotMatch(script, /OPENIM_ADMIN_TOKEN=openIM123/);
});
