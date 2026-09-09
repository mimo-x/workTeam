import readline from "node:readline";

process.stdout.write(
  `${JSON.stringify({ type: "system", subtype: "init", session_id: "fake-session" })}\n`,
);
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const text = message.message?.content;
  if (!text) return;
  const turnId = "fake-turn";
  process.stdout.write(
    `${JSON.stringify({ type: "stream_event", session_id: "fake-session", event: { type: "content_block_delta", delta: { type: "text_delta", text: "完成" } } })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "完成" }] } })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "完成", session_id: "fake-session", turn_id: turnId })}\n`,
  );
});
