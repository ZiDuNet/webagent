import fs from "node:fs";
import path from "node:path";
import { promptDefaults } from "./prompts.js";
import { storagePaths } from "./storage-paths.js";
import { AppError, type Row } from "./types.js";

const now = () => new Date().toISOString();
const COLLECTION_VERSION = 1;

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
  system_prompt_extra: "", default_reasoning_effort: "",
  default_approval_mode: "confirm", allow_full_access: true,
  welcome_title: "有什么我能帮你的吗？", welcome_subtitle: "", welcome_prompts: "你能做什么？\n帮我分析一下这份数据\n介绍一下当前可用的工具",
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

const toolPolicyDefaults: Row = { enabled: true, visible: true, selectable: true, default_selected: true, tags: [] as string[] };

/**
 * JSON 文件没有 SQLite 列默认值，读取时补齐。
 * 这样手工编辑的配置、旧库导入的记录和接口写入的记录行为一致。
 */
const providerDefaults: Row = { enabled: true, provider_type: "openai_compatible", base_url: "", api_key: "", extra_headers: {}, timeout_seconds: 90 };
const modelDefaults: Row = {
  enabled: true, is_default: false, sort_order: 100, model_kind: "chat", capabilities: ["text"], supports_tools: true,
  supports_reasoning: false, supports_reasoning_summary: true, supports_transcription: false, reasoning_style: "effort",
  reasoning_efforts: [], default_reasoning_effort: "", context_window: 0, max_output_tokens: 0, temperature: 0.3, top_p: 1,
  input_price_per_1m: 0, output_price_per_1m: 0, metadata_source: "manual", extra_params: {},
};
const assistantDefaults: Row = {
  enabled: true, is_default: false, sort_order: 100, allowed_roles: ["*"], tool_names: [], skill_slugs: [],
  allow_model_switch: true, memory_enabled: true, max_steps: 0, max_tool_calls: 0, max_run_seconds: 0, context_max_tokens: 0,
};
const httpToolDefaults: Row = { enabled: true, display_name: "", category: "业务连接器", permission: "", risk: "read", method: "GET", headers: {}, input_schema: { type: "object", properties: {} } };
const mcpServerDefaults: Row = { enabled: true, transport: "http", config: {} };

function normalize(defaultsForRow: Row, row: Row): Row {
  const result: Row = { ...structuredClone(defaultsForRow), ...row };
  for (const key of ["enabled", "is_default", "supports_tools", "supports_reasoning", "supports_reasoning_summary", "supports_transcription", "allow_model_switch", "memory_enabled"]) {
    if (key in defaultsForRow) result[key] = [true, 1, "1", "true"].includes(result[key] as any);
  }
  for (const key of ["capabilities", "reasoning_efforts", "tool_names", "skill_slugs", "allowed_roles", "extra_params", "extra_headers"]) {
    if (key in defaultsForRow && (result[key] === null || result[key] === undefined)) result[key] = structuredClone(defaultsForRow[key]);
  }
  return result;
}

function ensureDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    throw new AppError(`配置文件不是有效 JSON：${file}。请修正或从备份恢复，服务不会覆盖它。`, 500);
  }
}

function writeJson(file: string, value: unknown) {
  ensureDirectory(path.dirname(file));
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readCollection(file: string): Row[] {
  const parsed = readJson<Row>(file, { version: COLLECTION_VERSION, items: [] });
  const items = Array.isArray(parsed) ? parsed : parsed.items;
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function writeCollection(file: string, items: Row[]) {
  writeJson(file, { version: COLLECTION_VERSION, items });
}

function nextId(items: Row[]) {
  return items.reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), 0) + 1;
}

function safeToolName(name: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new AppError("工具名只能包含字母、数字、下划线和连字符，最多 64 个字符", 422);
  return name;
}

function byOrder(left: Row, right: Row) {
  return Number(left.sort_order ?? 100) - Number(right.sort_order ?? 100) || Number(left.id) - Number(right.id);
}

export interface LegacyConfigRows {
  settings?: Row[];
  providers?: Row[];
  models?: Row[];
  assistants?: Row[];
  toolSettings?: Row[];
  dynamicTools?: Row[];
  mcpServers?: Row[];
}

