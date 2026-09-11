import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { closeOpenImSdk, OpenImLifecycleQueue } from "../src/renderer/src/openim-lifecycle";

const transportSource = new URL("../src/renderer/src/openim-transport.ts", import.meta.url);

test("BDD: OpenIM 断开始终先 logout 再 unInitSDK", async () => {
  // Given: 一个可记录调用顺序的 SDK 替身。
  const calls: string[] = [];
  const sdk = {
    logout: async () => {
      calls.push("logout");
    },
    unInitSDK: async () => {
      calls.push("unInitSDK");
    },
  };

  // When: 执行统一断开流程。
  await closeOpenImSdk(sdk);

  // Then: native SDK 按安全顺序释放。
  assert.deepEqual(calls, ["logout", "unInitSDK"]);
});

test("BDD: OpenIM 账号切换操作不会并发执行", async () => {
  // Given: 两个会修改 native SDK 状态的操作。
  const calls: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = new OpenImLifecycleQueue();

  // When: 第二个操作在第一个操作完成前排队。
  const first = queue.run(async () => {
    calls.push("disconnect:start");
    await firstBlocked;
    calls.push("disconnect:end");
  });
  const second = queue.run(async () => {
    calls.push("connect");
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["disconnect:start"]);
  releaseFirst();
  await Promise.all([first, second]);

  // Then: 新连接只能在旧连接释放后开始。
  assert.deepEqual(calls, ["disconnect:start", "disconnect:end", "connect"]);
});

test("BDD: 重复断开即使 native SDK 返回错误也能完成", async () => {
  // Given: native SDK 已经处于未初始化状态。
  const calls: string[] = [];
  const sdk = {
    logout: async () => {
      calls.push("logout");
      throw new Error("already logged out");
    },
    unInitSDK: async () => {
      calls.push("unInitSDK");
      throw new Error("already uninitialized");
    },
  };

  // When: 执行断开。
  await closeOpenImSdk(sdk);

  // Then: 错误被收敛，两个释放步骤都被尝试。
  assert.deepEqual(calls, ["logout", "unInitSDK"]);
});

test("BDD: renderer 卸载时注册 OpenIM 断开清理", async () => {
  // Given: renderer 可能在开发热更新或窗口关闭时卸载。
  const source = await readFile(transportSource, "utf8");

  // When: 检查 transport 的卸载钩子。
  // Then: 卸载会调用统一断开流程，旧 native 连接不会继续留存。
  assert.match(source, /window\.addEventListener\("beforeunload"/);
  assert.match(source, /openImTransport\.disconnect\(\)/);
});
