import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { decrypt, encrypt, hashPassword } from "./security.js";
import { promptDefaults } from "./prompts.js";
import { AppError, identityOwnerKey, type Identity, type Row } from "./types.js";
import { ConversationStore } from "./conversation-store.js";

export const now = () => new Date().toISOString();
export const defaults: Row = {
  max_iterations: 6, max_tool_calls: 12, max_run_seconds: 120, context_max_tokens: 0,
  context_compression: true, bm25_enabled: false, tool_selection_mode: "none", decision_enabled: false,
  decision_model_id: null, decision_tools: true, decision_skills: true, decision_threshold: 0.6,
  decision_min_count: 8, decision_timeout_seconds: 5, memory_enabled: true,
  memory_auto_extract: false, memory_auto_confirm: false, memory_model_id: null,
  memory_extraction_prompt: promptDefaults.memory_extraction_prompt,
  base_system_prompt: promptDefaults.base_system_prompt,
  compaction_prompt: promptDefaults.compaction_prompt,
  title_prompt: promptDefaults.title_prompt,
  decision_prompt: promptDefaults.decision_prompt,
  system_prompt_extra: "", demo_mode: false, default_reasoning_effort: "",
  default_approval_mode: "confirm", allow_full_access: true,
  welcome_title: "有什么我能帮你的吗？", welcome_subtitle: "", welcome_prompts: "查询设备状态\n统计离线设备\n帮我整理运维报告",
  asr_model_id: null, asr_realtime_model_id: null, tts_model_id: null, voice_asr_model_id: null, voice_tts_model_id: null,
  voice_input_mode: "auto", voice_auto_send: false, tts_auto_read: false, tts_max_read_chars: 1200,
  skills_enabled: true, skill_files_enabled: true, title_model_id: null, fallback_model_id: null,
  context_reserve_tokens: 1600, compaction_model_id: null, compaction_keep_ratio: 0.58,
  session_retention_days: 30, admin_session_content: true, user_daily_token_limit: 0,
  context_max_rounds: 0, retry_enabled: true, retry_max_attempts: 3,
  retry_initial_backoff_ms: 800, retry_max_backoff_ms: 8000, retry_multiplier: 2,
  retry_jitter: 0.2, retry_honor_retry_after: true, retry_max_elapsed_seconds: 60,
  run_event_retention_hours: 24, llm_call_retention_days: 0,
  compaction_event_retention_days: 0, audit_retention_days: 0,
  store_reasoning: false, pagepilot_base_url: "", pagepilot_token: "", pagepilot_enabled: false,
  pagepilot_default_title: "", pagepilot_default_description: "", pagepilot_default_visibility: "unlisted",
  modelsdev_cache_hours: 168,
};

