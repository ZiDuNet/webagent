import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { DatabaseSync, backup } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
try { process.loadEnvFile(path.join(root, ".env")); } catch {}
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("用法：npm run core:upgrade -- 1.5.2 [--apply]，只接受精确稳定版本号");
const packages = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];
for (const name of packages) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${name}@${version} 未在官方 npm 发布`);
  const metadata = await response.json(); if (metadata.name !== name || metadata.version !== version) throw new Error("注册表元信息不一致");
}
if (!process.argv.includes("--apply")) { console.log(`预检查通过：${packages.join(", ")} → ${version}。执行需要停止后端，再加 --apply。`); process.exit(0); }
const port = Number(process.env.WEBAGENT_PORT || 8000);
let running = false;
try { const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }); running = response.ok; } catch {}
if (running) throw new Error("请先停止本地后端。禁止运行中升级 PI。");
const destination = path.join(root, "backups", `pi-upgrade-${Date.now()}`);
await fs.mkdir(destination, { recursive: true, mode: 0o700 });
const files = ["server/package.json", "package-lock.json"];
for (const file of files) await fs.copyFile(path.join(root, file), path.join(destination, path.basename(file)));
const dataDir = process.env.WEBAGENT_PI_DATA_DIR || path.join(root, "data/pi");
for (const name of ["agent.db", "business.db"]) {
  try { await fs.access(path.join(dataDir, name)); } catch { continue; }
  const db = new DatabaseSync(path.join(dataDir, name), { readOnly: true });
  try { if (name === "agent.db") { const rows = db.prepare("SELECT count(*) AS n FROM runs WHERE status='running'").get(); if (rows.n) throw new Error("存在未完成任务，请先核对任务状态"); } await backup(db, path.join(destination, name)); await fs.chmod(path.join(destination, name), 0o600); } finally { db.close(); }
}
const run = (args) => new Promise((resolve, reject) => { const child = spawn("npm", args, { cwd: root, stdio: "inherit", shell: false }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm ${args.join(" ")} 失败（${code}）`))); });
try {
  const manifestPath = path.join(root, "server/package.json"); const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  for (const name of packages) manifest.dependencies[name] = version;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await run(["install", "--ignore-scripts", "--registry=https://registry.npmjs.org"]);
  await run(["run", "typecheck"]); await run(["test"]); await run(["run", "build"]);
  console.log(`PI 升级验证成功，备份：${destination}。请 npm start 并进行业务验收；没有自动重启或提交代码。`);
} catch (error) {
  for (const file of files) await fs.copyFile(path.join(destination, path.basename(file)), path.join(root, file));
  try { await run(["ci", "--ignore-scripts", "--registry=https://registry.npmjs.org"]); } catch { console.error("依赖恢复安装失败；原 lockfile 已恢复，请手动 npm ci。"); }
  throw error;
}
