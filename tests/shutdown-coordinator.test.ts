import assert from "node:assert/strict";
import test from "node:test";

import { ShutdownCoordinator } from "../src/main/shutdown-coordinator";

test("Given 多次退出请求 When 首次清理尚未完成 Then 资源只按顺序清理一次", async () => {
  const coordinator = new ShutdownCoordinator();
  const events: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cleanups = [
    async () => {
      events.push("openim");
      await waiting;
    },
    () => events.push("runtime"),
    () => events.push("codex"),
  ];

  const first = coordinator.run(cleanups);
  const second = coordinator.run(cleanups);
  assert.equal(first, second);
  assert.deepEqual(events, ["openim"]);
  release();
  await first;
  assert.deepEqual(events, ["openim", "runtime", "codex"]);
});

test("退出清理失败时仍继续释放后续资源", async () => {
  const coordinator = new ShutdownCoordinator();
  const events: string[] = [];
  await coordinator.run([
    () => {
      events.push("first");
      throw new Error("模拟退出错误");
    },
    () => events.push("second"),
  ]);
  assert.deepEqual(events, ["first", "second"]);
});
