import type { CodexThreadSummary } from "../shared/codex";

const LEGACY_AGENT_TEAM_MARKERS = [
  "<agent-team-platform-agent",
  "你正在处理 Task「",
  "你正在执行已审核的 Task「",
  "这是一个真实群聊。只输出准备发送到群里的回答",
  "这是一个真实任务小群。只输出准备发送到 Task 群里的回答",
] as const;

const LEGACY_AGENT_IDENTITY_PATTERNS = [
  /你正在以 .+的身份参与(?:群聊|一对一私聊)/,
  /你正在以 .+的身份和用户进行一对一私聊/,
] as const;

export function isCodexPrivateThread(thread: CodexThreadSummary): boolean {
  if (thread.threadSource === "agent-team") return false;

  const preview = thread.preview ?? "";
  if (LEGACY_AGENT_TEAM_MARKERS.some((marker) => preview.includes(marker))) return false;
  if (LEGACY_AGENT_IDENTITY_PATTERNS.some((pattern) => pattern.test(preview))) return false;

  return true;
}
