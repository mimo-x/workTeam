import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

const port = Number(process.env.AGENT_GATEWAY_PORT || 8787);
const openImApi = String(process.env.OPENIM_API_ADDR || "").replace(/\/$/, "");
const adminToken = String(process.env.OPENIM_ADMIN_TOKEN || "");
const gatewaySecret = String(process.env.AGENT_GATEWAY_SECRET || "");
const allowedAgents = new Set(
  String(process.env.AGENT_IDS || "agent_coordinator,agent_architect,agent_coder,agent_reviewer")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const allowedGroups = new Set(
  String(process.env.OPENIM_GROUP_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const deliveries = new Map();

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const authorized = (request) => {
  const supplied = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(gatewaySecret);
  const actual = Buffer.from(supplied);
  return (
    expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual)
  );
};

const readJson = async (request) => {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 256_000) throw new Error("请求内容过大。");
  }
  return JSON.parse(raw || "{}");
};

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, {
      ok: true,
      openImConfigured: Boolean(openImApi && adminToken),
      agentCount: allowedAgents.size,
    });
  }
  if (request.method !== "POST" || request.url !== "/v1/agent-messages") {
    return json(response, 404, { ok: false, error: "Not found" });
  }
  if (!authorized(request)) return json(response, 401, { ok: false, error: "Unauthorized" });
  if (!openImApi || !adminToken) {
    return json(response, 503, { ok: false, error: "OpenIM 管理端尚未配置。" });
  }

  try {
    const body = await readJson(request);
    const agentId = String(body.agentId || "");
    const senderOpenimId = String(body.senderOpenimId || agentId).trim();
    const groupId = String(body.groupId || "");
    const content = String(body.content || "").trim();
    const deliveryId = String(body.deliveryId || "");
    const atUserIds = [
      ...new Set(
        (Array.isArray(body.atUserIds) ? body.atUserIds : [])
          .map(String)
          .map((value) => value.trim())
          .filter((value) => value && value.length <= 128),
      ),
    ].slice(0, 100);
    if (!allowedAgents.has(agentId)) throw new Error("Agent 不在允许列表中。");
    if (!senderOpenimId || senderOpenimId.length > 128) throw new Error("Agent OpenIM ID 无效。");
    if (!groupId) throw new Error("缺少 groupId。");
    if (allowedGroups.size && !allowedGroups.has(groupId)) {
      throw new Error("群组不在允许列表中。");
    }
    if (!deliveryId || deliveryId.length > 128) throw new Error("deliveryId 无效。");
    if (!content || content.length > 100_000) throw new Error("消息为空或过长。");

    const delivered = deliveries.get(deliveryId);
    if (delivered) return json(response, 200, delivered);

    const operationId = randomUUID();
    const metadata = {
      kind: "agent-message",
      agentId,
      deliveryId,
      runId: String(body.runId || ""),
      parentMessageId: String(body.parentMessageId || ""),
      agentHop: Math.max(1, Math.min(1_000, Number(body.agentHop) || 1)),
      final: true,
    };
    if (body.relayRootId) metadata.relayRootId = String(body.relayRootId).slice(0, 256);
    if (body.loopId) {
      metadata.loopId = String(body.loopId).slice(0, 256);
      metadata.loopTurn = Math.max(1, Math.min(1_000, Number(body.loopTurn) || 1));
    }
    const upstream = await fetch(`${openImApi}/msg/send_msg`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        operationID: operationId,
        token: adminToken,
      },
      body: JSON.stringify({
        sendID: senderOpenimId,
        recvID: "",
        groupID: groupId,
        senderNickname: String(body.senderName || agentId),
        senderPlatformID: 10,
        content: atUserIds.length
          ? { text: content, atUserList: atUserIds, atUsersInfo: [], isAtSelf: false }
          : { content },
        contentType: atUserIds.length ? 106 : 101,
        sessionType: 3,
        isOnlineOnly: false,
        notOfflinePush: false,
        ex: JSON.stringify(metadata),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.errCode) {
      return json(response, 502, {
        ok: false,
        error: result.errMsg || `OpenIM 返回 HTTP ${upstream.status}`,
      });
    }
    const success = { ok: true, operationId, data: result.data };
    deliveries.set(deliveryId, success);
    if (deliveries.size > 1_000) deliveries.delete(deliveries.keys().next().value);
    return json(response, 200, success);
  } catch (error) {
    return json(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const host = process.env.AGENT_GATEWAY_HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Agent Gateway listening on http://${host}:${port}`);
});
