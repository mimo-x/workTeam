import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "session.start") {
    process.stdout.write(
      `${JSON.stringify({ type: "session.started", sessionId: message.sessionId })}\n`,
    );
  }
  if (message.type === "turn.start") {
    if (message.text === "fail") {
      process.stderr.write("模拟 CLI 错误\n");
      process.exit(7);
    }
    process.stdout.write(
      `${JSON.stringify({ type: "message.completed", sessionId: message.sessionId, turnId: message.turnId, data: { text: "CLI 完成" } })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "turn.completed", sessionId: message.sessionId, turnId: message.turnId, data: { status: "completed" } })}\n`,
    );
  }
});
