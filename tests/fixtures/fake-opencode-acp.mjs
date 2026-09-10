import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentInfo: { name: "fake-opencode", version: "1.0" }, agentCapabilities: { promptCapabilities: { image: false, audio: false, embeddedContext: false }, sessionCapabilities: {} } } })}\n`,
    );
  } else if (message.method === "session/new") {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "acp-session" } })}\n`,
    );
  } else if (message.method === "session/prompt") {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: message.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ACP 完成" } } } })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })}\n`,
    );
  }
});
