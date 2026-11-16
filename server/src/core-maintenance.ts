import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootDir } from "./config.js";
import { requestJson } from "./providers.js";
import { AppError } from "./types.js";

export const piPackages = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];
export function installedVersion(packageName: string) {
  let folder = path.dirname(fileURLToPath(import.meta.resolve(packageName)));
  while (folder !== path.dirname(folder)) {
    try { const metadata = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8")); if (metadata.name === packageName) return metadata.version as string; } catch {}
    folder = path.dirname(folder);
  }
  throw new Error(`找不到 ${packageName} 的版本信息`);
}
export class CoreMaintenance {
  info() {
    const declared = JSON.parse(fs.readFileSync(path.join(rootDir, "server/package.json"), "utf8"));
    return { runtime: "pi", adapter_version: "2.0.0", repository: "https://github.com/earendil-works/pi", node: process.versions.node, packages: piPackages.map((name) => ({ name, installed: installedVersion(name), pinned: declared.dependencies[name] })), upgrade_mode: "offline-verified", hot_upgrade: false, capabilities: ["sessions", "compaction", "streaming", "native-tools", "mcp", "bm25", "decision-policy", "approvals"] };
  }
  async updates() {
    const latest = await requestJson(`https://registry.npmjs.org/${encodeURIComponent(piPackages[0])}/latest`, { signal: AbortSignal.timeout(8000) });
    return { ...this.info(), latest_version: latest.version, update_available: latest.version !== installedVersion(piPackages[0]), engines: latest.engines || {} };
  }
  async plan(version: string) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new AppError("仅支持 npm 官方仓库已发布的精确稳定版本号", 422);
    const metadata = await Promise.all(piPackages.map((name) => requestJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { signal: AbortSignal.timeout(8000) })));
    if (metadata.some((item, index) => item.version !== version || item.name !== piPackages[index])) throw new AppError("PI 三个包没有一致的发布版本", 422);
    return { version, status: "plan-only", requires_restart: true, backup_required: true, packages: metadata.map((item) => ({ name: item.name, version: item.version, integrity: item.dist?.integrity, engines: item.engines })), command: `npm run core:upgrade -- ${version} --apply`, steps: ["停止后端并确认无活动任务", "备份数据库、依赖声明与 lockfile", "同步锁定三个 PI 包的精确版本", "安装并运行类型检查、回归测试、构建", "失败自动恢复依赖声明，数据库不执行升级脚本", "成功后手动启动服务并验证业务"], warning: "管理 HTTP 接口不会安装或执行 npm 包，也不支持任意包名、URL 或在线热替换。" };
  }
}
