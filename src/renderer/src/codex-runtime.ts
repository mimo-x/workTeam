import {
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type ThreadAssistantMessagePart,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef } from "react";

import type { CodexEvent } from "../../shared/codex";
import { useCodexAttachments } from "./codex-attachments";

type RuntimeConfig = {
  workspace: string;
  model?: string;
  threadId?: string | null;
  initialMessages?: readonly ThreadMessageLike[];
  onTimelineEvent?: (event: {
    id: string;
    at: number;
    type: string;
    title: string;
    detail?: string;
    threadId?: string;
  }) => void;
  onSlashCommand?: (
    command: string,
    argument: string,
    threadId: string | null,
  ) => Promise<string | null>;
};

type CodexItem = {
  type?: string;
  id?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: unknown[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  text?: string;
  status?: string;
};

type ToolSnapshot = {
  id: string;
  name: string;
  args: Record<string, string>;
  output: string;
  complete: boolean;
  isError: boolean;
};

class EventQueue {
  private values: CodexEvent[] = [];
  private waiters: Array<(value: CodexEvent) => void> = [];

  push(value: CodexEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next() {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    return new Promise<CodexEvent>((resolve) => this.waiters.push(resolve));
  }
}

const lastUserText = (messages: readonly ThreadMessage[]) => {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) return "";
  return message.content
    .filter(
      (part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
};

const describeTool = (item: CodexItem): ToolSnapshot | null => {
  if (!item.id) return null;
  if (item.type === "commandExecution") {
    return {
      id: item.id,
      name: "terminal",
      args: { command: item.command ?? "", cwd: item.cwd ?? "" },
      output: item.aggregatedOutput ?? "",
      complete: item.status !== "inProgress",
      isError: typeof item.exitCode === "number" && item.exitCode !== 0,
    };
  }
  if (item.type === "fileChange") {
    return {
      id: item.id,
      name: "file_change",
      args: { changes: JSON.stringify(item.changes ?? [], null, 2) },
      output: JSON.stringify(item.changes ?? [], null, 2),
      complete: item.status !== "inProgress",
      isError: item.status === "failed",
    };
  }
  if (item.type === "mcpToolCall") {
    return {
      id: item.id,
      name: `mcp:${item.server ?? "server"}/${item.tool ?? "tool"}`,
      args: { input: JSON.stringify(item.arguments ?? {}, null, 2) },
      output: item.error
        ? JSON.stringify(item.error, null, 2)
        : JSON.stringify(item.result ?? "", null, 2),
      complete: item.status !== "inProgress",
      isError: Boolean(item.error),
    };
  }
  return null;
};

const contentSnapshot = (
  reasoning: string,
  answer: string,
  tools: Map<string, ToolSnapshot>,
): ThreadAssistantMessagePart[] => {
  const content: ThreadAssistantMessagePart[] = [];
  if (reasoning) content.push({ type: "reasoning", text: reasoning });
  for (const tool of tools.values()) {
    content.push({
      type: "tool-call",
      toolCallId: tool.id,
      toolName: tool.name,
      args: tool.args,
      argsText: JSON.stringify(tool.args),
      ...(tool.complete ? { result: tool.output || "完成", isError: tool.isError } : {}),
    });
  }
  if (answer) content.push({ type: "text", text: answer });
  return content;
};

const turnErrorMessage = (value: unknown) => {
  if (!value || typeof value !== "object") return "Codex 执行失败。";
  const error = value as Record<string, unknown>;
  return String(error.message ?? error.additionalDetails ?? "Codex 执行失败。");
};

export const useCodexRuntime = (config: RuntimeConfig) => {
  const { attachments, clear } = useCodexAttachments();
  const configRef = useRef(config);
  const attachmentRef = useRef(attachments);
  const threadIdRef = useRef<string | null>(config.threadId ?? null);
  const resumedThreadRef = useRef(!config.threadId);
  configRef.current = config;
  attachmentRef.current = attachments;

  useEffect(() => {
    const nextThreadId = config.threadId ?? null;
    if (threadIdRef.current === nextThreadId) return;
    threadIdRef.current = nextThreadId;
    resumedThreadRef.current = !nextThreadId;
  }, [config.workspace, config.threadId]);

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult, void> {
        const prompt = lastUserText(messages);
        const { workspace, model, onTimelineEvent, onSlashCommand } = configRef.current;
        if (!workspace) throw new Error("请先选择 Codex 工作目录。");
        if (!prompt) throw new Error("消息不能为空。");

        const slashMatch = prompt.match(/^\/(\S+)(?:\s+([\s\S]*))?$/u);
        if (slashMatch && onSlashCommand) {
          const result = await onSlashCommand(
            slashMatch[1].toLocaleLowerCase(),
            slashMatch[2]?.trim() ?? "",
            threadIdRef.current,
          );
          if (result !== null) {
            yield {
              content: [{ type: "text", text: result }],
              status: { type: "complete", reason: "stop" },
            };
            return;
          }
        }

        const queue = new EventQueue();
        const unsubscribe = window.codex.onEvent((event) => queue.push(event));
        let turnId: string | null = null;
        let aborted = abortSignal.aborted;
        let reasoning = "";
        let answer = "";
        let finalError: unknown = null;
        const tools = new Map<string, ToolSnapshot>();
        const trace = (event: { id: string; type: string; title: string; detail?: string }) =>
          onTimelineEvent?.({
            ...event,
            at: Date.now(),
            threadId: threadIdRef.current ?? undefined,
          });

        const abort = () => {
          aborted = true;
          if (threadIdRef.current && turnId) {
            void window.codex
              .interruptTurn({ threadId: threadIdRef.current, turnId })
              .catch(() => undefined);
          }
        };
        abortSignal.addEventListener("abort", abort, { once: true });

        try {
          if (!threadIdRef.current) {
            const thread = await window.codex.startThread({ cwd: workspace, model });
            threadIdRef.current = thread.threadId;
            resumedThreadRef.current = true;
          } else if (!resumedThreadRef.current) {
            await window.codex.resumeThread({ threadId: threadIdRef.current });
            resumedThreadRef.current = true;
          }

          const started = await window.codex.startTurn({
            threadId: threadIdRef.current,
            cwd: workspace,
            text: prompt,
            model,
            attachments: attachmentRef.current,
          });
          if (attachmentRef.current.length) {
            clear();
          }
          turnId = started.turnId;
          trace({ id: `turn:${turnId}`, type: "started", title: "Codex 已启动" });
          if (aborted) abort();

          while (true) {
            const event = await queue.next();
            const eventTurnId =
              typeof event.params.turnId === "string"
                ? event.params.turnId
                : typeof (event.params.turn as Record<string, unknown> | undefined)?.id === "string"
                  ? String((event.params.turn as Record<string, unknown>).id)
                  : null;
            if (eventTurnId && eventTurnId !== turnId) continue;

            let changed = false;
            if (event.method === "item/agentMessage/delta") {
              answer += String(event.params.delta ?? "");
              changed = true;
            } else if (
              event.method === "item/reasoning/summaryTextDelta" ||
              event.method === "item/reasoning/textDelta"
            ) {
              reasoning += String(event.params.delta ?? "");
              trace({
                id: `reasoning:${turnId}`,
                type: "reasoning",
                title: "思考摘要",
                detail: reasoning,
              });
              changed = true;
            } else if (event.method === "item/started" || event.method === "item/completed") {
              const item = (event.params.item ?? {}) as CodexItem;
              const tool = describeTool(item);
              if (tool) {
                tools.set(tool.id, tool);
                changed = true;
                trace({
                  id: `tool:${tool.id}`,
                  type: tool.name === "terminal" ? "command" : "tool",
                  title: tool.name,
                  detail: tool.output,
                });
              }
              if (event.method === "item/completed" && item.type === "agentMessage" && item.text) {
                answer = item.text;
                changed = true;
              }
            } else if (event.method === "item/commandExecution/outputDelta") {
              const itemId = String(event.params.itemId ?? "");
              const tool = tools.get(itemId);
              if (tool) {
                tool.output += String(event.params.delta ?? "");
                trace({
                  id: `tool:${tool.id}`,
                  type: "command",
                  title: tool.name,
                  detail: tool.output,
                });
                changed = true;
              }
            } else if (event.method === "desktop/approval/requested") {
              trace({
                id: `approval:${String(event.params.requestId ?? turnId)}`,
                type: "approval",
                title: String(event.params.title ?? "等待人工审批"),
                detail: String(event.params.reason ?? event.params.command ?? ""),
              });
            } else if (event.method === "error" && event.params.willRetry === false) {
              finalError = event.params.error;
            } else if (
              event.method === "desktop/status/changed" &&
              event.params.connected === false
            ) {
              throw new Error(String(event.params.error ?? "Codex App Server 连接已断开。"));
            }

            if (changed) {
              yield {
                content: contentSnapshot(reasoning, answer, tools),
                status: { type: "running" },
              };
            }

            if (event.method === "turn/completed") {
              const turn = (event.params.turn ?? {}) as Record<string, unknown>;
              const status = String(turn.status ?? "completed");
              trace({
                id: `turn:${turnId}:complete`,
                type: status === "failed" ? "error" : "complete",
                title: status === "failed" ? "Codex 执行失败" : "Codex 执行完成",
              });
              if (status === "failed") finalError = turn.error ?? finalError;
              yield {
                content: contentSnapshot(reasoning, answer, tools),
                status:
                  status === "interrupted" || aborted
                    ? { type: "incomplete", reason: "cancelled" }
                    : finalError
                      ? {
                          type: "incomplete",
                          reason: "error",
                          error: turnErrorMessage(finalError),
                        }
                      : { type: "complete", reason: "stop" },
              };
              return;
            }
          }
        } finally {
          abortSignal.removeEventListener("abort", abort);
          unsubscribe();
        }
      },
    }),
    [],
  );

  return useLocalRuntime(adapter, {
    initialMessages: config.initialMessages,
    adapters: {
      suggestion: {
        generate: async ({ messages }) =>
          messages.length
            ? []
            : [
                { prompt: "分析这个项目，并告诉我它的结构和启动方式", title: "分析项目" },
                { prompt: "检查当前项目里最值得优先修复的问题", title: "检查问题" },
                { prompt: "为这个项目补充一份清晰的 README", title: "完善文档" },
              ],
      },
    },
  });
};
