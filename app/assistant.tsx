"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";

const starterSuggestions = [
  { prompt: "用简单的话解释一下什么是大语言模型", title: "解释大语言模型" },
  { prompt: "帮我制定一个今天的高效工作计划", title: "制定工作计划" },
  { prompt: "写一个 TypeScript 防抖函数并解释", title: "编写示例代码" },
];

export const Assistant = () => {
  const runtime = useChatRuntime({
    suggestions: starterSuggestions,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="relative flex h-dvh flex-col overflow-hidden bg-[#080b12]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(53,109,255,0.19),transparent_38%)]" />
        <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(37,99,235,0.25)]">
              DS
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">DeepSeek Chat</div>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                在线
              </div>
            </div>
          </div>
          <div className="rounded-full border border-white/8 bg-white/4 px-3 py-1.5 font-mono text-[10px] tracking-wide text-zinc-500 uppercase">
            assistant-ui
          </div>
        </header>
        <main className="relative z-10 min-h-0 flex-1">
          <Thread
            badge="DS"
            welcome="今天想聊点什么？"
            description="由 DeepSeek 提供智能能力，支持流式回复与 Markdown 渲染。"
            placeholder="给 DeepSeek 发消息…"
          />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
};
