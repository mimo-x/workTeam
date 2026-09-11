import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkspaceBindingStore } from "../src/main/workspace-binding-store";

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
};

test("workspace bindings encrypt paths and reject stale, mismatched, removed, or invalid mappings", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-team-workspace-bindings-"));
  const project = join(root, "private-project");
  const file = join(root, "bindings.json");
  await mkdir(project);
  try {
    const store = new WorkspaceBindingStore(file, encryption);
    await store.save({
      bindingId: "binding_1",
      bindingRevision: 2,
      hostDeviceId: "device_1",
      path: project,
    });

    assert.equal(
      await store.resolve({
        bindingId: "binding_1",
        bindingRevision: 2,
        hostDeviceId: "device_1",
      }),
      project,
    );
    assert.doesNotMatch(await readFile(file, "utf8"), /private-project/);
    await assert.rejects(
      store.resolve({
        bindingId: "binding_1",
        bindingRevision: 1,
        hostDeviceId: "device_1",
      }),
      /版本已变化/,
    );
    await assert.rejects(
      store.resolve({
        bindingId: "binding_1",
        bindingRevision: 2,
        hostDeviceId: "device_2",
      }),
      /另一台设备/,
    );

    await rm(project, { recursive: true });
    await assert.rejects(
      store.resolve({
        bindingId: "binding_1",
        bindingRevision: 2,
        hostDeviceId: "device_1",
      }),
      /路径已失效/,
    );
    assert.equal(await store.remove("binding_1"), true);
    await assert.rejects(
      store.resolve({
        bindingId: "binding_1",
        bindingRevision: 2,
        hostDeviceId: "device_1",
      }),
      /未配置/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
