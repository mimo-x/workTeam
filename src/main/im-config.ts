import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ImConfigInput, ImPublicConfig, ImRuntimeConfig } from "../shared/agent-team";

type StoredImConfig = {
  apiAddr: string;
  wsAddr: string;
  userId: string;
  groupId: string;
  gatewayUrl: string;
  hostRemoteMessages: boolean;
  encryptedUserToken?: string;
  encryptedGatewaySecret?: string;
};

const cleanUrl = (value: string, protocols: string[], label: string) => {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} 不是有效地址。`);
  }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${label} 协议不受支持。`);
  return trimmed;
};

export class ImConfigStore {
  private cached: StoredImConfig | null = null;
  private volatileUserToken = "";
  private volatileGatewaySecret = "";

  constructor(private readonly filePath: string) {}

  async getPublicConfig(): Promise<ImPublicConfig> {
    const config = await this.read();
    return {
      apiAddr: config.apiAddr,
      wsAddr: config.wsAddr,
      userId: config.userId,
      groupId: config.groupId,
      gatewayUrl: config.gatewayUrl,
      hostRemoteMessages: config.hostRemoteMessages,
      hasUserToken: Boolean(
        this.volatileUserToken || config.encryptedUserToken || process.env.OPENIM_USER_TOKEN,
      ),
      hasGatewaySecret: Boolean(
        this.volatileGatewaySecret ||
        config.encryptedGatewaySecret ||
        process.env.AGENT_GATEWAY_SECRET,
      ),
    };
  }

  async getRuntimeConfig(dataDir: string): Promise<ImRuntimeConfig> {
    const config = await this.read();
    const publicConfig = await this.getPublicConfig();
    return {
      ...publicConfig,
      userToken:
        this.volatileUserToken ||
        this.decrypt(config.encryptedUserToken) ||
        process.env.OPENIM_USER_TOKEN ||
        "",
      dataDir,
      platformId: process.platform === "darwin" ? 4 : process.platform === "win32" ? 3 : 7,
    };
  }

  async getGatewayConfig() {
    const config = await this.read();
    return {
      gatewayUrl: config.gatewayUrl,
      gatewaySecret:
        this.volatileGatewaySecret ||
        this.decrypt(config.encryptedGatewaySecret) ||
        process.env.AGENT_GATEWAY_SECRET ||
        "",
    };
  }

  async save(input: ImConfigInput) {
    const previous = await this.read();
    const next: StoredImConfig = {
      apiAddr: cleanUrl(input.apiAddr, ["http:", "https:"], "OpenIM API 地址"),
      wsAddr: cleanUrl(input.wsAddr, ["ws:", "wss:"], "OpenIM WebSocket 地址"),
      userId: input.userId.trim(),
      groupId: input.groupId.trim(),
      gatewayUrl: cleanUrl(input.gatewayUrl, ["http:", "https:"], "Agent Gateway 地址"),
      hostRemoteMessages: input.hostRemoteMessages === true,
      encryptedUserToken: previous.encryptedUserToken,
      encryptedGatewaySecret: previous.encryptedGatewaySecret,
    };

    if (input.userToken?.trim()) {
      const value = input.userToken.trim();
      if (safeStorage.isEncryptionAvailable()) {
        next.encryptedUserToken = safeStorage.encryptString(value).toString("base64");
        this.volatileUserToken = "";
      } else {
        delete next.encryptedUserToken;
        this.volatileUserToken = value;
      }
    }
    if (input.gatewaySecret?.trim()) {
      const value = input.gatewaySecret.trim();
      if (safeStorage.isEncryptionAvailable()) {
        next.encryptedGatewaySecret = safeStorage.encryptString(value).toString("base64");
        this.volatileGatewaySecret = "";
      } else {
        delete next.encryptedGatewaySecret;
        this.volatileGatewaySecret = value;
      }
    }

    this.cached = next;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
    return this.getPublicConfig();
  }

  private async read(): Promise<StoredImConfig> {
    if (this.cached) return this.cached;
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as StoredImConfig;
      this.cached = {
        apiAddr: value.apiAddr || "",
        wsAddr: value.wsAddr || "",
        userId: value.userId || "",
        groupId: value.groupId || "",
        gatewayUrl: value.gatewayUrl || "",
        hostRemoteMessages: value.hostRemoteMessages === true,
        encryptedUserToken: value.encryptedUserToken,
        encryptedGatewaySecret: value.encryptedGatewaySecret,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cached = {
        apiAddr: process.env.OPENIM_API_ADDR || "",
        wsAddr: process.env.OPENIM_WS_ADDR || "",
        userId: process.env.OPENIM_USER_ID || "",
        groupId: process.env.OPENIM_GROUP_ID || "",
        gatewayUrl: process.env.AGENT_GATEWAY_URL || "",
        hostRemoteMessages: process.env.AGENT_HOST_REMOTE_MESSAGES === "true",
      };
    }
    return this.cached;
  }

  private decrypt(value?: string) {
    if (!value || !safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
}

export const imConfigPath = (userDataPath: string) => join(userDataPath, "openim-config.json");