/**
 * 配置仓库：只读写 JSON 文件，不碰 SQLite。
 *
 * 每次读取都直接读文件，便于运维直接编辑；写入使用临时文件 + rename，
 * 并保留上一版 `.bak`。密钥字段仍由调用方负责 `enc:` 加密后再传入。
 */
export class ConfigStore {
  readonly paths: ReturnType<typeof storagePaths>;
  constructor(public dataDir: string) {
    this.paths = storagePaths(dataDir);
    for (const directory of [this.paths.config, this.paths.tools, this.paths.httpTools, this.paths.mcpTools, this.paths.toolCache, this.paths.cache]) ensureDirectory(directory);
  }

  private get settingsFile() { return path.join(this.paths.config, "settings.json"); }
  private get providersFile() { return path.join(this.paths.config, "providers.json"); }
  private get modelsFile() { return path.join(this.paths.config, "models.json"); }
  private get assistantsFile() { return path.join(this.paths.config, "assistants.json"); }
  private get policiesFile() { return path.join(this.paths.tools, "policies.json"); }

  settings(): Row {
    const stored = readJson<Row>(this.settingsFile, {});
    const result: Row = { ...defaults };
    for (const [key, fallback] of Object.entries(defaults)) {
      if (!(key in stored)) continue;
      const value = stored[key];
      result[key] = typeof fallback === "boolean" ? value === true || value === "true" || value === 1 || value === "1"
        : typeof fallback === "number" ? (value === null || value === "" ? fallback : Number(value))
          : fallback === null ? (value === "" || value === null || value === undefined ? null : Number(value) || null)
            : value;
    }
    const storedMode = stored.tool_selection_mode;
    if (storedMode) {
      result.bm25_enabled = storedMode === "bm25";
      result.decision_enabled = storedMode === "decision";
    } else if (result.decision_enabled) result.bm25_enabled = false;
    result.tool_selection_mode = result.decision_enabled ? "decision" : result.bm25_enabled ? "bm25" : "none";
    return result;
  }

  setSettings(values: Row) {
    const stored = readJson<Row>(this.settingsFile, {});
    for (const [key, value] of Object.entries(values)) {
      if (!(key in defaults)) continue;
      stored[key] = value;
    }
    writeJson(this.settingsFile, stored);
    return this.settings();
  }

  providers(): Row[] {
    return readCollection(this.providersFile).map((row) => normalize(providerDefaults, row)).sort((left, right) => Number(left.id) - Number(right.id));
  }

  provider(id: number) {
    return this.providers().find((provider) => Number(provider.id) === Number(id));
  }

  insertProvider(values: Row) {
    const items = this.providers();
    const row = { enabled: true, provider_type: "openai_compatible", ...values, id: nextId(items), created_at: now(), updated_at: now() };
    items.push(row);
    writeCollection(this.providersFile, items);
    return row;
  }

  updateProvider(id: number, values: Row) {
    const items = this.providers();
    const index = items.findIndex((provider) => Number(provider.id) === Number(id));
    if (index < 0) throw new AppError("供应商不存在", 404);
    items[index] = { ...items[index], ...values, id: items[index].id, created_at: items[index].created_at, updated_at: now() };
    writeCollection(this.providersFile, items);
    return items[index];
  }

  deleteProvider(id: number) {
    const items = this.providers();
    const next = items.filter((provider) => Number(provider.id) !== Number(id));
    if (next.length === items.length) throw new AppError("供应商不存在", 404);
    writeCollection(this.providersFile, next);
  }

  models(enabled = false): Row[] {
    const providers = new Map(this.providers().map((provider) => [Number(provider.id), provider]));
    return readCollection(this.modelsFile)
      .map((model): Row => {
        model = normalize(modelDefaults, model);
        const provider = providers.get(Number(model.provider_id));
        return { ...model, provider_name: provider?.name || "", provider_enabled: provider?.enabled !== false };
      })
      .filter((model) => !enabled || (model.enabled !== false && model.provider_enabled))
      .sort(byOrder);
  }

  model(id: number): Row | undefined {
    return this.models().find((model) => Number(model.id) === Number(id));
  }

  defaultModel(): Row | undefined {
    const models = this.models(true).filter((model) => ["chat", "vision"].includes(String(model.model_kind || "chat")));
    return models.find((model) => model.is_default) || models[0];
  }

