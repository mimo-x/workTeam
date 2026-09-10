import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bugDir = process.env.BUG_GOVERNANCE_DIR
  ? resolve(process.env.BUG_GOVERNANCE_DIR)
  : join(root, "docs", "bugs");
const files = readdirSync(bugDir).filter((name) => /^BUG-\d{8}-\d{3}\.md$/.test(name));
const errors = [];

for (const file of files) {
  const content = readFileSync(join(bugDir, file), "utf8");
  const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontMatter) {
    errors.push(`${file}: 缺少 YAML front matter`);
    continue;
  }
  const values = new Map();
  for (const line of frontMatter[1].split("\n")) {
    const match = line.match(/^([a-z_]+):\s*(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }
  for (const key of ["bug_id", "status", "openspec_change", "commit"])
    if (!values.get(key)) errors.push(`${file}: 缺少字段 ${key}`);
  if (!/^tests:\s*$/m.test(frontMatter[1])) errors.push(`${file}: 缺少字段 tests`);
  if (values.get("bug_id") !== file.slice(0, -3)) errors.push(`${file}: bug_id 与文件名不一致`);
  if (!/^BUG-\d{8}-\d{3}$/.test(values.get("bug_id") ?? ""))
    errors.push(`${file}: bug_id 格式无效`);
  if (!content.includes("Given ") || !content.includes("When ") || !content.includes("Then "))
    errors.push(`${file}: 缺少 Given/When/Then BDD Case`);
  for (const line of content.match(/^\s+-\s+(tests\/[^\s]+)$/gm) ?? []) {
    const testPath = line.replace(/^\s+-\s+/, "");
    if (!existsSync(join(root, testPath))) errors.push(`${file}: 测试文件不存在 ${testPath}`);
  }
}

if (!files.length) errors.push("docs/bugs 中没有 Bug 记录");
if (errors.length) {
  console.error(errors.map((error) => `✗ ${error}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${files.length} 个 Bug 记录通过门禁`);