const agentSchema = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, provider_type TEXT NOT NULL DEFAULT 'openai_compatible', base_url TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', extra_headers TEXT NOT NULL DEFAULT '{}', timeout_seconds REAL NOT NULL DEFAULT 90, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS models (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id INTEGER REFERENCES providers(id), name TEXT NOT NULL, model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, model_kind TEXT NOT NULL DEFAULT 'chat', capabilities TEXT NOT NULL DEFAULT '["text"]', supports_tools INTEGER NOT NULL DEFAULT 1, context_window INTEGER NOT NULL DEFAULT 0, max_output_tokens INTEGER NOT NULL DEFAULT 0, temperature REAL NOT NULL DEFAULT 0.3, top_p REAL NOT NULL DEFAULT 1, input_price_per_1m REAL NOT NULL DEFAULT 0, output_price_per_1m REAL NOT NULL DEFAULT 0, supports_reasoning INTEGER NOT NULL DEFAULT 0, reasoning_style TEXT NOT NULL DEFAULT 'effort', reasoning_efforts TEXT NOT NULL DEFAULT '[]', default_reasoning_effort TEXT NOT NULL DEFAULT '', supports_reasoning_summary INTEGER NOT NULL DEFAULT 1, supports_transcription INTEGER NOT NULL DEFAULT 0, metadata_source TEXT NOT NULL DEFAULT '', extra_params TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assistants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', model_row_id INTEGER, allow_model_switch INTEGER NOT NULL DEFAULT 1, tool_names TEXT NOT NULL DEFAULT '[]', skill_ids TEXT NOT NULL DEFAULT '[]', skill_slugs TEXT NOT NULL DEFAULT '[]', max_steps INTEGER NOT NULL DEFAULT 0, max_tool_calls INTEGER NOT NULL DEFAULT 0, max_run_seconds INTEGER NOT NULL DEFAULT 0, context_max_tokens INTEGER NOT NULL DEFAULT 0, memory_enabled INTEGER NOT NULL DEFAULT 1, allowed_roles TEXT NOT NULL DEFAULT '["*"]', asr_model_id INTEGER, asr_realtime_model_id INTEGER, tts_model_id INTEGER, voice_asr_model_id INTEGER, voice_tts_model_id INTEGER, voice_input_mode TEXT, voice_auto_send INTEGER, tts_auto_read INTEGER, tts_max_read_chars INTEGER, default_reasoning_effort TEXT, default_approval_mode TEXT, enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 100, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_settings (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, visible INTEGER NOT NULL DEFAULT 1, selectable INTEGER NOT NULL DEFAULT 1, default_selected INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'builtin', definition TEXT NOT NULL DEFAULT '{}', tags TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dynamic_tools (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '业务连接器', permission TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL DEFAULT 'read', method TEXT NOT NULL DEFAULT 'GET', url_template TEXT NOT NULL, headers TEXT NOT NULL DEFAULT '{}', input_schema TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, transport TEXT NOT NULL DEFAULT 'http', config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
CREATE TABLE IF NOT EXISTS control_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, allowed_origins TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL DEFAULT '', last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_control_tokens_hash ON control_tokens(token_hash);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, name TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_run_events ON run_events(run_id,id);
CREATE TABLE IF NOT EXISTS approvals_v2 (id TEXT PRIMARY KEY, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', data TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, user_id INTEGER, owner_key TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', data TEXT NOT NULL, expires_at TEXT NOT NULL, answered_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id,status);
CREATE TABLE IF NOT EXISTS access_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL DEFAULT '', assistant_id INTEGER NOT NULL REFERENCES assistants(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, allowed_origins TEXT NOT NULL DEFAULT '[]', rate_limit_per_minute INTEGER NOT NULL DEFAULT 0, daily_token_limit INTEGER NOT NULL DEFAULT 0, session_retention_days INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_access_tokens_assistant ON access_tokens(assistant_id);
CREATE TABLE IF NOT EXISTS access_sessions (session_hash TEXT PRIMARY KEY, access_token_id INTEGER NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE, visitor_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_access_sessions_token ON access_sessions(access_token_id,expires_at);
`;
const businessSchema = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, device_type TEXT NOT NULL, serial_no TEXT NOT NULL UNIQUE, location TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '在线', owner TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id INTEGER, username TEXT NOT NULL, source TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
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
export class Store {
  agent: DatabaseSync;
  business: DatabaseSync;
  conversations: ConversationStore;
  constructor(public dataDir = config.dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.agent = new DatabaseSync(path.join(dataDir, "agent.db"));
    this.business = new DatabaseSync(path.join(dataDir, "business.db"));
    this.conversations = new ConversationStore(dataDir);
    for (const connection of [this.agent, this.business]) connection.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;");
    this.agent.exec(agentSchema);
    this.conversations.initialize(this);
    this.business.exec(businessSchema);
    const toolColumns = new Set(this.columns("tool_settings"));
    if (!toolColumns.has("tags")) this.agent.exec("ALTER TABLE tool_settings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    const assistantColumns = new Set(this.columns("assistants"));
    if (!assistantColumns.has("skill_slugs")) this.agent.exec("ALTER TABLE assistants ADD COLUMN skill_slugs TEXT NOT NULL DEFAULT '[]'");
    const assistantOverrides: Array<[string, string]> = [
      ["asr_model_id", "INTEGER"],
      ["asr_realtime_model_id", "INTEGER"],
      ["tts_model_id", "INTEGER"],
      ["voice_asr_model_id", "INTEGER"],
      ["voice_tts_model_id", "INTEGER"],
      ["voice_input_mode", "TEXT"],
      ["voice_auto_send", "INTEGER"],
      ["tts_auto_read", "INTEGER"],
      ["tts_max_read_chars", "INTEGER"],
      ["default_reasoning_effort", "TEXT"],
      ["default_approval_mode", "TEXT"],
    ];
    for (const [column, type] of assistantOverrides) if (!assistantColumns.has(column)) this.agent.exec(`ALTER TABLE assistants ADD COLUMN ${column} ${type}`);
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
    for (const file of ["agent.db", "business.db"]) fs.chmodSync(path.join(dataDir, file), 0o600);
  }
  private cleanupLegacySchema() {
    const marker = "legacy_schema_cleanup_v1";
    if (this.one("SELECT value FROM settings WHERE key=?", [marker])) return;
    const assistantColumns = new Set(this.columns("assistants"));
    const sessionColumns = new Set(this.columns("sessions"));
    const legacyTable = Boolean(this.one("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_approvals'"));
    const legacySettingKeys = ["llm_api_key", "llm_base_url", "llm_temperature", "display_mode"];
    const legacySettings = Number(this.one(`SELECT COUNT(*) AS n FROM settings WHERE key IN (${legacySettingKeys.map(() => "?").join(",")})`, legacySettingKeys)?.n || 0) > 0;
    const legacyColumns: Array<[string, string]> = [
      ...["icon", "greeting", "mode", "prefetch_tools"].filter((column) => assistantColumns.has(column)).map((column) => ["assistants", column] as [string, string]),
      ...["retry_count", "error_count"].filter((column) => sessionColumns.has(column)).map((column) => ["sessions", column] as [string, string]),
    ];
    if (!legacyTable && !legacySettings && !legacyColumns.length) return;
    const directory = path.join(this.dataDir, "backups");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(directory, `agent-pre-cleanup-${stamp}.db`);
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
      this.run(`DELETE FROM settings WHERE key IN (${legacySettingKeys.map(() => "?").join(",")})`, legacySettingKeys);
      this.run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [marker, now()]);
    });
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
  one(sql: string, values: any[] = [], business = false) { return decode((business ? this.business : this.agent).prepare(sql).get(...values.map(encode))); }
  all(sql: string, values: any[] = [], business = false): Row[] { return (business ? this.business : this.agent).prepare(sql).all(...values.map(encode)).map((row) => decode(row)!); }
  run(sql: string, values: any[] = [], business = false) { return (business ? this.business : this.agent).prepare(sql).run(...values.map(encode)); }
  transaction<Result>(action: () => Result, business = false): Result {
    const db = business ? this.business : this.agent;
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  columns(table: string, business = false) { if (!/^[a-z_0-9]+$/.test(table)) throw new Error("Invalid table"); return this.all(`PRAGMA table_info(${table})`, [], business).map((row) => row.name as string); }
  insert(table: string, values: Row, business = false): Row {
    const columns = this.columns(table, business);
    const current = now();
    const data = { created_at: current, updated_at: current, ...values };
    const keys = Object.keys(data).filter((key) => columns.includes(key));
    const result = this.run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map((key) => data[key]), business);
    const id = values.id ?? Number(result.lastInsertRowid);
    return this.one(`SELECT * FROM ${table} WHERE ${table === "tool_settings" ? "name" : "id"} = ?`, [table === "tool_settings" ? values.name : id], business)!;
  }
  update(table: string, id: number | string, values: Row, business = false): Row | undefined {
    const columns = this.columns(table, business);
    const data = { ...values, updated_at: now() };
    const keys = Object.keys(data).filter((key) => columns.includes(key) && key !== "id" && key !== "created_at");
    const idColumn = table === "tool_settings" ? "name" : "id";
    if (keys.length) this.run(`UPDATE ${table} SET ${keys.map((key) => `${key}=?`).join(",")} WHERE ${idColumn}=?`, [...keys.map((key) => data[key]), id], business);
    return this.one(`SELECT * FROM ${table} WHERE ${idColumn}=?`, [id], business);
  }
  settings(): Row {
    const result = { ...defaults };
    for (const row of this.all("SELECT * FROM settings")) {
      if (!(row.key in defaults)) continue;
      const fallback = defaults[row.key];
      result[row.key] = typeof fallback === "boolean" ? /^(1|true)$/.test(row.value) : typeof fallback === "number" ? Number(row.value) : fallback === null ? (Number(row.value) || null) : row.value;
    }
    const selectedMode = this.one("SELECT value FROM settings WHERE key='tool_selection_mode'")?.value;
    if (selectedMode) { result.bm25_enabled = selectedMode === "bm25"; result.decision_enabled = selectedMode === "decision"; }
    else if (result.decision_enabled) result.bm25_enabled = false;
    result.tool_selection_mode = result.decision_enabled ? "decision" : result.bm25_enabled ? "bm25" : "none";
    return result;
  }
  setSettings(values: Row) {
    this.transaction(() => { for (const [key, value] of Object.entries(values)) if (key in defaults) this.run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value === null ? "" : typeof value === "boolean" ? String(Number(value)) : String(value)]); });
    return this.settings();
  }
  provider(id: number) {
    const row = this.one("SELECT * FROM providers WHERE id=?", [id]);
    if (row) row.api_key = decrypt(row.api_key);
    return row;
  }
  models(enabled = false) { return this.all(`SELECT m.*,p.name AS provider_name,p.enabled AS provider_enabled FROM models m LEFT JOIN providers p ON p.id=m.provider_id ${enabled ? "WHERE m.enabled=1 AND p.enabled=1" : ""} ORDER BY m.sort_order,m.id`); }
  model(id: number) { return this.models().find((model) => model.id === id); }
  defaultModel() { return this.models(true).find((model) => model.is_default && ["chat", "vision"].includes(model.model_kind)) || this.models(true).find((model) => ["chat", "vision"].includes(model.model_kind)); }
  ownedSession(id: string, owner: Identity | number) {
    const row = typeof owner === "number"
      ? this.one("SELECT s.*,a.name AS assistant_name FROM sessions s LEFT JOIN assistants a ON a.id=s.assistant_id WHERE s.id=? AND (owner_key=? OR (owner_key='' AND user_id=?))", [id, `user-${owner}`, owner])
      : this.one("SELECT s.*,a.name AS assistant_name FROM sessions s LEFT JOIN assistants a ON a.id=s.assistant_id WHERE s.id=? AND (owner_key=? OR (owner_key='' AND user_id=?))", [id, owner.owner_key, owner.id ?? null]);
    if (!row) throw new AppError("会话不存在", 404);
    return row;
  }
  ownerColumns(identity: Identity) {
    return { user_id: identity.id ?? null, owner_key: identity.owner_key || identityOwnerKey(identity.subject, identity.namespace), subject: identity.subject, namespace: identity.namespace || "", username: identity.username };
  }
  assertIdle(id: string, exceptRunId = "") { if (this.one("SELECT id FROM runs WHERE session_id=? AND status='running' AND id<>?", [id, exceptRunId])) throw new AppError("会话正在执行，请先停止任务", 409); }
  audit(username: string, action: string, resource: string, detail: unknown = "") { this.insert("audit_log", { ts: now(), username, action, resource, detail: typeof detail === "string" ? detail : JSON.stringify(detail) }); }
  invalidateContext(sessionId: string) { this.conversations.clearPiEntries(sessionId); this.run("UPDATE sessions SET summary='',summary_until_id=0,last_context_tokens=0,last_compacted_at=NULL WHERE id=?", [sessionId]); }
  async initialize(demoBusiness = true) {
    if (!this.one("SELECT id FROM control_users LIMIT 1")) this.insert("control_users", { username: "admin", password_hash: await hashPassword(config.adminPassword) });
    if (demoBusiness && !this.one("SELECT id FROM users LIMIT 1", [], true)) {
      const full = ["profile:read", "device:read", "device:create", "device:update", "device:delete", "user:manage", "session:read_all"];
      const users = [{ username: "admin", password: config.businessPassword, role: "admin", permissions: full, is_admin: true }];
      if (config.seedDemo) for (const [username, permissions] of [["user1", ["profile:read", "device:read"]], ["user2", ["profile:read", "device:read", "device:update"]], ["user3", ["profile:read", "device:read", "device:update", "device:delete"]]] as const) users.push({ username, password: `${username}pass`, role: username, permissions: [...permissions], is_admin: false });
      for (const user of users) this.insert("users", { ...user, display_name: user.username, password_hash: await hashPassword(user.password) }, true);
      for (const [index, name] of ["核心交换机", "边缘路由器", "数据库服务器", "监控摄像头", "温湿度传感器"].entries()) this.insert("devices", { name, device_type: ["交换机", "路由器", "服务器", "摄像头", "传感器"][index], serial_no: `SN-DEMO-00${index + 1}`, location: `机房 ${index + 1}`, status: index === 3 ? "离线" : "在线" }, true);
    }
    if (!this.one("SELECT id FROM assistants LIMIT 1")) this.insert("assistants", { name: demoBusiness ? "设备管理助手" : "默认助手", description: "继承当前业务用户权限，使用已注册的工具协助处理业务。", system_prompt: "你是业务助手，使用工具获取真实数据，不编造结果，不绕过权限。写入操作通过审批工具执行。", is_default: true });
    for (const row of this.all("SELECT id,api_key FROM providers")) if (row.api_key && !row.api_key.startsWith("enc:v2:")) this.update("providers", row.id, { api_key: encrypt(decrypt(row.api_key)) });
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
      this.transaction(() => {
        this.run(`DELETE FROM llm_calls WHERE session_id IN (${expired})`, [cutoff]);
        this.run(`DELETE FROM compaction_events WHERE session_id IN (${expired})`, [cutoff]);
        this.run(`UPDATE publications SET session_id=NULL WHERE session_id IN (${expired})`, [cutoff]);
        this.run("DELETE FROM sessions WHERE updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running')", [cutoff]);
      });
      for (const id of expiredIds) this.conversations.delete(id);
    }
    this.run("DELETE FROM control_sessions WHERE expires_at < ?", [now()]);
    this.run("DELETE FROM access_sessions WHERE expires_at < ?", [now()]);
    for (const token of this.all("SELECT id,session_retention_days FROM access_tokens WHERE session_retention_days > 0")) {
      const cutoff = new Date(Date.now() - Number(token.session_retention_days) * 86400000).toISOString();
      const prefix = `token-${token.id}:%`;
      const expiredIds = this.all("SELECT id FROM sessions WHERE owner_key LIKE ? AND updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running')", [prefix, cutoff]).map((row) => String(row.id));
      this.run("DELETE FROM sessions WHERE owner_key LIKE ? AND updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running')", [prefix, cutoff]);
      for (const id of expiredIds) this.conversations.delete(id);
    }
    this.run("DELETE FROM sessions WHERE expires_at < ?", [now()], true);
    this.run("UPDATE approvals_v2 SET status='expired' WHERE status='pending' AND expires_at < ?", [now()]);
    this.run("UPDATE questions SET status='expired' WHERE status='pending' AND expires_at < ?", [now()]);
    if (settings.run_event_retention_hours > 0) this.run("DELETE FROM run_events WHERE created_at < ?", [new Date(Date.now() - settings.run_event_retention_hours * 3600000).toISOString()]);
    if (settings.llm_call_retention_days > 0) this.run("DELETE FROM llm_calls WHERE created_at < ?", [new Date(Date.now() - settings.llm_call_retention_days * 86400000).toISOString()]);
    if (settings.compaction_event_retention_days > 0) this.run("DELETE FROM compaction_events WHERE created_at < ?", [new Date(Date.now() - settings.compaction_event_retention_days * 86400000).toISOString()]);
    if (settings.audit_retention_days > 0) this.run("DELETE FROM audit_log WHERE ts < ?", [new Date(Date.now() - settings.audit_retention_days * 86400000).toISOString()]);
  }
  close() { this.agent.close(); this.business.close(); }
}
