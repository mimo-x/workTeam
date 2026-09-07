import { deepseek } from "@ai-sdk/deepseek";
import { frontendTools } from "@assistant-ui/ai-sdk";
import { type JSONSchema7, streamText, convertToModelMessages, type UIMessage } from "ai";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json({ error: "服务器尚未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  const {
    messages,
    system,
    tools,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
  } = await req.json();

  const result = streamText({
    model: deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash"),
    messages: await convertToModelMessages(messages),
    system:
      system ?? "你是一个友好、可靠的中文 AI 助手。回答应清晰、准确；除非用户要求，否则保持简洁。",
    tools: {
      ...frontendTools(tools ?? {}),
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
}
