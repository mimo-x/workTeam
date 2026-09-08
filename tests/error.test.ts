import assert from "node:assert/strict";
import test from "node:test";

import { formatErrorMessage, humanizeErrorMessage } from "../src/shared/error";

test("humanizeErrorMessage translates unsupported model errors", () => {
  const raw =
    'unexpected status 404 Not Found: Model "gpt-6-astra" is not supported by any configured account in this group';
  const humanized = humanizeErrorMessage(raw);
  assert.equal(
    humanized,
    '当前账号未配置或不支持模型 "gpt-6-astra"，请在应用设置中切换为其他可用模型。',
  );
});

test("humanizeErrorMessage translates quota and rate limit errors", () => {
  const quota = "insufficient_quota: you exceeded your current quota";
  assert.equal(
    humanizeErrorMessage(quota),
    "模型调用额度超限或受调用频率限制，请稍后重试或切换模型。",
  );

  const rate = "429 Too Many Requests: rate_limit_exceeded";
  assert.equal(
    humanizeErrorMessage(rate),
    "模型调用额度超限或受调用频率限制，请稍后重试或切换模型。",
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
    '当前账号未配置或不支持模型 "gpt-6-astra"，请在应用设置中切换为其他可用模型。',
  );

  assert.equal(formatErrorMessage({ additionalDetails: "任务执行超时" }), "任务执行超时");
  assert.equal(formatErrorMessage({ errMsg: "OpenIM 网络故障" }), "OpenIM 网络故障");
  assert.equal(formatErrorMessage({ error: { message: "嵌套错误信息" } }), "嵌套错误信息");
  assert.equal(
    formatErrorMessage({ code: 500, reason: "internal" }),
    '{"code":500,"reason":"internal"}',
  );
});
