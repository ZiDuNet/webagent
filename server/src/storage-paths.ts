import path from "node:path";

/**
 * 单一数据根目录布局。所有可变数据都在 `WEBAGENT_DATA_DIR` 下，按用途分目录：
 *
 * data/
 * ├─ config/      供应商、模型、助手、全局设置（JSON）
 * ├─ tools/       HTTP / MCP 工具定义与策略（JSON）
 * ├─ skills/      Skill 正文与参考文件（文件系统）
 * ├─ sessions/    会话正文与 PI canonical entries（每条会话一个 JSON）
 * ├─ uploads/     会话图片附件（JSON 只保存相对路径）
 * ├─ brand/      空态品牌徽标（助手配置只保存相对路径）
 * ├─ runtime/     SQLite 运行库、备份、Skill 物化副本
 * ├─ workspaces/  每会话隔离工作目录
 * └─ cache/       models.dev 等可重建缓存
 */
export function storagePaths(dataDir: string) {
  return {
    root: dataDir,
    config: path.join(dataDir, "config"),
    tools: path.join(dataDir, "tools"),
    httpTools: path.join(dataDir, "tools", "http"),
    mcpTools: path.join(dataDir, "tools", "mcp"),
    toolCache: path.join(dataDir, "tools", "cache"),
    skills: path.join(dataDir, "skills"),
    sessions: path.join(dataDir, "sessions"),
    uploads: path.join(dataDir, "uploads"),
    brand: path.join(dataDir, "brand"),
    runtime: path.join(dataDir, "runtime"),
    database: path.join(dataDir, "runtime", "agent.db"),
    backups: path.join(dataDir, "runtime", "backups"),
    skillRuntime: path.join(dataDir, "runtime", "skill-runtime"),
    workspaces: path.join(dataDir, "workspaces"),
    cache: path.join(dataDir, "cache"),
    legacy: path.join(dataDir, "legacy-backup"),
  };
}
