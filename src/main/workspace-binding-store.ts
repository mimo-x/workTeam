import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export type LocalWorkspaceBinding = {
  bindingId: string;
  bindingRevision: number;
  hostDeviceId: string;
  path: string;
  updatedAt: number;
};

type StoredWorkspaceBindings = {
  version: 1;
  encrypted: Record<string, string>;
};

export type WorkspaceBindingEncryptionProvider = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

const assertMapping = (value: LocalWorkspaceBinding) => {
  if (!value.bindingId.trim()) throw new Error("项目绑定 ID 无效。");
  if (!Number.isInteger(value.bindingRevision) || value.bindingRevision < 1) {
    throw new Error("项目绑定版本无效。");
  }
  if (!value.hostDeviceId.trim()) throw new Error("项目主机设备无效。");
  if (!isAbsolute(value.path)) throw new Error("项目绑定必须指向本机绝对路径。");
};

export class WorkspaceBindingStore {
  private cached: StoredWorkspaceBindings | null = null;

  constructor(
    private readonly filePath: string,
    private readonly encryption: WorkspaceBindingEncryptionProvider,
  ) {}

  async save(input: Omit<LocalWorkspaceBinding, "updatedAt">) {
    const mapping: LocalWorkspaceBinding = { ...input, updatedAt: Date.now() };
    assertMapping(mapping);
    const info = await stat(mapping.path);
    if (!info.isDirectory()) throw new Error("项目绑定路径不是目录。");
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法安全保存项目路径。");
    }
    const stored = await this.read();
    stored.encrypted[mapping.bindingId] = this.encryption
      .encryptString(JSON.stringify(mapping))
      .toString("base64");
    await this.persist(stored);
    return { ...mapping };
  }

  async resolve(input: { bindingId: string; bindingRevision: number; hostDeviceId: string }) {
    const mapping = await this.get(input.bindingId);
    if (!mapping) throw new Error("本机未配置该项目绑定，请由主机所有者重新选择项目目录。");
    if (mapping.hostDeviceId !== input.hostDeviceId) {
      throw new Error("项目绑定属于另一台设备，已拒绝启动 Runtime。");
    }
    if (mapping.bindingRevision !== input.bindingRevision) {
      throw new Error("项目绑定版本已变化，请重新确认本机项目目录。");
    }
    assertMapping(mapping);
    const info = await stat(mapping.path).catch(() => null);
    if (!info?.isDirectory()) {
      throw new Error("项目绑定路径已失效，请重新选择项目目录。");
    }
    return mapping.path;
  }

  async remove(bindingId: string) {
    const stored = await this.read();
    if (!(bindingId in stored.encrypted)) return false;
    delete stored.encrypted[bindingId];
    await this.persist(stored);
    return true;
  }

  async summaries() {
    const stored = await this.read();
    const summaries: Array<Omit<LocalWorkspaceBinding, "path"> & { pathAvailable: true }> = [];
    for (const bindingId of Object.keys(stored.encrypted)) {
      const mapping = await this.get(bindingId);
      if (mapping) {
        const { path: _path, ...summary } = mapping;
        summaries.push({ ...summary, pathAvailable: true });
      }
    }
    return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private async get(bindingId: string) {
    const encrypted = (await this.read()).encrypted[bindingId];
    if (!encrypted) return null;
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法读取项目绑定。");
    }
    try {
      const value = JSON.parse(
        this.encryption.decryptString(Buffer.from(encrypted, "base64")),
      ) as LocalWorkspaceBinding;
      assertMapping(value);
      return value;
    } catch {
      throw new Error("本机项目绑定已损坏，请重新选择项目目录。");
    }
  }

  private async read() {
    if (this.cached) return this.cached;
    try {
      const raw = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<StoredWorkspaceBindings>;
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

  private async persist(stored: StoredWorkspaceBindings) {
    this.cached = stored;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export const workspaceBindingsPath = (userDataPath: string) =>
  join(userDataPath, "workspace-bindings.json");
