import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { storagePaths } from "./storage-paths.js";

export async function importLegacy(sourceDir = config.legacyDir, targetDir = config.dataDir) {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) throw new Error("迁移源与目标目录不能相同");
  const target = storagePaths(targetDir).database;
  if (fs.existsSync(target)) throw new Error(`目标 ${target} 已存在，拒绝覆盖；请先备份并移走运行库`);
  const files = ["agent.db"].filter((file) => fs.existsSync(path.join(sourceDir, file)));
  if (!files.length) throw new Error("未找到旧数据库；全新安装可以直接 npm start");
  fs.mkdirSync(storagePaths(targetDir).runtime, { recursive: true, mode: 0o700 });
  const backupDir = path.join(storagePaths(targetDir).backups, `before-import-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const source = new DatabaseSync(path.join(sourceDir, "agent.db"), { readOnly: true });
  try {
    await backup(source, path.join(backupDir, "agent.db"));
    await backup(source, target);
    fs.chmodSync(path.join(backupDir, "agent.db"), 0o600);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  } finally { source.close(); }
  console.log(`已一致性备份到 ${backupDir}，导入 ${target}；旧数据库未修改。启动后配置表会自动导出到 data/config/*.json。`);
  return { files, backupDir, target };
}
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) await importLegacy();
