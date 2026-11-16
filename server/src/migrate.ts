import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export async function importLegacy(sourceDir = config.legacyDir, targetDir = config.dataDir) {
  if (path.resolve(sourceDir) === path.resolve(targetDir)) throw new Error("迁移源与目标目录不能相同");
  const files = ["agent.db", "business.db"].filter((file) => fs.existsSync(path.join(sourceDir, file)));
  if (!files.length) throw new Error("未找到旧数据库；全新安装可以直接 npm start");
  for (const file of files) if (fs.existsSync(path.join(targetDir, file))) throw new Error(`目标 ${file} 已存在，拒绝覆盖；请使用新的 WEBAGENT_PI_DATA_DIR`);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const backupDir = path.join(config.legacyDir, "../backups", `before-pi-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const completed: string[] = [];
  try {
    for (const file of files) {
      const source = new DatabaseSync(path.join(sourceDir, file), { readOnly: true });
      try {
        await backup(source, path.join(backupDir, file));
        await backup(source, path.join(targetDir, file));
        fs.chmodSync(path.join(backupDir, file), 0o600);
        fs.chmodSync(path.join(targetDir, file), 0o600);
        completed.push(file);
      } finally { source.close(); }
    }
  } catch (error) { for (const file of completed) fs.rmSync(path.join(targetDir, file)); throw error; }
  console.log(`已一致性备份到 ${backupDir}，导入 ${targetDir}；旧数据库未修改。`);
  return { files, backupDir, targetDir };
}
if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) await importLegacy();