  insertModel(values: Row) {
    const items = readCollection(this.modelsFile);
    const row = { enabled: true, is_default: false, sort_order: 100, model_kind: "chat", ...values, id: nextId(items), created_at: now(), updated_at: now() };
    items.push(row);
    writeCollection(this.modelsFile, items);
    return this.model(row.id)!;
  }

  updateModel(id: number, values: Row) {
    const items = readCollection(this.modelsFile);
    const index = items.findIndex((model) => Number(model.id) === Number(id));
    if (index < 0) throw new AppError("模型不存在", 404);
    items[index] = { ...items[index], ...values, id: items[index].id, created_at: items[index].created_at, updated_at: now() };
    writeCollection(this.modelsFile, items);
    return this.model(id)!;
  }

  deleteModel(id: number) {
    const items = readCollection(this.modelsFile);
    const next = items.filter((model) => Number(model.id) !== Number(id));
    if (next.length === items.length) throw new AppError("模型不存在", 404);
    writeCollection(this.modelsFile, next);
  }

  assistants(): Row[] {
    return readCollection(this.assistantsFile).map((row) => normalize(assistantDefaults, row)).sort((left, right) => Number(right.is_default === true) - Number(left.is_default === true) || byOrder(left, right));
  }

  assistant(id: number): Row | undefined {
    return this.assistants().find((assistant) => Number(assistant.id) === Number(id));
  }

  insertAssistant(values: Row) {
    const items = readCollection(this.assistantsFile);
    const row = { enabled: true, is_default: false, sort_order: 100, allowed_roles: ["*"], tool_names: [], skill_slugs: [], ...values, id: nextId(items), created_at: now(), updated_at: now() };
    items.push(row);
    writeCollection(this.assistantsFile, items);
    return this.assistant(row.id)!;
  }

  updateAssistant(id: number, values: Row) {
    const items = readCollection(this.assistantsFile);
    const index = items.findIndex((assistant) => Number(assistant.id) === Number(id));
    if (index < 0) throw new AppError("助手不存在", 404);
    items[index] = { ...items[index], ...values, id: items[index].id, created_at: items[index].created_at, updated_at: now() };
    writeCollection(this.assistantsFile, items);
    return this.assistant(id)!;
  }

  deleteAssistant(id: number) {
    const items = readCollection(this.assistantsFile);
    const next = items.filter((assistant) => Number(assistant.id) !== Number(id));
    if (next.length === items.length) throw new AppError("助手不存在", 404);
    writeCollection(this.assistantsFile, next);
  }

  toolPolicy(name: string) {
    const policies = readJson<Record<string, Row>>(this.policiesFile, {});
    return { ...toolPolicyDefaults, ...(policies[name] || {}) };
  }

  /** 返回磁盘上的原始策略；未显式保存过时返回 undefined，用于区分“默认开启”和“管理员开启”。 */
  rawToolPolicy(name: string): Row | undefined {
    return readJson<Record<string, Row>>(this.policiesFile, {})[name];
  }

  setToolPolicy(name: string, values: Row) {
    const policies = readJson<Record<string, Row>>(this.policiesFile, {});
    policies[name] = { ...this.toolPolicy(name), ...values, updated_at: now() };
    writeJson(this.policiesFile, policies);
    return this.toolPolicy(name);
  }

  httpTools(): Row[] {
    if (!fs.existsSync(this.paths.httpTools)) return [];
    return fs.readdirSync(this.paths.httpTools).filter((file) => file.endsWith(".json")).flatMap((file) => {
      try { const row = readJson<Row>(path.join(this.paths.httpTools, file), {}); return row?.name ? [row] : []; } catch { return []; }
    }).map((row) => normalize(httpToolDefaults, row)).sort((left, right) => Number(left.id) - Number(right.id));
  }

  httpTool(id: number) {
    return this.httpTools().find((tool) => Number(tool.id) === Number(id));
  }

  saveHttpTool(previous: Row | undefined, values: Row) {
    const name = safeToolName(String(values.name ?? previous?.name ?? ""));
    const items = this.httpTools();
    const id = previous ? Number(previous.id) : nextId(items);
    const row = { ...previous, ...values, name, id, created_at: previous?.created_at || now(), updated_at: now() };
    writeJson(path.join(this.paths.httpTools, `${name}.json`), row);
    if (previous?.name && previous.name !== name) fs.rmSync(path.join(this.paths.httpTools, `${previous.name}.json`), { force: true });
    return row;
  }

