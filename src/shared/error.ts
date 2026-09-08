export const humanizeErrorMessage = (message: string): string => {
  if (!message || typeof message !== "string") return "";

  const trimmed = message.trim();
  const modelMatch = trimmed.match(/Model "([^"]+)" is not supported/i);
  if (modelMatch) {
    return `当前账号未配置或不支持模型 "${modelMatch[1]}"，请在应用设置中切换为其他可用模型。`;
  }

  if (/(?:quota|insufficient_quota|rate_limit|rate limit|429)/i.test(trimmed)) {
    return `模型调用额度超限或受调用频率限制，请稍后重试或切换模型。`;
  }

  if (/Codex App Server 连接已断开/i.test(trimmed)) {
    return "Codex 本地服务连接已断开，请检查 Codex 是否正常运行。";
  }

  return trimmed;
};

export const formatErrorMessage = (error: unknown, fallback = "未知错误"): string => {
  if (error === null || error === undefined) return fallback;

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (!trimmed || trimmed === "[object Object]") return fallback;
    return humanizeErrorMessage(trimmed);
  }

  if (error instanceof Error) {
    const message = error.message?.trim();
    if (!message || message === "[object Object]") return fallback;
    return humanizeErrorMessage(message);
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const candidate =
      record.message ??
      record.errMsg ??
      record.additionalDetails ??
      record.error ??
      record.detail ??
      record.msg;

    if (typeof candidate === "string" && candidate.trim()) {
      return humanizeErrorMessage(candidate.trim());
    }

    if (candidate && typeof candidate === "object" && candidate !== error) {
      const nested = formatErrorMessage(candidate, "");
      if (nested && nested !== fallback && nested !== "[object Object]") {
        return nested;
      }
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}" && json !== "[]") {
        return humanizeErrorMessage(json);
      }
    } catch {
      // ignore json serialization errors
    }
  }

  const str = String(error).trim();
  if (!str || str === "[object Object]") return fallback;
  return humanizeErrorMessage(str);
};
