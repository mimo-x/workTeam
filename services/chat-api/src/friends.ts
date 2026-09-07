import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery } from "./http.js";

const searchSchema = z.object({
  q: z.string().trim().min(2).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const createRequestSchema = z.object({
  receiverId: z.string().uuid(),
  message: z.string().trim().max(240).default(""),
});
const idParams = z.object({ id: z.string().uuid() });

const orderedPair = (first: string, second: string) =>
  first < second ? [first, second] : [second, first];

export const registerFriendRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  events: EventPublisher,
) => {
  app.get("/v1/users/search", { preHandler: [app.authenticate] }, async (request) => {
    const { q, limit } = parseQuery(searchSchema, request);
    const pattern = `%${q.toLowerCase()}%`;
    const result = await pool.query(
      `SELECT id, handle, display_name AS "displayName", avatar_url AS "avatarUrl"
       FROM users
       WHERE id <> $1 AND disabled_at IS NULL
         AND (handle LIKE $2 OR email LIKE $2 OR lower(display_name) LIKE $2)
       ORDER BY CASE WHEN handle = lower($3) THEN 0 ELSE 1 END, handle
       LIMIT $4`,
      [request.user.sub, pattern, q, limit],
    );
    return { data: result.rows };
  });

  app.get("/v1/friends", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<{
      id: string;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
      openimUserId: string;
      lastSeenAt: Date | null;
      friendsSince: Date;
    }>(
      `SELECT u.id, u.handle, u.display_name AS "displayName", u.avatar_url AS "avatarUrl",
              u.openim_user_id AS "openimUserId",
              max(d.last_seen_at) AS "lastSeenAt",
              f.created_at AS "friendsSince"
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
       LEFT JOIN devices d ON d.user_id = u.id
       WHERE f.user_low_id = $1 OR f.user_high_id = $1
       GROUP BY u.id, u.handle, u.display_name, u.avatar_url, u.openim_user_id, f.created_at
       ORDER BY lower(u.display_name), u.handle`,
      [request.user.sub],
    );
    return {
      data: result.rows.map(({ lastSeenAt, ...friend }) => ({
        ...friend,
        online: Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 60_000),
      })),
    };
  });

  app.get("/v1/friend-requests", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query(
      `SELECT fr.id, fr.sender_id AS "senderId", fr.receiver_id AS "receiverId",
              fr.message, fr.status, fr.created_at AS "createdAt", fr.responded_at AS "respondedAt",
              sender.handle AS "senderHandle", sender.display_name AS "senderName",
              receiver.handle AS "receiverHandle", receiver.display_name AS "receiverName"
       FROM friend_requests fr
       JOIN users sender ON sender.id = fr.sender_id
       JOIN users receiver ON receiver.id = fr.receiver_id
       WHERE fr.sender_id = $1 OR fr.receiver_id = $1
       ORDER BY fr.created_at DESC
       LIMIT 200`,
      [request.user.sub],
    );
    return { data: result.rows };
  });

  app.post("/v1/friend-requests", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = parseBody(createRequestSchema, request);
    if (input.receiverId === request.user.sub) {
      throw new ApiError(400, "CANNOT_FRIEND_SELF", "不能添加自己为好友。");
    }
    const [low, high] = orderedPair(request.user.sub, input.receiverId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const receiver = await client.query(
        "SELECT 1 FROM users WHERE id = $1 AND disabled_at IS NULL",
        [input.receiverId],
      );
      if (!receiver.rowCount) throw new ApiError(404, "USER_NOT_FOUND", "目标用户不存在。");
      const existing = await client.query(
        "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
        [low, high],
      );
      if (existing.rowCount) throw new ApiError(409, "ALREADY_FRIENDS", "你们已经是好友。");
      const reverse = await client.query<{ id: string }>(
        `SELECT id FROM friend_requests
         WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [input.receiverId, request.user.sub],
      );
      if (reverse.rows[0]) {
        await client.query(
          "UPDATE friend_requests SET status = 'accepted', responded_at = now(), updated_at = now() WHERE id = $1",
          [reverse.rows[0].id],
        );
        await client.query(
          "INSERT INTO friendships(user_low_id, user_high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [low, high],
        );
        await client.query("COMMIT");
        events.publishToUser(input.receiverId, {
          type: "friendship.created",
          userId: request.user.sub,
        });
        return reply.status(200).send({ autoAccepted: true });
      }
      const result = await client.query(
        `INSERT INTO friend_requests(sender_id, receiver_id, message)
         VALUES ($1, $2, $3)
         RETURNING id, sender_id AS "senderId", receiver_id AS "receiverId", message, status, created_at AS "createdAt"`,
        [request.user.sub, input.receiverId, input.message],
      );
      await client.query("COMMIT");
      events.publishToUser(input.receiverId, {
        type: "friend.request.created",
        request: result.rows[0],
      });
      return reply.status(201).send(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  const respond =
    (status: "accepted" | "rejected") => async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = parseParams(idParams, request);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ sender_id: string; receiver_id: string }>(
          `SELECT sender_id, receiver_id FROM friend_requests
           WHERE id = $1 AND receiver_id = $2 AND status = 'pending'
           FOR UPDATE`,
          [id, request.user.sub],
        );
        const friendshipRequest = found.rows[0];
        if (!friendshipRequest)
          throw new ApiError(404, "FRIEND_REQUEST_NOT_FOUND", "好友申请不存在或已处理。");
        await client.query(
          "UPDATE friend_requests SET status = $1, responded_at = now(), updated_at = now() WHERE id = $2",
          [status, id],
        );
        if (status === "accepted") {
          const [low, high] = orderedPair(
            friendshipRequest.sender_id,
            friendshipRequest.receiver_id,
          );
          await client.query(
            "INSERT INTO friendships(user_low_id, user_high_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [low, high],
          );
        }
        await client.query("COMMIT");
        events.publishToUser(friendshipRequest.sender_id, {
          type: `friend.request.${status}`,
          requestId: id,
          userId: request.user.sub,
        });
        return reply.status(204).send();
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };

  app.post(
    "/v1/friend-requests/:id/accept",
    { preHandler: [app.authenticate] },
    respond("accepted"),
  );
  app.post(
    "/v1/friend-requests/:id/reject",
    { preHandler: [app.authenticate] },
    respond("rejected"),
  );

  app.delete("/v1/friends/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = parseParams(idParams, request);
    const [low, high] = orderedPair(request.user.sub, id);
    await pool.query("DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2", [
      low,
      high,
    ]);
    events.publishToUser(id, { type: "friendship.deleted", userId: request.user.sub });
    return reply.status(204).send();
  });
};
