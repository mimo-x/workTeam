import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { EnvelopeCipher, LocalKeyProvider, tokenHash } from "./security.js";

test("envelope encryption round trips and uses randomized ciphertext", async () => {
  const cipher = new EnvelopeCipher(new LocalKeyProvider(randomBytes(32).toString("base64")));
  const first = await cipher.encrypt({ instructions: "private", key: "secret" });
  const second = await cipher.encrypt({ instructions: "private", key: "secret" });
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await cipher.decrypt(first), { instructions: "private", key: "secret" });
});

test("token hashing is deterministic without storing the source token", () => {
  assert.equal(tokenHash("one"), tokenHash("one"));
  assert.notEqual(tokenHash("one"), "one");
});
