import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { decrypt, encrypt, hashPassword } from "./security.js";
import { AppError, identityOwnerKey, type Identity, type Row } from "./types.js";
import { ConversationStore } from "./conversation-store.js";
import { ConfigStore, defaults } from "./config-store.js";
import { storagePaths } from "./storage-paths.js";
import { attachmentDataUrl, externalizePiImages, hasInlinePiImages, removeSessionUploads, saveAttachments } from "./attachments.js";

export const now = () => new Date().toISOString();
export { defaults } from "./config-store.js";

const agentSchema = `
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', namespace TEXT NOT NULL DEFAULT '', username TEXT NOT NULL, assistant_id INTEGER, title TEXT NOT NULL DEFAULT '新对话', summary TEXT NOT NULL DEFAULT '', summary_until_id INTEGER NOT NULL DEFAULT 0, last_context_tokens INTEGER NOT NULL DEFAULT 0, last_compacted_at TEXT, last_model_id INTEGER, last_model_name TEXT NOT NULL DEFAULT '', total_input_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, tool_failures INTEGER NOT NULL DEFAULT 0, approval_rejections INTEGER NOT NULL DEFAULT 0, compaction_count INTEGER NOT NULL DEFAULT 0, last_status TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', namespace TEXT NOT NULL DEFAULT '', username TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, username TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'agent');
CREATE TABLE IF NOT EXISTS llm_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, username TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT 'chat', attempt INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ok', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS compaction_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, trigger TEXT NOT NULL, before_tokens INTEGER NOT NULL DEFAULT 0, after_tokens INTEGER NOT NULL DEFAULT 0, summarized_messages INTEGER NOT NULL DEFAULT 0, summary_model TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', namespace TEXT NOT NULL DEFAULT '', username TEXT NOT NULL, session_id TEXT, remote_base_url TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT 'index.html', url TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'unlisted', password_set INTEGER NOT NULL DEFAULT 0, version INTEGER, publish_count INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, latest_version_id INTEGER, source TEXT NOT NULL DEFAULT 'preview', status TEXT NOT NULL DEFAULT 'publishing', last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publication_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE, html TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT 'index.html', visibility TEXT NOT NULL DEFAULT 'unlisted', password_set INTEGER NOT NULL DEFAULT 0, code TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', detail_url TEXT NOT NULL DEFAULT '', version INTEGER, size INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'publishing', error TEXT NOT NULL DEFAULT '', response TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_remote_code ON publications(remote_base_url, code) WHERE code != '';
CREATE TABLE IF NOT EXISTS control_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS control_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES control_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS control_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL DEFAULT '', token_cipher TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, allowed_origins TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL DEFAULT '', last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_control_tokens_hash ON control_tokens(token_hash);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, name TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_run_events ON run_events(run_id,id);
CREATE TABLE IF NOT EXISTS approvals_v2 (id TEXT PRIMARY KEY, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', data TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', data TEXT NOT NULL, expires_at TEXT NOT NULL, answered_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id,status);
CREATE TABLE IF NOT EXISTS access_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL DEFAULT '', token_cipher TEXT NOT NULL DEFAULT '', assistant_id INTEGER NOT NULL, channel TEXT NOT NULL DEFAULT 'chat', enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, allowed_origins TEXT NOT NULL DEFAULT '[]', rate_limit_per_minute INTEGER NOT NULL DEFAULT 0, daily_token_limit INTEGER NOT NULL DEFAULT 0, session_retention_days INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_access_tokens_assistant ON access_tokens(assistant_id);
CREATE TABLE IF NOT EXISTS access_sessions (session_hash TEXT PRIMARY KEY, access_token_id INTEGER NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE, visitor_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_access_sessions_token ON access_sessions(access_token_id,expires_at);
`;
const jsonFields = new Set(["extra_headers", "capabilities", "reasoning_efforts", "extra_params", "tool_names", "skill_ids", "skill_slugs", "allowed_roles", "allowed_origins", "definition", "headers", "input_schema", "metadata", "files", "attachments", "tool_runs", "permissions", "config", "response", "data", "payload", "entries", "tags"]);
const boolFields = new Set(["enabled", "is_default", "supports_tools", "supports_reasoning", "supports_reasoning_summary", "supports_transcription", "allow_model_switch", "memory_enabled", "voice_auto_send", "tts_auto_read", "is_admin", "visible", "selectable", "default_selected", "password_set", "ok"]);
export function decode(row: any): Row | undefined {
  if (!row) return undefined;
  const result: Row = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (jsonFields.has(key) && typeof value === "string" && !value.startsWith("enc:v2:")) {
      try { result[key] = JSON.parse(value); } catch { result[key] = ["capabilities", "tool_runs", "attachments", "permissions", "tool_names", "skill_ids", "skill_slugs", "allowed_roles", "entries"].includes(key) ? [] : {}; }
    }
    if (boolFields.has(key)) result[key] = value === null || value === undefined ? null : Boolean(value);
  }
  return result;
}
function encode(value: any) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return Number(value);
  return typeof value === "object" ? JSON.stringify(value) : value;
}
function moveFile(source: string, target: string) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.renameSync(source, target);
}
/** 目标已存在时保留两份：追加 -2、-3… 后缀，绝不覆盖已有备份。 */
function moveFileUnique(source: string, target: string) {
  if (!fs.existsSync(source)) return;
  let destination = target;
  for (let index = 2; fs.existsSync(destination); index++) destination = target.replace(/(\.db)(-[a-z]+)?$/i, `-${index}$1$2`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.renameSync(source, destination);
}
/** 目标已存在时逐文件合并，绝不覆盖同名文件；失败的文件留在原目录便于排查。 */
function moveDirectory(source: string, target: string) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) { moveDirectory(from, to); continue; }
    moveFile(from, to);
  }
  try { if (!fs.readdirSync(source).length) fs.rmdirSync(source); } catch { /* keep non-empty directory */ }
}
/** 把旧版 `data/pi/*` 与 Python 遗留文件迁移到按用途分目录的新的数据根。 */
function migrateDataLayout(dataDir: string) {
  const paths = storagePaths(dataDir);
  const legacyPi = path.join(dataDir, "pi");
  const hadLegacyPi = fs.existsSync(legacyPi);
  if (hadLegacyPi) {
    for (const suffix of ["", "-wal", "-shm"]) moveFile(path.join(legacyPi, `agent.db${suffix}`), `${paths.database}${suffix}`);
    moveDirectory(path.join(legacyPi, "conversations"), paths.sessions);
    moveDirectory(path.join(legacyPi, "skill-library"), paths.skills);
    moveDirectory(path.join(legacyPi, "skill-runtime"), paths.skillRuntime);
    moveDirectory(path.join(legacyPi, "workspaces"), paths.workspaces);
    moveDirectory(path.join(legacyPi, "backups"), paths.backups);
    moveFile(path.join(legacyPi, "models-dev.json"), path.join(paths.cache, "models-dev.json"));
    for (const suffix of ["", "-wal", "-shm"]) moveFileUnique(path.join(legacyPi, `business.db${suffix}`), path.join(paths.legacy, `business.db${suffix}`));
    try { if (!fs.readdirSync(legacyPi).length) fs.rmdirSync(legacyPi); } catch { /* keep non-empty directory */ }
  }
  // 旧版数据根可能残留 Python 项目或早期 PI 版的数据库；新布局不再读写这些路径，一律归档。
  for (const file of ["agent.db", "agent.db-wal", "agent.db-shm", "business.db", "business.db-wal", "business.db-shm", "models_dev_cache.json"]) {
    moveFileUnique(path.join(dataDir, file), path.join(paths.legacy, file));
  }
}
export class Store {
  agent: DatabaseSync;
  conversations: ConversationStore;
  config: ConfigStore;
  readonly paths: ReturnType<typeof storagePaths>;
  constructor(public dataDir = config.dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    migrateDataLayout(dataDir);
    this.paths = storagePaths(dataDir);
    for (const directory of [this.paths.runtime, this.paths.backups, this.paths.sessions, this.paths.skills, this.paths.uploads, this.paths.workspaces, this.paths.cache, this.paths.legacy]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.agent = new DatabaseSync(this.paths.database);
    this.config = new ConfigStore(dataDir);
    this.conversations = new ConversationStore(dataDir);
    this.agent.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;");
    this.agent.exec(agentSchema);
    this.conversations.initialize(this);
    this.migrateInlineAttachments();
    // 必须在导出并删除配置表之前解除 access_tokens 对 assistants 的外键，
    // 否则 SQLite 会因 FK 检查拒绝 DROP TABLE。
    this.migrateAccessTokenForeignKeys();
    // 旧库补列：Token 原文以密文保存，管理端可再次查看与复制。
    for (const table of ["access_tokens", "control_tokens"]) {
      if (!this.columns(table).includes("token_cipher")) this.agent.exec(`ALTER TABLE ${table} ADD COLUMN token_cipher TEXT NOT NULL DEFAULT ''`);
    }
    if (!this.columns("access_tokens").includes("channel")) this.agent.exec("ALTER TABLE access_tokens ADD COLUMN channel TEXT NOT NULL DEFAULT 'chat'");
    this.agent.exec("CREATE INDEX IF NOT EXISTS idx_access_tokens_channel ON access_tokens(channel,enabled)");
    this.importLegacyConfig();
    for (const table of ["sessions", "memories", "publications", "runs", "approvals_v2", "questions"]) {
      const columns = new Set(this.columns(table));
      if (!columns.has("owner_key")) this.agent.exec(`ALTER TABLE ${table} ADD COLUMN owner_key TEXT NOT NULL DEFAULT ''`);
      if (!columns.has("subject") && ["sessions", "memories", "publications"].includes(table)) this.agent.exec(`ALTER TABLE ${table} ADD COLUMN subject TEXT NOT NULL DEFAULT ''`);
      if (!columns.has("namespace") && ["sessions", "memories", "publications"].includes(table)) this.agent.exec(`ALTER TABLE ${table} ADD COLUMN namespace TEXT NOT NULL DEFAULT ''`);
      this.agent.exec(`UPDATE ${table} SET owner_key='user-'||user_id WHERE (owner_key IS NULL OR owner_key='') AND user_id IS NOT NULL`);
      if (["sessions", "memories", "publications"].includes(table)) this.agent.exec(`UPDATE ${table} SET subject='user-'||user_id WHERE (subject IS NULL OR subject='') AND user_id IS NOT NULL`);
    }
    this.relaxLegacyUserIds();
    this.cleanupLegacySchema();
    this.agent.exec("CREATE INDEX IF NOT EXISTS idx_sessions_owner_updated ON sessions(owner_key,updated_at DESC)");
    this.agent.exec("CREATE INDEX IF NOT EXISTS idx_publications_owner_v2 ON publications(owner_key,updated_at DESC)");
    this.agent.exec("CREATE INDEX IF NOT EXISTS idx_memories_owner_updated ON memories(owner_key,updated_at DESC)");
    fs.chmodSync(this.paths.database, 0o600);
  }
  private tableExists(name: string) {
    return Boolean(this.one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]));
  }
  private importLegacyConfig() {
    const names = ["settings", "providers", "models", "assistants", "tool_settings", "dynamic_tools", "mcp_servers"];
    if (!names.some((name) => this.tableExists(name))) return;
    const read = (name: string) => this.tableExists(name) ? this.all(`SELECT * FROM ${name}`) : [];
    const imported = this.config.importLegacy({
      settings: read("settings"),
      providers: read("providers"),
      models: read("models"),
      assistants: read("assistants"),
      toolSettings: read("tool_settings"),
      dynamicTools: read("dynamic_tools"),
      mcpServers: read("mcp_servers"),
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(this.paths.backups, `config-before-json-${stamp}.db`);
    this.agent.prepare("VACUUM INTO ?").run(backup);
    fs.chmodSync(backup, 0o600);
    this.transaction(() => { for (const name of names) this.agent.exec(`DROP TABLE IF EXISTS ${name}`); });
    fs.writeFileSync(path.join(this.paths.config, "imported-from-sqlite.json"), JSON.stringify({ imported, backup, at: now() }, null, 2), { mode: 0o600 });
  }
  private migrateAccessTokenForeignKeys() {
    const sql = String(this.one("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_tokens'")?.sql || "");
    if (!/references\s+assistants/i.test(sql)) return;
    this.agent.exec("PRAGMA foreign_keys=OFF");
    try {
      this.transaction(() => {
        this.agent.exec(`CREATE TABLE access_tokens_new (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL DEFAULT '', assistant_id INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, allowed_origins TEXT NOT NULL DEFAULT '[]', rate_limit_per_minute INTEGER NOT NULL DEFAULT 0, daily_token_limit INTEGER NOT NULL DEFAULT 0, session_retention_days INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.agent.exec("INSERT INTO access_tokens_new SELECT id,name,token_hash,token_prefix,assistant_id,enabled,expires_at,allowed_origins,rate_limit_per_minute,daily_token_limit,session_retention_days,created_by,last_used_at,created_at,updated_at FROM access_tokens");
        this.agent.exec("DROP TABLE access_tokens");
        this.agent.exec("ALTER TABLE access_tokens_new RENAME TO access_tokens");
        this.agent.exec("CREATE INDEX IF NOT EXISTS idx_access_tokens_assistant ON access_tokens(assistant_id)");
      });
    } finally {
      this.agent.exec("PRAGMA foreign_keys=ON");
    }
  }
  private cleanupLegacySchema() {
    const marker = path.join(this.paths.runtime, ".legacy-schema-cleanup-v1");
    if (fs.existsSync(marker)) return;
    const sessionColumns = new Set(this.columns("sessions"));
    const legacyTable = Boolean(this.one("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_approvals'"));
    const legacyColumns: Array<[string, string]> = [
      ...["retry_count", "error_count"].filter((column) => sessionColumns.has(column)).map((column) => ["sessions", column] as [string, string]),
    ];
    if (!legacyTable && !legacyColumns.length) { fs.writeFileSync(marker, now(), { mode: 0o600 }); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(this.paths.backups, `agent-pre-cleanup-${stamp}.db`);
    this.agent.prepare("VACUUM INTO ?").run(backup);
    fs.chmodSync(backup, 0o600);
    this.transaction(() => {
      if (legacyTable) this.agent.exec("DROP TABLE IF EXISTS pending_approvals");
      for (const [table, column] of legacyColumns) {
        if (!this.columns(table).includes(column)) continue;
        try {
          this.agent.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
        } catch (error) {
          console.warn(`[store] 无法删除旧字段 ${table}.${column}，已保留；备份：${backup}`, error);
        }
      }
    });
    fs.writeFileSync(marker, now(), { mode: 0o600 });
  }
  private relaxLegacyUserIds() {
    for (const table of ["sessions", "memories", "publications", "runs", "approvals_v2", "questions"]) {
      const userColumn = this.agent.prepare(`PRAGMA table_info(${table})`).all().find((column: any) => column.name === "user_id");
      if (!userColumn?.notnull) continue;
      for (const index of this.agent.prepare(`PRAGMA index_list(${table})`).all() as any[]) {
        const columns = this.agent.prepare(`PRAGMA index_info("${String(index.name).replaceAll('"', '""')}")`).all() as any[];
        if (columns.some((column) => column.name === "user_id")) this.agent.exec(`DROP INDEX IF EXISTS "${String(index.name).replaceAll('"', '""')}"`);
      }
      this.agent.exec(`ALTER TABLE ${table} RENAME COLUMN user_id TO user_id_legacy`);
      this.agent.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`);
      this.agent.exec(`UPDATE ${table} SET user_id=user_id_legacy`);
      this.agent.exec(`ALTER TABLE ${table} DROP COLUMN user_id_legacy`);
    }
  }
  one(sql: string, values: any[] = []) { return decode(this.agent.prepare(sql).get(...values.map(encode))); }
  all(sql: string, values: any[] = []): Row[] { return this.agent.prepare(sql).all(...values.map(encode)).map((row) => decode(row)!); }
  run(sql: string, values: any[] = []) { return this.agent.prepare(sql).run(...values.map(encode)); }
  transaction<Result>(action: () => Result): Result {
    this.agent.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.agent.exec("COMMIT"); return result; } catch (error) { this.agent.exec("ROLLBACK"); throw error; }
  }
  columns(table: string) { if (!/^[a-z_0-9]+$/.test(table)) throw new Error("Invalid table"); return this.all(`PRAGMA table_info(${table})`).map((row) => row.name as string); }
  insert(table: string, values: Row): Row {
    const columns = this.columns(table);
    const current = now();
    const data = { created_at: current, updated_at: current, ...values };
    const keys = Object.keys(data).filter((key) => columns.includes(key));
    const result = this.run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map((key) => data[key]));
    const id = values.id ?? Number(result.lastInsertRowid);
    return this.one(`SELECT * FROM ${table} WHERE id = ?`, [id])!;
  }
  update(table: string, id: number | string, values: Row): Row | undefined {
    const columns = this.columns(table);
    const data = { ...values, updated_at: now() };
    const keys = Object.keys(data).filter((key) => columns.includes(key) && key !== "id" && key !== "created_at");
    if (keys.length) this.run(`UPDATE ${table} SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`, [...keys.map((key) => data[key]), id]);
    return this.one(`SELECT * FROM ${table} WHERE id=?`, [id]);
  }
  settings(): Row { return this.config.settings(); }
  setSettings(values: Row) { return this.config.setSettings(values); }
  provider(id: number) {
    const row = this.config.provider(id);
    if (row) row.api_key = decrypt(String(row.api_key || ""));
    return row;
  }
  providers() { return this.config.providers(); }
  models(enabled = false) { return this.config.models(enabled); }
  model(id: number) { return this.config.model(id); }
  defaultModel() { return this.config.defaultModel(); }
  assistants() { return this.config.assistants(); }
  assistant(id: number) { return this.config.assistant(id); }
  toolPolicy(name: string) { return this.config.toolPolicy(name); }
  rawToolPolicy(name: string) { return this.config.rawToolPolicy(name); }
  setToolPolicy(name: string, values: Row) { return this.config.setToolPolicy(name, values); }
  httpTools() { return this.config.httpTools(); }
  httpTool(id: number) { return this.config.httpTool(id); }
  saveHttpTool(previous: Row | undefined, values: Row) { return this.config.saveHttpTool(previous, values); }
  deleteHttpTool(id: number) { return this.config.deleteHttpTool(id); }
  mcpServers() { return this.config.mcpServers(); }
  mcpServer(id: number) { return this.config.mcpServer(id); }
  saveMcpServer(previous: Row | undefined, values: Row) { return this.config.saveMcpServer(previous, values); }
  deleteMcpServer(id: number) { return this.config.deleteMcpServer(id); }
  cacheMcpTools(id: number, tools: Row[]) { return this.config.cacheMcpTools(id, tools); }
  ownedSession(id: string, owner: Identity | number) {
    const row = typeof owner === "number"
      ? this.one("SELECT * FROM sessions WHERE id=? AND (owner_key=? OR (owner_key='' AND user_id=?))", [id, `user-${owner}`, owner])
      : this.one("SELECT * FROM sessions WHERE id=? AND (owner_key=? OR (owner_key='' AND user_id=?))", [id, owner.owner_key, owner.id ?? null]);
    if (!row) throw new AppError("会话不存在", 404);
    return row;
  }
  ownerColumns(identity: Identity) {
    return { user_id: identity.id ?? null, owner_key: identity.owner_key || identityOwnerKey(identity.subject, identity.namespace), subject: identity.subject, namespace: identity.namespace || "", username: identity.username };
  }
  assertIdle(id: string, exceptRunId = "") { if (this.one("SELECT id FROM runs WHERE session_id=? AND status='running' AND id<>?", [id, exceptRunId])) throw new AppError("会话正在执行，请先停止任务", 409); }
  audit(username: string, action: string, resource: string, detail: unknown = "") { this.insert("audit_log", { ts: now(), username, action, resource, detail: typeof detail === "string" ? detail : JSON.stringify(detail) }); }
  invalidateContext(sessionId: string) { this.conversations.clearPiEntries(sessionId); this.run("UPDATE sessions SET summary='',summary_until_id=0,last_context_tokens=0,last_compacted_at=NULL WHERE id=?", [sessionId]); }
  async initialize() {
    const controlUser = this.one("SELECT id FROM control_users LIMIT 1");
    if (!controlUser) this.insert("control_users", { username: "admin", password_hash: await hashPassword(config.adminPassword) });
    else if (config.resetAdminPassword) {
      // 显式重置开关：方便用部署平台的 Secret 恢复管理密码；重置后撤销所有管理会话。
      this.update("control_users", controlUser.id, { password_hash: await hashPassword(config.adminPassword) });
      this.run("DELETE FROM control_sessions WHERE user_id=?", [controlUser.id]);
      console.warn("[control] 已按 WEBAGENT_RESET_CONTROL_PASSWORD 重置 admin 密码并撤销管理会话；请移除该变量后重启");
    }
    if (!this.config.assistants().length) this.config.insertAssistant({ name: "默认助手", description: "继承当前业务用户权限，使用已注册的工具协助处理业务。", system_prompt: "你是业务助手，使用工具获取真实数据，不编造结果，不绕过权限。写入操作通过审批工具执行。", is_default: true, enabled: true });
    this.config.removeLegacyDeviceAssistant();
    for (const row of this.config.providers()) if (row.api_key && !String(row.api_key).startsWith("enc:v2:")) this.config.updateProvider(row.id, { api_key: encrypt(decrypt(String(row.api_key))) });
    const savedToken = this.settings().pagepilot_token;
    if (savedToken && !savedToken.startsWith("enc:v2:")) this.setSettings({ pagepilot_token: encrypt(decrypt(savedToken)) });
    this.run("UPDATE runs SET status='interrupted',completed_at=? WHERE status='running'", [now()]);
    this.run("UPDATE approvals_v2 SET status='interrupted' WHERE status='executing'");
    this.run("UPDATE publications SET status='failed',last_error='进程重启，发布结果未知，请核对远端后再操作' WHERE status='publishing'");
    this.run("UPDATE publication_versions SET status='failed',error='进程重启，发布结果未知' WHERE status='publishing'");
    this.purge();
  }
  purge() {
    const settings = this.settings();
    const days = settings.session_retention_days;
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const expired = "SELECT id FROM sessions WHERE updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running')";
      const expiredIds = this.all(expired, [cutoff]).map((row) => String(row.id));
      for (const id of expiredIds) this.removeSession(id);
    }
    this.run("DELETE FROM control_sessions WHERE expires_at < ?", [now()]);
    this.run("DELETE FROM access_sessions WHERE expires_at < ?", [now()]);
    for (const token of this.all("SELECT id,session_retention_days FROM access_tokens WHERE session_retention_days > 0")) {
      const cutoff = new Date(Date.now() - Number(token.session_retention_days) * 86400000).toISOString();
      const prefix = `token-${token.id}:%`;
      const expiredIds = this.all("SELECT id FROM sessions WHERE owner_key LIKE ? AND updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running')", [prefix, cutoff]).map((row) => String(row.id));
      for (const id of expiredIds) this.removeSession(id);
    }
    this.removeOrphanWorkspaces();
    this.removeOrphanUploads();
    this.removeOrphanBrandLogos();
    this.run("UPDATE approvals_v2 SET status='expired' WHERE status='pending' AND expires_at < ?", [now()]);
    this.run("UPDATE questions SET status='expired' WHERE status='pending' AND expires_at < ?", [now()]);
    if (settings.run_event_retention_hours > 0) this.run("DELETE FROM run_events WHERE created_at < ?", [new Date(Date.now() - settings.run_event_retention_hours * 3600000).toISOString()]);
    if (settings.llm_call_retention_days > 0) this.run("DELETE FROM llm_calls WHERE created_at < ?", [new Date(Date.now() - settings.llm_call_retention_days * 86400000).toISOString()]);
    if (settings.compaction_event_retention_days > 0) this.run("DELETE FROM compaction_events WHERE created_at < ?", [new Date(Date.now() - settings.compaction_event_retention_days * 86400000).toISOString()]);
    if (settings.audit_retention_days > 0) this.run("DELETE FROM audit_log WHERE ts < ?", [new Date(Date.now() - settings.audit_retention_days * 86400000).toISOString()]);
  }

  /** 删除会话的统一入口：正文文件、运行元数据、审批 / 问答与工作目录一起清理。 */
  removeSession(sessionId: string) {
    if (this.one("SELECT id FROM runs WHERE session_id=? AND status='running'", [sessionId])) return false;
    this.transaction(() => {
      this.run("DELETE FROM llm_calls WHERE session_id=?", [sessionId]);
      this.run("DELETE FROM compaction_events WHERE session_id=?", [sessionId]);
      this.run("UPDATE publications SET session_id=NULL WHERE session_id=?", [sessionId]);
      // runs / run_events / approvals_v2 / questions 依赖 ON DELETE CASCADE。
      this.run("DELETE FROM sessions WHERE id=?", [sessionId]);
    });
    this.conversations.delete(sessionId);
    fs.rmSync(path.join(this.paths.workspaces, sessionId), { recursive: true, force: true });
    removeSessionUploads(this.dataDir, sessionId);
    return true;
  }

  /**
   * 旧版把图片 Base64 内联在会话 JSON 里。启动时一次性搬到 `data/uploads/<sessionId>/`，
   * 只替换成功写入的附件；失败保留内联数据，不影响会话可读性。
   */
  private migrateInlineAttachments() {
    const marker = path.join(this.paths.runtime, ".attachments-local-v2");
    if (fs.existsSync(marker)) return;
    let failed = false;
    for (const sessionId of this.conversations.sessionIds()) {
      try {
        for (const message of this.conversations.messages(sessionId)) {
          const attachments: Row[] = Array.isArray(message.attachments) ? message.attachments : [];
          if (!attachments.some((item) => typeof item?.data_url === "string" && String(item.data_url).startsWith("data:"))) continue;
          const migrated = attachments.map((item) => {
            if (!item?.data_url) return item;
            if (attachmentDataUrl(this.dataDir, sessionId, item)) {
              const [saved] = saveAttachments(this.dataDir, sessionId, [item]);
              return saved;
            }
            return item;
          });
          this.conversations.update(sessionId, Number(message.id), { attachments: migrated });
        }
        const entries = this.conversations.piEntries(sessionId);
        if (hasInlinePiImages(entries)) {
          externalizePiImages(this.dataDir, sessionId, entries);
          this.conversations.savePiEntries(sessionId, entries);
        }
      } catch (error) {
        failed = true;
        console.warn(`[attachments] 会话 ${sessionId} 图片迁移失败，保留内联数据：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!failed) fs.writeFileSync(marker, new Date().toISOString(), { mode: 0o600 });
  }

  /** 清理没有对应会话记录的遗留工作目录（例如旧版本删除会话时未清理）。 */
  removeOrphanWorkspaces() {
    try {
      const known = new Set(this.all("SELECT id FROM sessions").map((row) => String(row.id)));
      for (const entry of fs.readdirSync(this.paths.workspaces, { withFileTypes: true })) {
        if (!entry.isDirectory() || known.has(entry.name)) continue;
        fs.rmSync(path.join(this.paths.workspaces, entry.name), { recursive: true, force: true });
      }
    } catch { /* 清理失败不影响主流程 */ }
  }

  /** 清理没有对应会话记录的孤儿附件目录。 */
  removeOrphanUploads() {
    try {
      const known = new Set(this.all("SELECT id FROM sessions").map((row) => String(row.id)));
      for (const entry of fs.readdirSync(this.paths.uploads, { withFileTypes: true })) {
        if (!entry.isDirectory() || known.has(entry.name)) continue;
        fs.rmSync(path.join(this.paths.uploads, entry.name), { recursive: true, force: true });
      }
    } catch { /* 清理失败不影响主流程 */ }
  }

  /**
   * 清理没被任何助手 / 全局设置引用的品牌徽标。
   * 保留 24 小时内上传的文件，避免刚上传还没点保存就被清掉。
   */
  removeOrphanBrandLogos() {
    try {
      const directory = this.paths.brand;
      const referenced = new Set<string>();
      for (const row of [{ welcome_logo: this.settings().welcome_logo }, ...this.assistants()]) {
        const file = String(row?.welcome_logo || "").split("/").pop();
        if (file) referenced.add(file);
      }
      const cutoff = Date.now() - 24 * 3600 * 1000;
      for (const file of fs.readdirSync(directory)) {
        if (referenced.has(file)) continue;
        const target = path.join(directory, file);
        try { if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { force: true }); } catch { /* 单个文件失败忽略 */ }
      }
    } catch { /* 目录不存在或读取失败都不影响主流程 */ }
  }
  close() { this.agent.close(); }
}