  deleteHttpTool(id: number) {
    const tool = this.httpTool(id);
    if (!tool) throw new AppError("工具不存在", 404);
    fs.rmSync(path.join(this.paths.httpTools, `${tool.name}.json`), { force: true });
  }

  mcpServers(): Row[] {
    if (!fs.existsSync(this.paths.mcpTools)) return [];
    return fs.readdirSync(this.paths.mcpTools).filter((file) => file.endsWith(".json")).flatMap((file) => {
      try { const row = readJson<Row>(path.join(this.paths.mcpTools, file), {}); return row?.name ? [row] : []; } catch { return []; }
    }).map((row) => normalize(mcpServerDefaults, row)).sort((left, right) => Number(left.id) - Number(right.id));
  }

  mcpServer(id: number) {
    return this.mcpServers().find((server) => Number(server.id) === Number(id));
  }

  saveMcpServer(previous: Row | undefined, values: Row) {
    const name = String(values.name ?? previous?.name ?? "").trim();
    if (!name || name.length > 100) throw new AppError("MCP 名称需要 1–100 个字符", 422);
    const file = name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
    if (!file) throw new AppError("MCP 名称需要包含字母或数字", 422);
    const items = this.mcpServers();
    const id = previous ? Number(previous.id) : nextId(items);
    const row = { enabled: true, transport: "http", ...previous, ...values, name, id, created_at: previous?.created_at || now(), updated_at: now() };
    writeJson(path.join(this.paths.mcpTools, `${file}.json`), row);
    if (previous?.name && previous.name !== name) {
      const previousFile = String(previous.name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
      if (previousFile !== file) fs.rmSync(path.join(this.paths.mcpTools, `${previousFile}.json`), { force: true });
    }
    return row;
  }

  deleteMcpServer(id: number) {
    const server = this.mcpServer(id);
    if (!server) throw new AppError("MCP 不存在", 404);
    const file = String(server.name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
    fs.rmSync(path.join(this.paths.mcpTools, `${file}.json`), { force: true });
    fs.rmSync(path.join(this.paths.toolCache, `${id}.json`), { force: true });
  }

  cacheMcpTools(id: number, tools: Row[]) {
    const server = this.mcpServer(id);
    if (!server) throw new AppError("MCP 不存在", 404);
    return this.saveMcpServer(server, { config: { ...server.config, cached_tools: tools } });
  }

  /** 从旧 SQLite 配置表导入一次；已有 JSON 文件时不覆盖。 */
  importLegacy(rows: LegacyConfigRows) {
    const imported: string[] = [];
    const settingsFileExists = fs.existsSync(this.settingsFile);
    if (!settingsFileExists && rows.settings?.length) {
      const stored: Row = {};
      for (const row of rows.settings) if (row.key in defaults) stored[String(row.key)] = row.value;
      writeJson(this.settingsFile, stored);
      imported.push("settings");
    }
    if (!fs.existsSync(this.providersFile) && rows.providers?.length) {
      writeCollection(this.providersFile, rows.providers);
      imported.push("providers");
    }
    if (!fs.existsSync(this.modelsFile) && rows.models?.length) {
      writeCollection(this.modelsFile, rows.models);
      imported.push("models");
    }
    if (!fs.existsSync(this.assistantsFile) && rows.assistants?.length) {
      writeCollection(this.assistantsFile, rows.assistants);
      imported.push("assistants");
    }
    if (!fs.existsSync(this.policiesFile) && rows.toolSettings?.length) {
      const policies: Record<string, Row> = {};
      for (const row of rows.toolSettings) policies[String(row.name)] = row;
      writeJson(this.policiesFile, policies);
      imported.push("tool-settings");
    }
    if (!this.httpTools().length && rows.dynamicTools?.length) {
      for (const row of rows.dynamicTools) writeJson(path.join(this.paths.httpTools, `${safeToolName(String(row.name))}.json`), row);
      imported.push("dynamic-tools");
    }
    if (!this.mcpServers().length && rows.mcpServers?.length) {
      for (const row of rows.mcpServers) {
        const file = String(row.name).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || `mcp-${row.id}`;
        writeJson(path.join(this.paths.mcpTools, `${file}.json`), row);
      }
      imported.push("mcp-servers");
    }
    return imported;
  }
}
