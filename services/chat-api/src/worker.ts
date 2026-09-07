import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { OpenImClient } from "./openim.js";
import { OutboxProcessor } from "./outbox.js";

const config = loadConfig();
const { pool } = createDatabase(config);
const processor = new OutboxProcessor(pool, new OpenImClient(config));
processor.start();

const shutdown = async () => {
  processor.stop();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log("Agent Team outbox worker started.");
