import assert from "node:assert/strict";
import test from "node:test";

import { formatErrorMessage, humanizeErrorMessage } from "../src/shared/error";

test("humanizeErrorMessage translates unsupported model errors", () => {
  const raw =
    'unexpected status 404 Not Found: Model "gpt-6-astra" is not supported by any configured account in this group';
  const humanized = humanizeErrorMessage(raw);
  assert.equal(
    humanized,
    '模型 "gpt-6-astra" 不受支持（HTTP 404）：当前群组没有任何已配置账号支持该模型。请切换模型，或检查当前群组的模型账号配置。原始报错：unexpected status 404 Not Found: Model "gpt-6-astra" is not supported by any configured account in this group',
  );
});

test("humanizeErrorMessage translates quota and rate limit errors", () => {
  const quota = "insufficient_quota: you exceeded your current quota";
  assert.equal(
    humanizeErrorMessage(quota),
    "模型调用额度超限或受调用频率限制。原始报错：insufficient_quota: you exceeded your current quota",
  );

  const rate = "429 Too Many Requests: rate_limit_exceeded";
  assert.equal(
    humanizeErrorMessage(rate),
    "模型调用额度超限或受调用频率限制。原始报错：429 Too Many Requests: rate_limit_exceeded",
  );
});

test("formatErrorMessage handles various error shapes safely", () => {
  assert.equal(formatErrorMessage(null), "未知错误");
  assert.equal(formatErrorMessage(undefined), "未知错误");
  assert.equal(formatErrorMessage(""), "未知错误");
  assert.equal(formatErrorMessage("[object Object]"), "未知错误");
  assert.equal(formatErrorMessage(new Error("普通错误")), "普通错误");

  assert.equal(
    formatErrorMessage({
      message: 'Model "gpt-6-astra" is not supported by any configured account in this group',
    }),
    '模型 "gpt-6-astra" 不受支持：当前群组没有任何已配置账号支持该模型。请切换模型，或检查当前群组的模型账号配置。原始报错：Model "gpt-6-astra" is not supported by any configured account in this group',
  );

  assert.equal(formatErrorMessage({ message: "[object Object]", errMsg: "真实错误" }), "真实错误");

  assert.equal(formatErrorMessage({ additionalDetails: "任务执行超时" }), "任务执行超时");
  assert.equal(formatErrorMessage({ errMsg: "OpenIM 网络故障" }), "OpenIM 网络故障");
  assert.equal(formatErrorMessage({ error: { message: "嵌套错误信息" } }), "嵌套错误信息");
  assert.equal(
    formatErrorMessage({ code: 500, reason: "internal" }),
    '{"code":500,"reason":"internal"}',
  );
});
