import readline from "node:readline";

process.stdout.write(
  `${JSON.stringify({ event: "init", conversation_id: "fake-conversation", init: { cwd: process.cwd(), tools: ["read_file"], permission_mode: "plan" } })}\n`,
);
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.event !== "user") return;
  process.stdout.write(
    `${JSON.stringify({ event: "step_update", step_update: { conversation_id: "fake-conversation", step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "AGY 完成" } })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ event: "result", result: { conversation_id: "fake-conversation", status: "SUCCESS", response: "AGY 完成", num_turns: 1 } })}\n`,
  );
});
