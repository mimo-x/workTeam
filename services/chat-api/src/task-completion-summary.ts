import { redactAuditText } from "./collaboration-audit.js";

export const TASK_COMPLETION_SUMMARY_LIMIT = 4_000;

export type TaskCompletionPart = {
  title: string;
  completion_summary?: string | null;
};

export const normalizeCompletionSummary = (value: unknown) =>
  redactAuditText(typeof value === "string" ? value : "", TASK_COMPLETION_SUMMARY_LIMIT);

export const aggregateTaskCompletionSummaries = (parts: TaskCompletionPart[]) =>
  normalizeCompletionSummary(
    parts
      .map((part) => {
        const title = normalizeCompletionSummary(part.title) || "子 Task";
        const summary =
          normalizeCompletionSummary(part.completion_summary) || "已完成，但未提供文本摘要。";
        return `- ${title}：${summary}`;
      })
      .join("\n"),
  );

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
