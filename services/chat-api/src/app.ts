import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { Redis } from "ioredis";
import type pg from "pg";

import { registerAgentRoutes } from "./agents.js";
import { registerAuth } from "./auth.js";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./db.js";
import type { EventPublisher } from "./events.js";
import { NullEventPublisher } from "./events.js";
import { registerFriendRoutes } from "./friends.js";
import { ApiError, errorHandler, parseBody } from "./http.js";
import { registerImportRoutes } from "./imports.js";
import { OpenImClient, OpenImUnavailableError } from "./openim.js";
import { registerProfileRoutes } from "./profile.js";
import { RealtimeHub } from "./realtime.js";
import { registerRoomRoutes } from "./rooms.js";
import { EnvelopeCipher, LocalKeyProvider, VaultTransitKeyProvider } from "./security.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerTaskRoutes } from "./tasks.js";
import { registerOpenImWebhooks } from "./webhooks.js";
import { z } from "zod";

const imSessionSchema = z.object({ platformId: z.number().int().positive().optional() });

type AppOverrides = {
  pool?: pg.Pool;
  redis?: Redis;
  events?: EventPublisher;
  enableRealtime?: boolean;
};

export const createApp = async (config: AppConfig, overrides: AppOverrides = {}) => {
  const app = Fastify({
    logger: { level: config.NODE_ENV === "test" ? "silent" : "info" },
    trustProxy: true,
    bodyLimit: 5_000_000,
  });
  const database = overrides.pool ? null : createDatabase(config);
  const pool = overrides.pool ?? database!.pool;
  const ownsPool = !overrides.pool;
  const redis =
    overrides.redis ??
    (overrides.enableRealtime === false
      ? null
      : new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }));
  const ownsRedis = Boolean(redis && !overrides.redis);
  if (redis && redis.status === "wait") await redis.connect();
  const openim = new OpenImClient(config);
  const keyProvider =
    config.KEY_PROVIDER === "vault-transit"
      ? new VaultTransitKeyProvider(config.VAULT_ADDR, config.VAULT_TOKEN, config.VAULT_TRANSIT_KEY)
      : new LocalKeyProvider(config.ENCRYPTION_MASTER_KEY);
  const cipher = new EnvelopeCipher(keyProvider);
  const realtime =
    overrides.events ??
    (redis ? new RealtimeHub(pool, redis, config, cipher) : new NullEventPublisher());

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(",").map((value) => value.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
    ...(redis ? { redis } : {}),
    keyGenerator: (request) => request.user?.sub ?? request.ip,
  });
  await app.register(websocket);
  app.setErrorHandler(errorHandler);

  app.get("/health/live", async () => ({ ok: true, service: "agent-team-chat-api" }));
  app.get("/health/ready", async () => {
    await pool.query("SELECT 1");
    if (redis) await redis.ping();
    return { ok: true, postgres: true, redis: Boolean(redis), openimConfigured: openim.configured };
  });

  await registerAuth(app, pool, config);
  registerFriendRoutes(app, pool, realtime);
  registerProfileRoutes(app, pool, realtime);
  registerAgentRoutes(app, pool, cipher, realtime);
  registerRoomRoutes(app, pool, realtime);
  registerTaskRoutes(app, pool, realtime);
  registerSettingsRoutes(app, pool, cipher, realtime);
  registerImportRoutes(app, pool, cipher);

  app.post("/v1/im/session", { preHandler: [app.authenticate] }, async (request) => {
    const input = parseBody(imSessionSchema, request);
    const user = await pool.query<{ openim_user_id: string }>(
      "SELECT openim_user_id FROM users WHERE id = $1",
      [request.user.sub],
    );
    if (!user.rows[0]) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在。");
    try {
      const issued = await openim.getUserToken(
        user.rows[0].openim_user_id,
        input.platformId ?? config.OPENIM_PLATFORM_ID,
      );
      return {
        userId: user.rows[0].openim_user_id,
        token: issued.token,
        expiresIn: issued.expireTimeSeconds,
        apiAddr: config.OPENIM_PUBLIC_API_URL || config.OPENIM_API_URL,
        wsAddr: config.OPENIM_WS_URL,
      };
    } catch (error) {
      if (error instanceof OpenImUnavailableError)
        throw new ApiError(503, "OPENIM_UNAVAILABLE", error.message);
      throw new ApiError(
        502,
        "OPENIM_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  registerOpenImWebhooks(app, pool, config, realtime);
  if (realtime instanceof RealtimeHub) realtime.register(app);

  app.addHook("onClose", async () => {
    if (realtime instanceof RealtimeHub) realtime.close();
    await Promise.allSettled([
      ...(ownsPool ? [pool.end()] : []),
      ...(redis && ownsRedis ? [redis.quit()] : []),
    ]);
  });

  return { app, db: database?.db ?? null, pool, redis, realtime, openim, cipher };
};
