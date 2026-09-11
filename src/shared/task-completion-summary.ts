export const TASK_COMPLETION_SUMMARY_LIMIT = 4_000;

export type TaskCompletionPart = {
  title: string;
  completionSummary?: string | null;
};

const redactCompletionText = (value: string) =>
  value
    .replace(/(?:^|\s)(?:\/[\w.@+-]+){2,}/g, " [redacted-path]")
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s]*/g, "[redacted-path]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|credential)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .trim();

export const normalizeCompletionSummary = (value: unknown) =>
  redactCompletionText(typeof value === "string" ? value : "").slice(
    0,
    TASK_COMPLETION_SUMMARY_LIMIT,
  );

export const aggregateTaskCompletionSummaries = (parts: TaskCompletionPart[]) => {
  const items = parts.map((part) => {
    const title = normalizeCompletionSummary(part.title) || "子 Task";
    const summary =
      normalizeCompletionSummary(part.completionSummary) || "已完成，但未提供文本摘要。";
    return `- ${title}：${summary}`;
  });
  return normalizeCompletionSummary(items.join("\n"));
};

export const normalizeCompletionArtifactRefs = (values: unknown) =>
  Array.isArray(values)
    ? [...new Set(values.map(normalizeCompletionSummary).filter(Boolean))].slice(0, 64)
    : [];

export const formatTaskCompletionMessage = (input: {
  title: string;
  completionSummary?: string | null;
  artifactRefs?: string[] | null;
}) => {
  const title = normalizeCompletionSummary(input.title) || "Task";
  const summary =
    normalizeCompletionSummary(input.completionSummary) || "Task 已通过人工验收，未提供文本摘要。";
  const artifacts = normalizeCompletionArtifactRefs(input.artifactRefs);
  return [
    `Task「${title}」已验收完成`,
    "",
    "总结",
    summary,
    ...(artifacts.length ? ["", "产物", ...artifacts.map((artifact) => `- ${artifact}`)] : []),
  ].join("\n");
};
