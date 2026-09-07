import { randomUUID } from "node:crypto";

import jwt from "@fastify/jwt";
import argon2 from "argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { ApiError, parseBody } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import { randomToken, tokenHash } from "./security.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; sid: string };
    user: { sub: string; sid: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const credentialsSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
  deviceName: z.string().trim().min(1).max(80).default("Desktop"),
});

const registerSchema = credentialsSchema.extend({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_][a-z0-9_-]{2,31}$/),
  displayName: z.string().trim().min(1).max(64),
});

const tokenSchema = z.object({ token: z.string().min(32).max(512) });
const emailSchema = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
});
const resetSchema = tokenSchema.extend({ password: z.string().min(12).max(256) });

type UserRow = {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  openim_user_id: string;
  password_hash: string;
  email_verified_at: Date | null;
  revision: number;
};

const publicUser = (user: UserRow) => ({
  id: user.id,
  email: user.email,
  handle: user.handle,
  displayName: user.display_name,
  avatarUrl: user.avatar_url,
  openimUserId: user.openim_user_id,
  emailVerified: Boolean(user.email_verified_at),
  revision: user.revision,
});

export const registerAuth = async (app: FastifyInstance, pool: pg.Pool, config: AppConfig) => {
  await app.register(jwt, { secret: config.JWT_SECRET });
  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new ApiError(401, "UNAUTHORIZED", "登录状态无效或已过期。");
    }
  });

  const issueSession = async (userId: string, deviceName: string) => {
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO refresh_sessions(user_id, token_hash, device_name, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, tokenHash(refreshToken), deviceName, expiresAt],
    );
    const sessionId = result.rows[0].id;
    const accessToken = app.jwt.sign({ sub: userId, sid: sessionId }, { expiresIn: "15m" });
    return { accessToken, refreshToken, expiresIn: 900 };
  };

  app.post("/v1/auth/register", async (request, reply) => {
    const input = parseBody(registerSchema, request);
    const userId = randomUUID();
    const openimUserId = `usr_${userId.replaceAll("-", "")}`;
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<UserRow>(
        `INSERT INTO users(id, email, handle, display_name, password_hash, openim_user_id, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING *`,
        [userId, input.email, input.handle, input.displayName, passwordHash, openimUserId],
      );
      await client.query("INSERT INTO user_settings(user_id) VALUES ($1)", [userId]);
      await enqueueOutbox(client, "openim.user.register", "user", userId, {
        userID: openimUserId,
        nickname: input.displayName,
        faceURL: "",
      });
      await client.query("COMMIT");
      const session = await issueSession(userId, input.deviceName);
      return reply.status(201).send({
        user: publicUser(inserted.rows[0]),
        ...session,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/v1/auth/login", async (request) => {
    const input = parseBody(credentialsSchema, request);
    const result = await pool.query<UserRow>(
      "SELECT * FROM users WHERE email = $1 AND disabled_at IS NULL",
      [input.email],
    );
    const user = result.rows[0];
    if (!user || !(await argon2.verify(user.password_hash, input.password))) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确。");
    }
    return { user: publicUser(user), ...(await issueSession(user.id, input.deviceName)) };
  });

  app.post("/v1/auth/refresh", async (request) => {
    const input = parseBody(tokenSchema, request);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ id: string; user_id: string; device_name: string }>(
        `SELECT id, user_id, device_name FROM refresh_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash(input.token)],
      );
      const session = found.rows[0];
      if (!session) throw new ApiError(401, "INVALID_REFRESH_TOKEN", "刷新令牌无效或已过期。");
      await client.query("UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1", [
        session.id,
      ]);
      await client.query("COMMIT");
      return issueSession(session.user_id, session.device_name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/v1/auth/logout", { preHandler: [app.authenticate] }, async (request, reply) => {
    await pool.query(
      "UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2",
      [request.user.sid, request.user.sub],
    );
    return reply.status(204).send();
  });

  app.post("/v1/auth/verify-email", async (request, reply) => {
    const input = parseBody(tokenSchema, request);
    const result = await pool.query(
      `UPDATE users SET email_verified_at = now(), updated_at = now()
       WHERE id = (
         SELECT user_id FROM account_tokens
         WHERE token_hash = $1 AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > now()
       )
       RETURNING id`,
      [tokenHash(input.token)],
    );
    if (!result.rowCount) throw new ApiError(400, "INVALID_TOKEN", "验证链接无效或已过期。");
    await pool.query("UPDATE account_tokens SET consumed_at = now() WHERE token_hash = $1", [
      tokenHash(input.token),
    ]);
    return reply.status(204).send();
  });

  app.post("/v1/auth/request-password-reset", async (request) => {
    const input = parseBody(emailSchema, request);
    const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      input.email,
    ]);
    if (!user.rows[0]) return { accepted: true };
    const token = randomToken();
    await pool.query(
      `INSERT INTO account_tokens(user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'reset_password', $2, now() + interval '30 minutes')`,
      [user.rows[0].id, tokenHash(token)],
    );
    return {
      accepted: true,
      ...(config.NODE_ENV === "development" ? { developmentResetToken: token } : {}),
    };
  });

  app.post("/v1/auth/reset-password", async (request, reply) => {
    const input = parseBody(resetSchema, request);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const token = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM account_tokens
         WHERE token_hash = $1 AND purpose = 'reset_password' AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash(input.token)],
      );
      if (!token.rows[0]) throw new ApiError(400, "INVALID_TOKEN", "重置链接无效或已过期。");
      await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
        passwordHash,
        token.rows[0].user_id,
      ]);
      await client.query("UPDATE account_tokens SET consumed_at = now() WHERE id = $1", [
        token.rows[0].id,
      ]);
      await client.query("UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1", [
        token.rows[0].user_id,
      ]);
      await client.query("COMMIT");
      return reply.status(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/v1/me", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [
      request.user.sub,
    ]);
    if (!result.rows[0]) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在。");
    return { user: publicUser(result.rows[0]) };
  });
};
