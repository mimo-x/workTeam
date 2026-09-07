import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { AppConfig } from "./config.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export const createDatabase = (config: Pick<AppConfig, "DATABASE_URL">) => {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 12 });
  return { db: drizzle(pool, { schema }), pool };
};
