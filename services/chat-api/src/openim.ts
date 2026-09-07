import { randomUUID } from "node:crypto";

import type { AppConfig } from "./config.js";

type OpenImEnvelope<T> = {
  errCode?: number;
  errMsg?: string;
  errDlt?: string;
  data?: T;
};

export class OpenImUnavailableError extends Error {}

export class OpenImClient {
  constructor(private readonly config: AppConfig) {}

  get configured() {
    return Boolean(this.config.OPENIM_API_URL && this.config.OPENIM_ADMIN_TOKEN);
  }

  private async call<T>(path: string, body: Record<string, unknown>) {
    if (!this.config.OPENIM_API_URL || !this.config.OPENIM_ADMIN_TOKEN) {
      throw new OpenImUnavailableError("OpenIM 尚未配置。");
    }
    const response = await fetch(`${this.config.OPENIM_API_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        operationID: randomUUID(),
        token: this.config.OPENIM_ADMIN_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json().catch(() => ({}))) as OpenImEnvelope<T>;
    if (!response.ok || result.errCode) {
      throw new Error(result.errMsg || result.errDlt || `OpenIM HTTP ${response.status}`);
    }
    return result.data as T;
  }

  async registerUser(user: { userID: string; nickname: string; faceURL?: string | null }) {
    await this.call("/user/user_register", {
      users: [{ userID: user.userID, nickname: user.nickname, faceURL: user.faceURL || "" }],
    });
  }

  async getUserToken(userID: string, platformID: number) {
    return this.call<{ token: string; expireTimeSeconds: number }>("/auth/get_user_token", {
      userID,
      platformID,
    });
  }

  async createGroup(input: {
    groupID: string;
    name: string;
    ownerUserID: string;
    memberUserIDs: string[];
  }) {
    return this.call<{ groupInfo: { groupID: string } }>("/group/create_group", {
      ownerUserID: input.ownerUserID,
      memberUserIDs: input.memberUserIDs.filter((id) => id !== input.ownerUserID),
      adminUserIDs: [],
      groupInfo: {
        groupID: input.groupID,
        groupName: input.name,
        notification: "",
        introduction: "Agent Team conversation",
        faceURL: "",
        ex: JSON.stringify({ source: "agent-team" }),
        groupType: 2,
        needVerification: 0,
        lookMemberInfo: 0,
        applyMemberFriend: 0,
      },
      sendMessage: false,
    });
  }

  async inviteToGroup(groupID: string, invitedUserIDs: string[]) {
    await this.call("/group/invite_user_to_group", {
      groupID,
      invitedUserIDs,
      reason: "Agent Team invitation approved",
    });
  }

  async kickFromGroup(groupID: string, kickedUserIDs: string[]) {
    await this.call("/group/kick_group", {
      groupID,
      kickedUserIDs,
      reason: "Removed from Agent Team room",
    });
  }

  async sendMessage(input: {
    sendID: string;
    senderNickname: string;
    groupID?: string;
    recvID?: string;
    content: string;
    ex?: Record<string, unknown>;
  }) {
    return this.call<{ serverMsgID: string; clientMsgID: string; sendTime: number }>(
      "/msg/send_msg",
      {
        sendID: input.sendID,
        recvID: input.recvID || "",
        groupID: input.groupID || "",
        senderNickname: input.senderNickname,
        senderFaceURL: "",
        senderPlatformID: 10,
        content: { content: input.content },
        contentType: 101,
        sessionType: input.groupID ? 3 : 1,
        isOnlineOnly: false,
        notOfflinePush: false,
        ex: JSON.stringify(input.ex ?? {}),
      },
    );
  }
}
