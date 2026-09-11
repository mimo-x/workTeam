import assert from "node:assert/strict";
import test from "node:test";

import { formatBackendErrorDetails } from "../src/shared/backend-error";

test("BDD: 后台参数校验错误向桌面端保留字段级原因", () => {
  // Given: 后台返回 Zod 的字段校验详情。
  const details = [
    { path: ["mention"], message: "提及名称格式不正确" },
    { path: ["runtimeEndpoint"], message: "远程 Runtime endpoint 必须使用 HTTPS。" },
  ];

  // When: 主进程格式化后台错误。
  const message = formatBackendErrorDetails(details);

  // Then: 用户能看到具体字段，而不是只有一个笼统的 400。
  assert.equal(
    message,
    "mention: 提及名称格式不正确；runtimeEndpoint: 远程 Runtime endpoint 必须使用 HTTPS。",
  );
});
