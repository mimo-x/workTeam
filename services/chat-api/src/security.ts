import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { EncryptedEnvelope } from "./schema.js";

const base64url = (value: Buffer) => value.toString("base64url");
const fromBase64url = (value: string) => Buffer.from(value, "base64url");

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("base64url");

export const randomToken = () => randomBytes(32).toString("base64url");

const encryptAes = (plaintext: Buffer, key: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
};

const decryptAes = (ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer) => {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

export interface KeyProvider {
  readonly id: string;
  wrapKey(key: Buffer): Promise<{ ciphertext: Buffer; iv: Buffer; tag: Buffer }>;
  unwrapKey(input: { ciphertext: Buffer; iv: Buffer; tag: Buffer }): Promise<Buffer>;
}

export class LocalKeyProvider implements KeyProvider {
  readonly id = "local";
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = encodedKey
      ? Buffer.from(encodedKey, "base64")
      : createHash("sha256").update("agent-team-development-key").digest();
    if (this.key.length !== 32) throw new Error("ENCRYPTION_MASTER_KEY must decode to 32 bytes.");
  }

  async wrapKey(key: Buffer) {
    return encryptAes(key, this.key);
  }

  async unwrapKey(input: { ciphertext: Buffer; iv: Buffer; tag: Buffer }) {
    return decryptAes(input.ciphertext, this.key, input.iv, input.tag);
  }
}

export class VaultTransitKeyProvider implements KeyProvider {
  readonly id: string;

  constructor(
    private readonly address: string,
    private readonly token: string,
    private readonly keyName: string,
  ) {
    if (!address || !token || !keyName)
      throw new Error("Vault Transit configuration is incomplete.");
    this.id = `vault-transit:${keyName}`;
  }

  async wrapKey(key: Buffer) {
    const result = await this.call<{ ciphertext: string }>("encrypt", {
      plaintext: key.toString("base64"),
    });
    return {
      ciphertext: Buffer.from(result.ciphertext, "utf8"),
      iv: Buffer.alloc(0),
      tag: Buffer.alloc(0),
    };
  }

  async unwrapKey(input: { ciphertext: Buffer }) {
    const result = await this.call<{ plaintext: string }>("decrypt", {
      ciphertext: input.ciphertext.toString("utf8"),
    });
    const key = Buffer.from(result.plaintext, "base64");
    if (key.length !== 32) throw new Error("Vault returned an invalid data key.");
    return key;
  }

  private async call<T>(operation: "encrypt" | "decrypt", body: Record<string, string>) {
    const response = await fetch(
      `${this.address.replace(/\/$/, "")}/v1/transit/${operation}/${encodeURIComponent(this.keyName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-vault-token": this.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: string[];
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.errors?.join("; ") || `Vault Transit HTTP ${response.status}`);
    }
    return payload.data;
  }
}

export class EnvelopeCipher {
  constructor(private readonly keys: KeyProvider) {}

  async encrypt(value: unknown): Promise<EncryptedEnvelope> {
    const dataKey = randomBytes(32);
    const payload = encryptAes(Buffer.from(JSON.stringify(value), "utf8"), dataKey);
    const wrapped = await this.keys.wrapKey(dataKey);
    return {
      version: 1,
      algorithm: "A256GCM",
      keyProvider: this.keys.id,
      iv: base64url(payload.iv),
      tag: base64url(payload.tag),
      ciphertext: base64url(payload.ciphertext),
      wrappedKey: base64url(wrapped.ciphertext),
      wrappedKeyIv: base64url(wrapped.iv),
      wrappedKeyTag: base64url(wrapped.tag),
    };
  }

  async decrypt<T>(value: EncryptedEnvelope): Promise<T> {
    if (value.version !== 1 || value.algorithm !== "A256GCM") {
      throw new Error("Unsupported encrypted envelope.");
    }
    if (value.keyProvider && value.keyProvider !== this.keys.id) {
      throw new Error(`Encrypted value requires key provider ${value.keyProvider}.`);
    }
    const dataKey = await this.keys.unwrapKey({
      ciphertext: fromBase64url(value.wrappedKey),
      iv: fromBase64url(value.wrappedKeyIv),
      tag: fromBase64url(value.wrappedKeyTag),
    });
    const plaintext = decryptAes(
      fromBase64url(value.ciphertext),
      dataKey,
      fromBase64url(value.iv),
      fromBase64url(value.tag),
    );
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}
