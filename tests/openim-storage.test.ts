import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// 只替换 Electron 平台 API，执行真实的配置类和文件系统操作。
const loadClasses = async () => {
  const bundle = await build({
    stdin: {
      contents:
        'export {BackendClient} from "./src/main/backend-client"; export {ImConfigStore} from "./src/main/im-config";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "electron-test",
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents:
              "export const app={isPackaged:false};export const safeStorage={isEncryptionAvailable:()=>false};",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
};

for (const mode of ["cloud", "manual"]) {
  test(`Given ${mode} 新目录 When 获取配置 Then 创建目录且重复调用保留数据`, async () => {
    const { BackendClient, ImConfigStore } = await loadClasses();
    const root = await mkdtemp(join(tmpdir(), "openim-storage-"));
    try {
      const directory = join(root, "nested", "db");
      const client = new BackendClient(join(root, "config.json"), directory);
      client.request = async () => ({
        apiAddr: "http://localhost",
        wsAddr: "ws://localhost",
        userId: "test",
        token: "test",
      });
      const manual = new ImConfigStore(join(root, "manual.json"));
      const get = () =>
        mode === "cloud" ? client.getImRuntimeConfig() : manual.getRuntimeConfig(directory);
      await get();
      assert.equal((await stat(directory)).isDirectory(), true);
      const marker = join(directory, "existing.db");
      await writeFile(marker, "keep");
      await get();
      assert.equal(await readFile(marker, "utf8"), "keep");
      await rm(directory, { recursive: true });
      await writeFile(directory, "blocked");
      await assert.rejects(get(), /EEXIST|ENOTDIR/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
