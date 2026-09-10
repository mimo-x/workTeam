import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type StoredRuntimeCredentials = {
  version: 1;
  encrypted: Record<string, string>;
};

export class RuntimeCredentialStore {
  private cached: StoredRuntimeCredentials | null = null;
  private readonly volatile = new Map<string, string>();

  constructor(private readonly filePath: string) {}

  async load() {
    await this.read();
  }

  get(agentId: string) {
    const volatile = this.volatile.get(agentId);
    if (volatile) return volatile;
    const encrypted = this.cached?.encrypted[agentId];
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      return "";
    }
  }

  async has(agentId: string) {
    await this.read();
    return Boolean(this.get(agentId));
  }

  async save(agentId: string, token: string) {
    const stored = await this.read();
    const value = token.trim();
    if (!value) {
      delete stored.encrypted[agentId];
      this.volatile.delete(agentId);
    } else if (safeStorage.isEncryptionAvailable()) {
      stored.encrypted[agentId] = safeStorage.encryptString(value).toString("base64");
      this.volatile.delete(agentId);
    } else {
      delete stored.encrypted[agentId];
      this.volatile.set(agentId, value);
    }
    this.cached = stored;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private async read() {
    if (this.cached) return this.cached;
    try {
      const raw = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<StoredRuntimeCredentials>;
      this.cached = {
        version: 1,
        encrypted: raw.encrypted && typeof raw.encrypted === "object" ? raw.encrypted : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.cached = { version: 1, encrypted: {} };
    }
    return this.cached;
  }
}

export const runtimeCredentialsPath = (userDataPath: string) =>
  join(userDataPath, "agent-runtime-credentials.json");
