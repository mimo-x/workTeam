export const humanizeErrorMessage = (message: string): string => {
  if (!message || typeof message !== "string") return "";

  const trimmed = message.trim();
  const modelMatch = trimmed.match(
    /Model\s+["']([^"']+)["']\s+is not supported(?:\s+by\s+(.+?))?\s*$/i,
  );
  if (modelMatch) {
    const status = trimmed.match(/\b(?:status|HTTP)\s+(\d{3})\b/i)?.[1];
    const scope = modelMatch[2]?.trim();
    const reason = /any configured account in this group/i.test(scope ?? "")
      ? "当前群组没有任何已配置账号支持该模型"
      : scope
        ? `服务端原因：${scope}`
        : "服务端拒绝了该模型";
    const statusText = status ? `（HTTP ${status}）` : "";
    return `模型 "${modelMatch[1]}" 不受支持${statusText}：${reason}。请切换模型，或检查当前群组的模型账号配置。原始报错：${trimmed}`;
  }

  if (/(?:quota|insufficient_quota|rate_limit|rate limit|429)/i.test(trimmed)) {
    return `模型调用额度超限或受调用频率限制。原始报错：${trimmed}`;
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
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && cause !== error && !message.includes("原始报错：")) {
      const causeMessage =
        cause instanceof Error
          ? cause.message?.trim()
          : typeof cause === "string"
            ? cause.trim()
            : formatErrorMessage(cause, "");
      if (causeMessage && causeMessage !== message && causeMessage !== "[object Object]") {
        return `${humanizeErrorMessage(message)} 原始报错：${causeMessage}`;
      }
    }
    return humanizeErrorMessage(message);
  }

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "errMsg", "additionalDetails", "error", "detail", "msg"]) {
      const candidate = record[key];
      if (
        typeof candidate === "string" &&
        candidate.trim() &&
        candidate.trim() !== "[object Object]"
      ) {
        return humanizeErrorMessage(candidate.trim());
      }
      if (candidate && typeof candidate === "object" && candidate !== error) {
        const nested = formatErrorMessage(candidate, "");
        if (nested && nested !== "[object Object]") return nested;
      }
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}" && json !== "[]") {
        return humanizeErrorMessage(json);
      }
    } catch {
      // 循环引用等不可序列化对象回退到通用错误文本
    }
  }

  const str = String(error).trim();
  if (!str || str === "[object Object]") return fallback;
  return humanizeErrorMessage(str);
};
