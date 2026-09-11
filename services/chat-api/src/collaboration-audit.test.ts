import assert from "node:assert/strict";
import test from "node:test";

import { redactAuditMetadata, redactAuditText } from "./collaboration-audit.js";

test("audit redaction removes host paths, credentials, and private metadata", () => {
  const text = redactAuditText(
    "Read /Users/alice/private/project and token=abc123 with Bearer secret-token",
  );
  assert.equal(text.includes("/Users/alice"), false);
  assert.equal(text.includes("abc123"), false);
  assert.equal(text.includes("secret-token"), false);

  const metadata = redactAuditMetadata({
    taskId: "task-1",
    localPath: "/Users/alice/private/project",
    encryptedDetails: "ciphertext",
    scopes: ["workspace.read", "workspace.write"],
  });
  assert.deepEqual(metadata, {
    taskId: "task-1",
    scopes: ["workspace.read", "workspace.write"],
  });
});
