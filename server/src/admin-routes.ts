import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { Auth } from "./auth.js";
import { Store, defaults } from "./store.js";
import { Providers, classifyModel, kinds, presets, providerHeaders, publicProvider, requestJson } from "./providers.js";
import { encrypt, decrypt, digest, safeUrl, mask, token as generateToken } from "./security.js";
import { Speech, pcmToWav } from "./speech.js";
import { Decision, decisionConnection } from "./decision.js";
import { ToolRegistry } from "./tools.js";
import { Publications } from "./publications.js";
import { Runs } from "./runs.js";
import { CoreMaintenance } from "./core-maintenance.js";
import { SkillLibrary } from "./skill-library.js";
import { AppError, type Row } from "./types.js";
import { runtimeToolNames } from "./pi-tools.js";
import { promptDefaults } from "./prompts.js";
import { skillFromTextFiles, skillFromZip } from "./skills.js";
import { assistantModelColumns } from "./assistant-config.js";
import { brandUrl, readBrandLogo, removeBrandLogo, saveBrandLogo } from "./brand.js";
import { normalizeVoiceInputMode, voiceInputModeInputs } from "./voice-input.js";

const name = z.string().trim().min(1).max(100);
const providerSchema = z.object({ name, provider_type: z.literal("openai_compatible").default("openai_compatible"), base_url: z.string().max(1000), api_key: z.string().max(5000).optional(), clear_api_key: z.boolean().optional(), extra_headers: z.record(z.string(), z.string()).default({}), enabled: z.boolean().default(true), timeout_seconds: z.number().min(3).max(180).default(90) });
const modelSchema = z.object({ provider_id: z.number().int().positive(), name, model_id: z.string().trim().min(1).max(200), model_kind: z.enum(kinds).default("chat"), enabled: z.boolean().default(true), is_default: z.boolean().default(false), sort_order: z.number().int().min(0).max(10000).default(100), capabilities: z.array(z.enum(["text", "image"])).default(["text"]), supports_tools: z.boolean().default(true), context_window: z.number().int().min(0).max(10000000).default(0), max_output_tokens: z.number().int().min(0).max(1000000).default(0), temperature: z.number().min(0).max(2).default(0.3), top_p: z.number().min(0).max(1).default(1), input_price_per_1m: z.number().min(0).max(100000).default(0), output_price_per_1m: z.number().min(0).max(100000).default(0), supports_reasoning: z.boolean().default(false), reasoning_style: z.literal("effort").default("effort"), reasoning_efforts: z.array(z.enum(["off", "none", "minimal", "low", "medium", "high", "xhigh"])).default([]), default_reasoning_effort: z.string().max(10).default(""), supports_reasoning_summary: z.boolean().default(true), supports_transcription: z.boolean().default(false), metadata_source: z.string().max(40).default("manual"), extra_params: z.record(z.string(), z.unknown()).default({}) });
const assistantSchema = z.object({
  name, description: z.string().max(500).default(""), system_prompt: z.string().max(20000).default(""), model_row_id: z.number().int().positive().nullable().optional(), allow_model_switch: z.boolean().default(true), tool_names: z.array(z.string()).max(500).default([]), skill_slugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)).max(500).default([]), max_steps: z.number().int().nonnegative().default(0), max_tool_calls: z.number().int().nonnegative().default(0), max_run_seconds: z.number().int().min(0).max(3600).default(0), context_max_tokens: z.number().int().nonnegative().default(0), memory_enabled: z.boolean().default(true), allowed_roles: z.array(z.string().max(60)).max(50).default(["*"]).transform((roles) => (roles.length ? roles : ["*"])),
  asr_model_id: z.number().int().positive().nullable().default(null),
  asr_realtime_model_id: z.number().int().positive().nullable().default(null),
  tts_model_id: z.number().int().positive().nullable().default(null),
  voice_asr_model_id: z.number().int().positive().nullable().default(null),
  voice_tts_model_id: z.number().int().positive().nullable().default(null),
  voice_input_mode: z.enum(voiceInputModeInputs).nullable().default(null).transform((value) => (value === null ? null : normalizeVoiceInputMode(value))),
  voice_auto_send: z.boolean().nullable().default(null),
  tts_auto_read: z.boolean().nullable().default(null),
  tts_max_read_chars: z.number().int().min(1).max(4000).nullable().default(null),
  default_reasoning_effort: z.enum(["", "off", "none", "minimal", "low", "medium", "high", "xhigh"]).nullable().default(null),
  default_approval_mode: z.enum(["confirm", "full_access"]).nullable().default(null),
  allow_full_access: z.boolean().nullable().default(null),
  welcome_title: z.string().max(120).nullable().default(null),
  welcome_subtitle: z.string().max(500).nullable().default(null),
  welcome_prompts: z.string().max(4000).nullable().default(null),
  welcome_logo: z.string().max(300).nullable().default(null),
  enabled: z.boolean().default(true), is_default: z.boolean().default(false), sort_order: z.number().int().min(0).max(10000).default(100),
});
const dynamicSchema = z.object({ name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), display_name: z.string().max(100).default(""), description: z.string().min(1).max(5000), category: z.string().max(100).default("业务连接器"), permission: z.string().max(100).default(""), risk: z.enum(["read", "write", "delete"]).default("read"), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"), url_template: z.string().min(1).max(2000), headers: z.record(z.string(), z.string()).default({}), input_schema: z.record(z.string(), z.unknown()).default({ type: "object", properties: {} }), enabled: z.boolean().default(false) });
const skillSchema = z.object({ name, slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), description: z.string().max(1000).default(""), content: z.string().max(100000).default(""), kind: z.literal("prompt").default("prompt"), license: z.string().max(100).default(""), metadata: z.record(z.string(), z.unknown()).default({}), files: z.record(z.string(), z.string().max(100000)).default({}), enabled: z.boolean().default(true) });
const accessTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  assistant_id: z.number().int().positive(),
  channel: z.enum(["chat", "screen", "web", "miniprogram"]).default("chat"),
  enabled: z.boolean().default(true),
  expires_at: z.string().datetime().nullable().optional(),
  allowed_origins: z.array(z.string().url().max(500)).max(20).default([]),
  rate_limit_per_minute: z.number().int().min(0).max(100000).default(60),
  daily_token_limit: z.number().int().min(0).max(1000000000).default(0),
  session_retention_days: z.number().int().min(0).max(3650).default(0),
});
const controlTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  expires_at: z.string().datetime().nullable().optional(),
  allowed_origins: z.array(z.union([z.literal("*"), z.string().url().max(500)])).max(20).default([]),
});
const api = "/api/control";
export function adminRoutes(app: FastifyInstance, context: { store: Store; auth: Auth; skills: SkillLibrary; providers: Providers; speech: Speech; decision: Decision; registry: ToolRegistry; publications: Publications; runs: Runs; core: CoreMaintenance }) {
  const { store, auth, skills, providers, speech, decision, registry, publications, runs, core } = context;
  const publicConfig = () => { const { pagepilot_token, ...settings } = store.settings(); return { ...settings, prompt_defaults: promptDefaults, pagepilot_token_set: Boolean(pagepilot_token), pagepilot_token_masked: mask(pagepilot_token ? decrypt(pagepilot_token) : "") }; };
  /** 记忆来自用户手动添加或模型提取；数据库只存 kind，对外补充稳定的 source 语义。 */
  const memoryRow = (row: Row) => ({
    id: row.id,
    content: row.content,
    kind: row.kind,
    source: row.kind === "extracted" ? "model" : "user",
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  // 品牌徽标是公开静态资源，其余 /api/control 接口仍要求管理端登录。
  app.addHook("preHandler", async (request) => { if (request.method === "OPTIONS") return; if (request.url.startsWith(`${api}/`) && !request.url.startsWith(`${api}/auth/`) && !request.url.startsWith(`${api}/brand/`)) auth.admin(request); });
  app.get(`${api}/config`, async () => publicConfig());
  app.put(`${api}/config`, async (request) => {
    const input = request.body as Row; const values: Row = {};
    for (const [key, value] of Object.entries(input || {})) {
      // 工具覆盖通过 PATCH /admin/tools/:name/metadata 单独维护，避免整表单提交时绕过长度与条数校验。
      if (!(key in defaults) || key.startsWith("pagepilot_") || key === "tool_overrides") continue;
      const fallback = defaults[key];
      if (fallback === null) { if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new AppError(`参数 ${key} 需要模型 ID 或空值`, 422); values[key] = value || null; }
      else if (typeof value !== typeof fallback) throw new AppError(`参数 ${key} 类型无效`, 422);
      else if (key === "memory_extract_interval") { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 50) throw new AppError("memory_extract_interval 需要是 0–50 的整数", 422); values[key] = value; }
      else if (typeof fallback === "number" && (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 100000000)) throw new AppError(`参数 ${key} 范围无效`, 422);
      else if (typeof value === "string" && value.length > 20000) throw new AppError(`参数 ${key} 过长`, 422);
      else values[key] = value;
    }
    for (const key of Object.keys(promptDefaults)) {
      if (key in values && !String(values[key]).trim()) throw new AppError(`${key} 不能为空；如需恢复默认请使用默认值`, 422);
    }
    const next = { ...store.settings(), ...values };
    if (values.tool_selection_mode !== undefined && !["none", "bm25", "decision"].includes(values.tool_selection_mode)) throw new AppError("工具筛选策略无效，只能是 none、bm25 或 decision", 422);
    if (values.tool_selection_mode) { next.bm25_enabled = values.tool_selection_mode === "bm25"; next.decision_enabled = values.tool_selection_mode === "decision"; }
    else if (values.bm25_enabled === true && values.decision_enabled === undefined) next.decision_enabled = false;
    else if (values.decision_enabled === true && values.bm25_enabled === undefined) next.bm25_enabled = false;
    if (next.bm25_enabled && next.decision_enabled) throw new AppError("BM25 与决策不能同时开启，但允许都关闭", 422);
    if (!(next.decision_threshold > 0 && next.decision_threshold < 1) || next.decision_min_count < 1 || next.decision_min_count > 200 || next.decision_timeout_seconds < 1 || next.decision_timeout_seconds > 30) throw new AppError("决策阈值或候选数量、超时无效", 422);
    if (next.retry_max_attempts < 1 || next.retry_max_attempts > 8 || next.compaction_keep_ratio < 0.2 || next.compaction_keep_ratio > 0.9 || next.max_run_seconds < 10 || next.max_run_seconds > 3600 || next.modelsdev_cache_hours < 1 || next.modelsdev_cache_hours > 8760) throw new AppError("重试、压缩、缓存或运行时长参数超出范围", 422);
    if (!Number.isSafeInteger(next.memory_extract_interval) || next.memory_extract_interval < 0 || next.memory_extract_interval > 50) throw new AppError("memory_extract_interval 需要是 0–50 的整数", 422);
    for (const key of ["max_iterations", "max_tool_calls", "context_max_rounds", "session_retention_days", "retry_max_attempts", "run_event_retention_hours", "llm_call_retention_days", "compaction_event_retention_days", "audit_retention_days"]) if (!Number.isSafeInteger(next[key])) throw new AppError(`${key} 必须是整数`, 422);
    const modelBindings: Record<string, string[]> = {
      asr_model_id: ["asr"],
      asr_realtime_model_id: ["asr_realtime"],
      tts_model_id: ["tts"],
      voice_asr_model_id: ["asr_realtime", "asr"],
      voice_tts_model_id: ["tts_realtime", "tts"],
      title_model_id: ["chat", "vision"],
      fallback_model_id: ["chat", "vision"],
      compaction_model_id: ["chat", "vision"],
      decision_model_id: ["decision"],
      memory_model_id: ["chat", "vision"],
    };
    for (const [key, expected] of Object.entries(modelBindings)) if (next[key]) {
      const model = store.model(next[key]);
      if (!model?.enabled || !model.provider_enabled || !expected.includes(model.model_kind)) throw new AppError(`${key} 对应模型不可用或类型不匹配`, 422);
    }
    if (values.voice_input_mode !== undefined && !(voiceInputModeInputs as readonly string[]).includes(String(values.voice_input_mode))) throw new AppError("voice_input_mode 无效", 422);
    if (values.voice_input_mode !== undefined) values.voice_input_mode = normalizeVoiceInputMode(values.voice_input_mode);
    if (next.tts_max_read_chars < 1 || next.tts_max_read_chars > 4000) throw new AppError("tts_max_read_chars 需要在 1–4000 之间", 422);
    if (next.decision_enabled && (!next.decision_model_id || (!next.decision_tools && !next.decision_skills))) throw new AppError("开启决策需要有效模型，并至少选择工具或技能", 422);
    const previousGlobalLogo = String(store.settings().welcome_logo || "");
    store.setSettings({ ...values, bm25_enabled: next.bm25_enabled, decision_enabled: next.decision_enabled, tool_selection_mode: next.decision_enabled ? "decision" : next.bm25_enabled ? "bm25" : "none" });
    if (previousGlobalLogo && previousGlobalLogo !== String(next.welcome_logo || "")) releaseBrand(previousGlobalLogo);
    if (!next.store_reasoning) { store.conversations.stripReasoning(); store.run("UPDATE run_events SET payload='{}' WHERE name='thinking.delta'"); }
    store.audit(auth.admin(request).username, "config.update", "runtime", Object.keys(values)); return publicConfig();
  });
  app.get(`${api}/admin/providers/presets`, async () => ({ items: presets }));
  app.get(`${api}/admin/models-dev`, async () => ({ status: await providers.catalogueStatus() }));
  app.post(`${api}/admin/models-dev/refresh`, async (request) => {
    const catalogue = await providers.refreshCatalogue();
    const count = Object.values(catalogue || {}).reduce((total, provider: any) => total + Object.keys(provider?.models || {}).length, 0);
    store.audit(auth.admin(request).username, "modelsdev.refresh", "models.dev", { count });
    return { ok: true, models: count, status: await providers.catalogueStatus() };
  });
  const revealToken = (row: Row) => {
    const cipher = String(row.token_cipher || "");
    if (!cipher) return "";
    try { return decrypt(cipher); } catch { return ""; }
  };
  const publicAccessToken = (row: Row) => {
    const { token_hash, token_cipher, ...safe } = row;
    const value = revealToken(row);
    return { ...safe, token: value, token_available: Boolean(value) };
  };
  const accessTokenValues = (input: Row, previous?: Row) => {
    const values = accessTokenSchema.parse({ ...previous, ...input });
    if (!store.assistant(values.assistant_id)) throw new AppError("Token 绑定的助手不存在", 422);
    if (values.expires_at && new Date(values.expires_at).getTime() <= Date.now()) throw new AppError("过期时间必须晚于当前时间", 422);
    return values;
  };
  app.get(`${api}/admin/access-tokens`, async () => ({ items: store.all("SELECT * FROM access_tokens ORDER BY id DESC").map((row) => {
    const sessions = store.one("SELECT count(*) AS n FROM sessions WHERE owner_key LIKE ?", [`token-${row.id}:%`])?.n || 0;
    return { ...publicAccessToken(row), assistant_name: String(store.assistant(Number(row.assistant_id))?.name || ""), sessions_count: sessions };
  }), assistants: store.assistants().filter((assistant) => assistant.enabled !== false).map((assistant) => ({ id: assistant.id, name: assistant.name })) }));
  app.post(`${api}/admin/access-tokens`, async (request, reply) => {
    const values = accessTokenValues(request.body as Row);
    const raw = `wa_${generateToken()}`;
    const current = store.insert("access_tokens", { ...values, expires_at: values.expires_at || null, token_hash: digest(raw), token_prefix: raw.slice(0, 12), token_cipher: encrypt(raw), created_by: auth.admin(request).username });
    store.audit(auth.admin(request).username, "access_token.create", String(current.id), { name: current.name, assistant_id: current.assistant_id });
    reply.code(201);
    return { token: raw, access_token: publicAccessToken(current), notice: "Token 已加密保存，可随时在接入与安全页查看和复制。" };
  });
  for (const method of ["PUT"] as const) app.route({ method, url: `${api}/admin/access-tokens/:id`, handler: async (request) => {
    const id = Number((request.params as Row).id);
    const previous = store.one("SELECT * FROM access_tokens WHERE id=?", [id]);
    if (!previous) throw new AppError("接入 Token 不存在", 404);
    const values = accessTokenValues(request.body as Row, previous);
    const row = store.update("access_tokens", id, values)!;
    store.audit(auth.admin(request).username, "access_token.update", String(id), { enabled: values.enabled, assistant_id: values.assistant_id });
    return { access_token: publicAccessToken(row) };
  } });
  app.post(`${api}/admin/access-tokens/:id/rotate`, async (request, reply) => {
    const id = Number((request.params as Row).id);
    const previous = store.one("SELECT * FROM access_tokens WHERE id=?", [id]);
    if (!previous) throw new AppError("接入 Token 不存在", 404);
    const raw = `wa_${generateToken()}`;
    store.transaction(() => {
      store.update("access_tokens", id, { token_hash: digest(raw), token_prefix: raw.slice(0, 12), token_cipher: encrypt(raw) });
      store.run("DELETE FROM access_sessions WHERE access_token_id=?", [id]);
    });
    store.audit(auth.admin(request).username, "access_token.rotate", String(id));
    reply.code(201);
    return { token: raw, notice: "旧 Token 已立即失效，新 Token 已加密保存，可随时查看。" };
  });
  app.delete(`${api}/admin/access-tokens/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const row = store.one("SELECT * FROM access_tokens WHERE id=?", [id]);
    if (!row) throw new AppError("接入 Token 不存在", 404);
    store.transaction(() => {
      store.run("DELETE FROM access_sessions WHERE access_token_id=?", [id]);
      store.run("DELETE FROM access_tokens WHERE id=?", [id]);
    });
    store.audit(auth.admin(request).username, "access_token.delete", String(id), { name: row.name });
    return { ok: true };
  });
  const publicControlToken = (row: Row) => {
    const { token_hash, token_cipher, ...safe } = row;
    const value = revealToken(row);
    return { ...safe, token: value, token_available: Boolean(value) };
  };
  const controlTokenValues = (input: Row, previous?: Row) => {
    const values = controlTokenSchema.parse({ ...previous, ...input });
    if (values.expires_at && new Date(values.expires_at).getTime() <= Date.now()) throw new AppError("过期时间必须晚于当前时间", 422);
    return values;
  };
  app.get(`${api}/admin/control-tokens`, async () => ({ items: store.all("SELECT * FROM control_tokens ORDER BY id DESC").map(publicControlToken) }));
  app.post(`${api}/admin/control-tokens`, async (request, reply) => {
    const values = controlTokenValues(request.body as Row);
    const raw = `wac_${generateToken()}`;
    const admin = auth.admin(request);
    const current = store.insert("control_tokens", { ...values, expires_at: values.expires_at || null, token_hash: digest(raw), token_prefix: raw.slice(0, 12), token_cipher: encrypt(raw), created_by: admin.username });
    store.audit(admin.username, "control_token.create", String(current.id), { name: current.name });
    reply.code(201);
    return { token: raw, control_token: publicControlToken(current), notice: "管理 Token 已加密保存，可随时在接入与安全页查看和复制。" };
  });
  app.put(`${api}/admin/control-tokens/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const previous = store.one("SELECT * FROM control_tokens WHERE id=?", [id]);
    if (!previous) throw new AppError("管理 Token 不存在", 404);
    const values = controlTokenValues(request.body as Row, previous);
    const row = store.update("control_tokens", id, values)!;
    store.audit(auth.admin(request).username, "control_token.update", String(id), { enabled: values.enabled, name: values.name });
    return { control_token: publicControlToken(row) };
  });
  app.post(`${api}/admin/control-tokens/:id/rotate`, async (request, reply) => {
    const id = Number((request.params as Row).id);
    const previous = store.one("SELECT * FROM control_tokens WHERE id=?", [id]);
    if (!previous) throw new AppError("管理 Token 不存在", 404);
    const admin = auth.admin(request);
    const raw = `wac_${generateToken()}`;
    store.update("control_tokens", id, { token_hash: digest(raw), token_prefix: raw.slice(0, 12), token_cipher: encrypt(raw) });
    store.audit(admin.username, "control_token.rotate", String(id));
    reply.code(201);
    return { token: raw, notice: "旧管理 Token 已立即失效，新 Token 已加密保存，可随时查看。" };
  });
  app.delete(`${api}/admin/control-tokens/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const row = store.one("SELECT * FROM control_tokens WHERE id=?", [id]);
    if (!row) throw new AppError("管理 Token 不存在", 404);
    const admin = auth.admin(request);
    store.run("DELETE FROM control_tokens WHERE id=?", [id]);
    store.audit(admin.username, "control_token.delete", String(id), { name: row.name });
    return { ok: true };
  });
  app.get(`${api}/admin/providers`, async () => {
    const models = store.models();
    return { items: store.providers().map((row) => publicProvider({ ...row, model_count: models.filter((model) => Number(model.provider_id) === Number(row.id)).length, api_key: row.api_key ? decrypt(row.api_key) : "" })) };
  });
  for (const method of ["POST", "PUT"] as const) app.route({ method, url: `${api}/admin/providers${method === "PUT" ? "/:id" : ""}`, handler: async (request, reply) => {
    const previous = method === "PUT" ? store.provider(Number((request.params as Row).id)) : undefined; if (method === "PUT" && !previous) throw new AppError("供应商不存在", 404);
    const values = providerSchema.parse({ ...previous, ...request.body as Row }); const url = safeUrl(values.base_url); if (url.search) throw new AppError("Base URL 不应包含查询参数", 422);
    providerHeaders({ ...values, api_key: "" });
    const data = { ...values, base_url: values.base_url.trim().replace(/\/+$/, ""), api_key: encrypt(values.clear_api_key ? "" : values.api_key?.trim() || previous?.api_key || "") };
    const row = previous ? store.config.updateProvider(Number(previous.id), data) : store.config.insertProvider(data); if (!previous) reply.code(201); return { provider: publicProvider({ ...row, api_key: data.api_key ? decrypt(data.api_key) : "" }) };
  } });
  app.delete(`${api}/admin/providers/:id`, async (request) => { const id = Number((request.params as Row).id); if (store.models().some((model) => Number(model.provider_id) === id)) throw new AppError("请先移除该供应商关联模型", 409); store.config.deleteProvider(id); return { ok: true }; });
  app.get(`${api}/admin/providers/:id/discover-models`, async (request) => { const query = request.query as Row; const items = await providers.discover(Number((request.params as Row).id), query.refresh === "1"); const kind = query.kind || query.model_kind; return { items: kind ? items.filter((item) => item.model_kind === kind || kind === "chat" && ["chat", "vision"].includes(item.model_kind)) : items }; });
  app.post(`${api}/admin/providers/:id/test`, async (request) => { const started = Date.now(); try { const items = await providers.discover(Number((request.params as Row).id), true); return { ok: true, message: `连接正常，发现 ${items.length} 个模型`, sample: items.slice(0, 5).map((item) => item.model_id), latency_ms: Date.now() - started }; } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "连接失败", latency_ms: Date.now() - started }; } });
  app.post(`${api}/admin/providers/:id/import-models`, async (request) => { const id = Number((request.params as Row).id); const provider = providers.connection(id); const ids = z.array(z.string().max(200)).min(1).max(100).parse((request.body as Row).model_ids); const items: Row[] = []; for (const modelId of ids) { if (store.models().some((model) => Number(model.provider_id) === id && model.model_id === modelId)) continue; const suggested = await providers.suggest(modelId, provider, 15000); items.push(store.config.insertModel(modelSchema.parse({ ...suggested, name: modelId, model_id: modelId, provider_id: id }))); } return { items }; });
  app.get(`${api}/admin/model-suggest`, async (request) => { const query = request.query as Row; return { suggested: await providers.suggest(z.string().min(1).max(200).parse(query.model_id), query.provider_id ? store.provider(Number(query.provider_id)) : undefined, 15000) }; });
  app.get(`${api}/admin/models`, async () => ({ items: store.models() }));
  for (const method of ["POST", "PUT"] as const) app.route({ method, url: `${api}/admin/models${method === "PUT" ? "/:id" : ""}`, handler: async (request, reply) => {
    const previous = method === "PUT" ? store.model(Number((request.params as Row).id)) : undefined; if (method === "PUT" && !previous) throw new AppError("模型不存在", 404);
    const values = modelSchema.parse({ ...previous, ...request.body as Row });
    if (previous && store.settings().decision_model_id === previous.id) {
      if (values.model_kind !== "decision") throw new AppError("该模型正被决策筛选使用，不能改为其他类型；请先在运行设置中解除绑定", 409);
      if (store.settings().decision_enabled && values.enabled === false) throw new AppError("决策筛选正在使用该模型，请先关闭决策或更换模型", 409);
    }
    const provider = store.provider(values.provider_id); if (!provider) throw new AppError("供应商不存在", 422);
    const inferred = classifyModel(values.model_id); if (values.model_kind === "chat" && !["chat", "vision"].includes(inferred)) values.model_kind = inferred as typeof values.model_kind;
    values.supports_transcription = ["asr", "asr_realtime"].includes(values.model_kind);
    if (!["chat", "vision"].includes(values.model_kind)) { values.supports_tools = false; values.is_default = false; }
    if (values.is_default && (!values.enabled || !provider.enabled)) throw new AppError("默认对话模型必须启用", 422);
    if (values.extra_params.extra_body !== undefined) values.extra_params.extra_body = z.record(z.string(), z.unknown()).parse(values.extra_params.extra_body);
    for (const params of [values.extra_params, values.extra_params.extra_body || {}] as Row[]) for (const key of ["model", "messages", "tools", "stream", "headers", "api_key", "base_url"]) if (key in params) throw new AppError(`额外参数不能覆盖 ${key}`, 422);
    if (values.model_kind.startsWith("asr")) { const { asrConfig } = await import("./speech.js"); asrConfig(values, provider); }
    if (["tts", "tts_realtime"].includes(values.model_kind)) { const { ttsConfig } = await import("./speech.js"); ttsConfig(values, provider); }
    if (values.model_kind === "decision") decisionConnection(values, provider);
    if (values.is_default) for (const item of store.models()) if (Number(item.id) !== Number(previous?.id ?? 0) && item.model_kind === values.model_kind && item.is_default) store.config.updateModel(Number(item.id), { is_default: false });
    const row = previous ? store.config.updateModel(Number(previous.id), values) : store.config.insertModel(values);
    if (!previous) reply.code(201); return { model: { ...row, provider_name: provider.name, provider_enabled: provider.enabled } };
  } });
  app.post(`${api}/admin/models/:id/sync`, async (request) => {
    const model = store.model(Number((request.params as Row).id)); if (!model) throw new AppError("模型不存在", 404);
    const status = await providers.catalogueStatus();
    if (!status.cached) { void providers.refreshCatalogue().catch(() => {}); throw new AppError("models.dev 元数据尚未缓存，已开始在后台拉取；请稍后重试「同步并回填」", 503); }
    const suggested = await providers.suggest(model.model_id, store.provider(model.provider_id), 5000);
    if (suggested.metadata_source !== "models.dev") throw new AppError("没有匹配到 models.dev 元数据，请核对模型 ID；也可在「运行设置 → 缓存与元数据」刷新后重试", 404);
    const authoritative = {
      context_window: Number(suggested.context_window || 0),
      max_output_tokens: Number(suggested.max_output_tokens || 0),
      capabilities: suggested.capabilities,
      supports_tools: Boolean(suggested.supports_tools),
      supports_reasoning: Boolean(suggested.supports_reasoning),
      input_price_per_1m: Number(suggested.input_price_per_1m || 0),
      output_price_per_1m: Number(suggested.output_price_per_1m || 0),
      metadata_source: "models.dev",
    };
    return { model: { ...model, ...authoritative }, match: suggested.metadata_match || null };
  });
  app.delete(`${api}/admin/models/:id`, async (request) => { const id = Number((request.params as Row).id); const settings = store.settings(); for (const key of ["asr_model_id", "asr_realtime_model_id", "tts_model_id", "voice_asr_model_id", "voice_tts_model_id", "title_model_id", "fallback_model_id", "compaction_model_id", "decision_model_id", "memory_model_id"]) if (settings[key] === id) throw new AppError(`模型正被 ${key} 使用，请先解除绑定`, 409); for (const column of assistantModelColumns) if (store.assistants().some((assistant) => Number(assistant[column]) === id)) throw new AppError(`模型正被助手配置 ${column} 使用，请先解除绑定`, 409); for (const assistant of store.assistants()) if (Number(assistant.model_row_id) === id) store.config.updateAssistant(Number(assistant.id), { model_row_id: null }); store.config.deleteModel(id); return { ok: true }; });
  app.post(`${api}/admin/models/:id/test`, async (request) => {
    const model = store.model(Number((request.params as Row).id)); if (!model) throw new AppError("模型不存在", 404); if (!model.enabled) throw new AppError("模型已停用", 422);
    const started = Date.now(); const body = request.body as Row || {};
    try {
      if (model.model_kind === "decision") { const result = await decision.score(model, "查询今天需要处理的业务记录", [{ id: "record_query", description: "查询业务记录和处理状态" }]); return { ok: true, ...result, message: "决策接口返回了有效评分" }; }
      if (["tts", "tts_realtime"].includes(model.model_kind)) {
        const result = await speech.synthesize(model, body.text || "你好，这是一条 WebAgent 语音合成测试。", {}, undefined, { username: "管理员 · 模型测试" });
        const wav = result.mime_type === "audio/pcm" ? pcmToWav(result.bytes, Number((result as Row).sample_rate || 24000)) : result.bytes;
        const mime = result.mime_type === "audio/pcm" ? "audio/wav" : result.mime_type;
        return { ok: true, audio: { data_url: `data:${mime};base64,${wav.toString("base64")}`, mime_type: mime }, protocol: result.protocol, sample_rate: (result as Row).sample_rate, latency_ms: Date.now() - started };
      }
      if (model.model_kind.startsWith("asr")) { if (!body.audio_data_url) throw new AppError("STT 测试请录音或上传音频，不使用静音冒充成功", 422); return { ok: true, ...await speech.transcribe(model, body.audio_data_url, "zh", undefined, { username: "管理员 · 模型测试" }) }; }
      if (model.model_kind === "image_generation") { const provider = providers.connection(model.provider_id); const extras = Object.fromEntries(Object.entries(model.extra_params).filter(([key]) => ["size", "quality", "style", "background", "output_format", "output_compression", "response_format", "moderation"].includes(key))); const payload = await requestJson(`${provider.base_url}/images/generations`, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json" }, body: JSON.stringify({ size: "1024x1024", ...extras, model: model.model_id, prompt: body.prompt || "A blue square on a white background", n: 1 }), signal: AbortSignal.timeout(provider.timeout_seconds * 1000) }); const image = payload.data?.[0]; if (!image) throw new AppError("生图接口未返回图片", 502); return { ok: true, image: image.b64_json ? { data_url: `data:image/${extras.output_format === "jpeg" ? "jpeg" : extras.output_format === "webp" ? "webp" : "png"};base64,${image.b64_json}` } : { url: image.url }, latency_ms: Date.now() - started }; }
      if (model.model_kind === "embedding") {
        const provider = providers.connection(model.provider_id);
        const response = await requestJson(`${provider.base_url.replace(/\/$/, "")}/embeddings`, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json" }, body: JSON.stringify({ model: model.model_id, input: body.input || "WebAgent embedding connectivity check" }), signal: AbortSignal.timeout(provider.timeout_seconds * 1000) });
        const vector = response.data?.[0]?.embedding;
        if (!Array.isArray(vector) || !vector.length || vector.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value))) throw new AppError("Embedding 接口未返回有效向量", 502);
        return { ok: true, message: `向量接口正常，维度 ${vector.length}`, dimensions: vector.length, sample: vector.slice(0, 8), usage: response.usage || {}, latency_ms: Date.now() - started };
      }
      if (model.model_kind === "rerank") {
        const provider = providers.connection(model.provider_id);
        const documents = Array.isArray(body.documents) && body.documents.length ? body.documents.slice(0, 8) : ["WebAgent business record query", "Unrelated weather report"];
        const response = await requestJson(`${provider.base_url.replace(/\/$/, "")}/rerank`, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json" }, body: JSON.stringify({ model: model.model_id, query: body.query || "查业务记录", documents, top_n: documents.length, return_documents: false }), signal: AbortSignal.timeout(provider.timeout_seconds * 1000) });
        const results = response.results || response.data;
        if (!Array.isArray(results) || !results.length) throw new AppError("Rerank 接口未返回排序结果", 502);
        const malformed = results.some((item: Row) => !Number.isSafeInteger(item.index) || !Number.isFinite(Number(item.relevance_score ?? item.score)));
        if (malformed) throw new AppError("Rerank 返回格式不符合 index + relevance_score 协议", 502);
        return { ok: true, message: `Rerank 接口正常，返回 ${results.length} 条排序结果`, results: results.slice(0, 8), usage: response.usage || {}, latency_ms: Date.now() - started };
      }
      const result = await providers.complete(model, [{ role: "user", content: body.message || "Hi" }], "test"); if (!result.content) throw new AppError("模型返回空回复", 502); return { ok: true, reply: result.content, latency_ms: Date.now() - started, usage: result.usage };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "模型测试失败", latency_ms: Date.now() - started }; }
  });
  app.post(`${api}/admin/models/:id/transcribe`, async (request) => { const model = store.model(Number((request.params as Row).id)); if (!model) throw new AppError("模型不存在", 404); const body = request.body as Row; return { ok: true, ...await speech.transcribe(model, body.audio_data_url, body.language, undefined, { username: "管理员 · 模型测试" }) }; });
  app.get(`${api}/admin/assistants`, async () => ({ items: store.assistants() }));
  const brandStillUsed = (relative: string) => String(store.settings().welcome_logo || "") === relative || store.assistants().some((item) => String(item.welcome_logo || "") === relative);
  /** 换 Logo 或删助手时清掉不再被引用的文件，避免品牌图片越攒越多。 */
  const releaseBrand = (relative: unknown) => { const value = String(relative || ""); if (value && !brandStillUsed(value)) removeBrandLogo(store.dataDir, value); };
  app.post(`${api}/admin/brand-logo`, async (request) => {
    const admin = auth.admin(request);
    const body = z.object({ data_url: z.string().max(3_200_000) }).parse(request.body);
    const saved = saveBrandLogo(store.dataDir, body.data_url);
    store.audit(admin.username, "brand.upload", saved.path, { size: saved.size });
    return { ...saved, url: brandUrl(saved.path, `${api}/brand`) };
  });
  app.get(`${api}/brand/:file`, async (request, reply) => {
    const logo = readBrandLogo(store.dataDir, String((request.params as Row).file));
    if (!logo) throw new AppError("Logo 不存在", 404);
    return reply.type(logo.mime_type)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(logo.bytes);
  });
  for (const method of ["POST", "PUT"] as const) app.route({ method, url: `${api}/admin/assistants${method === "PUT" ? "/:id" : ""}`, handler: async (request) => {
    const previous = method === "PUT" ? store.assistant(Number((request.params as Row).id)) : undefined; if (method === "PUT" && !previous) throw new AppError("助手不存在", 404);
    const values = assistantSchema.parse({ ...previous, ...request.body as Row });
    if (values.is_default && !values.enabled) throw new AppError("默认助手必须启用", 422);
    if (values.model_row_id && !["chat", "vision"].includes(store.model(values.model_row_id)?.model_kind)) throw new AppError("助手只能绑定对话模型", 422);
    // 输入框和通话都同时支持实时/非实时：通话的 STT 未配置实时模型时会缓冲 PCM 后走文件识别，
    // TTS 未配置实时模型时按句调用非实时合成，因此这里允许绑定两种类型。
    const assistantModelBindings: Record<string, string[]> = { asr_model_id: ["asr"], asr_realtime_model_id: ["asr_realtime"], tts_model_id: ["tts"], voice_asr_model_id: ["asr_realtime", "asr"], voice_tts_model_id: ["tts_realtime", "tts"] };
    for (const [key, kinds] of Object.entries(assistantModelBindings)) {
      const modelId = values[key as keyof typeof values] as number | null;
      if (!modelId) continue;
      const model = store.model(Number(modelId));
      if (!model?.enabled || !model.provider_enabled || !kinds.includes(model.model_kind)) throw new AppError(`${key} 对应模型不可用或类型不匹配`, 422);
    }
    if (values.skill_slugs.some((slug) => !skills.has(slug))) throw new AppError("助手选择了不存在的 Skill", 422);
    if (values.is_default) for (const item of store.assistants()) if (Number(item.id) !== Number(previous?.id ?? 0) && item.is_default) store.config.updateAssistant(Number(item.id), { is_default: false });
    const row = previous ? store.config.updateAssistant(Number(previous.id), values) : store.config.insertAssistant(values);
    if (previous && previous.welcome_logo !== values.welcome_logo) releaseBrand(previous.welcome_logo);
    return { assistant: row };
  } });
  app.delete(`${api}/admin/assistants/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const previous = store.assistant(id);
    store.run("UPDATE sessions SET assistant_id=NULL WHERE assistant_id=?", [id]);
    if (store.all("SELECT id FROM access_tokens WHERE assistant_id=?", [id]).length) throw new AppError("仍有接入 Token 绑定该助手，请先调整 Token", 409);
    store.config.deleteAssistant(id);
    releaseBrand(previous?.welcome_logo);
    return { ok: true };
  });
  app.get(`${api}/admin/tools`, async () => ({ items: await registry.catalog() }));
  app.patch(`${api}/admin/tools/:name/metadata`, async (request) => {
    const toolName = String((request.params as Row).name);
    const values = z.object({ title: z.string().max(80).optional(), description: z.string().max(500).optional() }).strict().parse(request.body);
    const tool = await registry.updateMetadata(toolName, values);
    store.audit(auth.admin(request).username, "tool.metadata", toolName, values);
    return { tool };
  });
  app.put(`${api}/admin/tools/:name/tags`, async (request) => {
    const tags = z.object({ tags: z.array(z.string().max(24)).max(12) }).strict().parse(request.body).tags;
    const tool = await registry.updateTags((request.params as Row).name, tags);
    store.audit(auth.admin(request).username, "tool.tags", (request.params as Row).name, { tags });
    return { ok: true, tool };
  });
  app.put(`${api}/admin/tools/:name`, async (request) => { const name = (request.params as Row).name; const values = z.object({ enabled: z.boolean().optional(), visible: z.boolean().optional(), selectable: z.boolean().optional(), default_selected: z.boolean().optional() }).strict().parse(request.body); const tool = await registry.updatePolicy(name, values); store.audit(auth.admin(request).username, "tool.policy", name, values); return { ok: true, tool }; });
  app.get(`${api}/admin/dynamic-tools`, async () => ({ items: store.httpTools() }));
  for (const method of ["POST", "PUT"] as const) app.route({ method, url: `${api}/admin/dynamic-tools${method === "PUT" ? "/:id" : ""}`, handler: async (request) => { const previous = method === "PUT" ? store.httpTool(Number((request.params as Row).id)) : undefined; if (method === "PUT" && !previous) throw new AppError("工具不存在", 404); const values = dynamicSchema.parse({ ...previous, ...request.body as Row }); safeUrl(values.url_template); if (values.input_schema.type !== "object") throw new AppError("工具输入 Schema 必须为 object", 422); if (runtimeToolNames.includes(values.name) || (await registry.catalog()).some((tool) => tool.name === values.name && (!previous || previous.name !== values.name))) throw new AppError("工具名称已存在或属于 PI 保留名称", 409); return { tool: store.saveHttpTool(previous, values) }; } });
  app.delete(`${api}/admin/dynamic-tools/:id`, async (request) => { store.deleteHttpTool(Number((request.params as Row).id)); return { ok: true }; });
  const mcpPublic = (row: Row) => { const { secret, ...safe } = row.config; const credentials = secret ? JSON.parse(decrypt(secret)) : {}; return { ...row, config: { ...safe, credential_names: Object.keys(credentials.headers || {}), has_secrets: Boolean(secret) } }; };
  /** 只做校验与密钥合并，不落盘；导入时先全量校验再写入，避免部分写入。 */
  const mcpValues = (input: unknown, previous?: Row) => {
    const body = z.object({ name, transport: z.enum(["http", "sse", "stdio"]), config: z.record(z.string(), z.unknown()), enabled: z.boolean().default(false) }).parse(input);
    const options = { ...previous?.config, ...body.config };
    if (body.transport !== "stdio") safeUrl(String(options.url || ""));
    else if (typeof options.command !== "string" || !Array.isArray(options.args || []) || (options.args as any[]).some((arg) => typeof arg !== "string")) throw new AppError("stdio 需要 command 和字符串 args 数组", 422);
    const headers = z.record(z.string(), z.string()).parse(options.headers || {});
    const environment = z.record(z.string(), z.string()).parse(options.env || {});
    for (const [key, value] of Object.entries(headers)) if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(value) || ["host", "content-length", "cookie"].includes(key.toLowerCase())) throw new AppError("MCP 请求头包含无效名称、保留字段或换行", 422);
    options.tool_policies = z.record(z.string(), z.object({ permission: z.string().max(100).optional(), public: z.boolean().optional(), risk: z.enum(["read", "write", "delete"]).optional() })).parse(options.tool_policies || {});
    const previousSecret = previous?.config.secret ? JSON.parse(decrypt(previous.config.secret)) : {};
    const secret = { headers: { ...previousSecret.headers, ...headers }, env: { ...previousSecret.env, ...environment } };
    delete options.headers; delete options.env; delete options.credential_names; delete options.has_secrets;
    options.secret = encrypt(JSON.stringify(secret)); if (!previous) delete options.cached_tools;
    return { ...body, config: options };
  };
  const saveMcp = (input: unknown, previous?: Row) => mcpPublic(store.saveMcpServer(previous, mcpValues(input, previous)));
  app.get(`${api}/admin/mcp-servers`, async () => ({ items: store.mcpServers().map(mcpPublic) }));
  app.post(`${api}/admin/mcp-servers/import`, async (request) => {
    const entries = z.record(z.string().min(1).max(100), z.record(z.string(), z.unknown())).parse((request.body as Row)?.mcpServers);
    if (!Object.keys(entries).length || Object.keys(entries).length > 30) throw new AppError("每次导入 1–30 个 MCP 连接器", 422);
    const payloads = Object.entries(entries).map(([serverName, entry]) => {
      const transport = entry.transport || entry.type || (entry.command ? "stdio" : "http");
      return mcpValues({ name: serverName, enabled: entry.enabled ?? false, transport: ["streamable-http", "streamable_http"].includes(String(transport)) ? "http" : transport, config: entry });
    });
    const items = payloads.map((payload) => mcpPublic(store.saveMcpServer(undefined, payload)));
    return { items, message: `已导入 ${items.length} 个 MCP 连接器，请测试同步并配置权限映射` };
  });
  for (const method of ["POST", "PUT"] as const) app.route({ method, url: `${api}/admin/mcp-servers${method === "PUT" ? "/:id" : ""}`, handler: async (request) => {
    const previous = method === "PUT" ? store.mcpServer(Number((request.params as Row).id)) : undefined; if (method === "PUT" && !previous) throw new AppError("MCP 不存在", 404);
    return { server: saveMcp(request.body, previous) };
  } });
  app.delete(`${api}/admin/mcp-servers/:id`, async (request) => { store.deleteMcpServer(Number((request.params as Row).id)); return { ok: true }; });
  app.post(`${api}/admin/mcp-servers/:id/test`, async (request) => { const server = store.mcpServer(Number((request.params as Row).id)); if (!server) throw new AppError("MCP 不存在", 404); const tools = await registry.discoverServer(server); store.cacheMcpTools(Number(server.id), tools); return { ok: true, tools, message: `连接成功，发现 ${tools.length} 个工具；请配置权限映射后开放` }; });
  app.get(`${api}/admin/skills`, async () => ({
    items: skills.list().map((skill) => ({ ...skill, id: skill.slug })),
    global_enabled: Boolean(store.settings().skills_enabled),
    root: skills.root,
  }));
  app.put(`${api}/admin/skills/global`, async (request) => {
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const settings = store.setSettings({ skills_enabled: body.enabled });
    store.audit(auth.admin(request).username, "skills.global", "skill-library", { enabled: body.enabled });
    return { ok: true, global_enabled: Boolean(settings.skills_enabled) };
  });
  const saveImportedSkill = (username: string, skill: ReturnType<typeof skillFromZip>) => {
    const previous = skills.get(skill.slug);
    const row = skills.saveImported(skill, { enabled: previous?.enabled ?? true, imported: true });
    store.audit(username, "skill.import", skill.slug, { name: skill.name, files: Object.keys(skill.files).length, updated: Boolean(previous) });
    return { skill: row, updated: Boolean(previous) };
  };
  app.post(`${api}/admin/skills/import-zip`, async (request) => {
    const body = z.object({ filename: z.string().max(200).optional(), data_base64: z.string().min(1).max(18000000) }).parse(request.body);
    return saveImportedSkill(auth.admin(request).username, skillFromZip(Buffer.from(body.data_base64, "base64")));
  });
  app.post(`${api}/admin/skills/import-directory`, async (request) => {
    const body = z.object({ files: z.array(z.object({ path: z.string().max(500), content: z.string().max(262144) })).min(1).max(200) }).parse(request.body);
    return saveImportedSkill(auth.admin(request).username, skillFromTextFiles(body.files));
  });
  for (const method of ["POST", "PUT"] as const) app.route({
    method,
    url: `${api}/admin/skills${method === "PUT" ? "/:id" : ""}`,
    handler: async (request) => {
      const params = request.params as Row;
      const previous = method === "PUT" ? skills.get(String(params.id)) : undefined;
      if (method === "PUT" && !previous) throw new AppError("技能不存在", 404);
      const values = skillSchema.parse({ ...previous, ...request.body as Row });
      const row = skills.save({
        slug: previous?.slug || values.slug,
        name: values.name,
        description: values.description,
        content: values.content,
        files: values.files,
        enabled: values.enabled,
        metadata: values.metadata,
      });
      store.audit(auth.admin(request).username, "skill.save", row.slug, { name: row.name, file_count: Object.keys(row.files).length });
      return { skill: row };
    },
  });
  app.delete(`${api}/admin/skills/:id`, async (request) => {
    skills.remove(String((request.params as Row).id));
    store.audit(auth.admin(request).username, "skill.delete", String((request.params as Row).id));
    return { ok: true };
  });
  app.get(`${api}/admin/sessions`, async (request) => {
    const query = request.query as Row;
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);
    const where: string[] = [];
    const values: any[] = [];
    if (query.username) { where.push("s.username=?"); values.push(String(query.username)); }
    if (query.owner_key) { where.push("s.owner_key=?"); values.push(String(query.owner_key)); }
    if (query.namespace) { where.push("s.namespace=?"); values.push(String(query.namespace)); }
    if (query.q) { where.push("(s.title LIKE ? OR s.username LIKE ?)"); values.push(`%${query.q}%`, `%${query.q}%`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const items = store.all(`SELECT s.* FROM sessions s ${clause} ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]).map((session) => ({ ...session, assistant_name: String(store.assistant(Number(session.assistant_id))?.name || ""), message_count: store.conversations.count(String(session.id)) }));
    return {
      items,
      total: store.one(`SELECT count(*) AS n FROM sessions s ${clause}`, values)!.n,
      all_total: store.one("SELECT count(*) AS n FROM sessions")!.n,
      users: store.all("SELECT owner_key,namespace,username,count(*) AS sessions,sum(total_tokens) AS total_tokens FROM sessions GROUP BY owner_key,namespace,username ORDER BY sessions DESC LIMIT 300"),
      filtered: items.length, limit, offset,
    };
  });
  app.get(`${api}/admin/business-users`, async (request) => {
    const query = request.query as Row;
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);
    const search = String(query.query || "").trim();
    const where = search ? "WHERE s.owner_key LIKE ? OR s.username LIKE ?" : "";
    const values = search ? [`%${search}%`, `%${search}%`] : [];
    const groups = store.all(
      `SELECT s.owner_key AS owner_key, max(s.username) AS display_name, count(*) AS sessions, max(s.updated_at) AS last_active_at
       FROM sessions s ${where}
       GROUP BY s.owner_key
       ORDER BY last_active_at DESC, s.owner_key ASC`,
      values,
    );
    const items = groups.slice(offset, offset + limit).map((group) => {
      const ownerKey = String(group.owner_key || "");
      const sessionIds = store.all("SELECT id FROM sessions WHERE owner_key=?", [ownerKey]).map((row) => String(row.id));
      const messages = sessionIds.reduce((total, id) => total + store.conversations.count(id), 0);
      const memories = Number(store.one("SELECT count(*) AS n FROM memories WHERE owner_key=?", [ownerKey])?.n || 0);
      return {
        owner_key: ownerKey,
        display_name: String(group.display_name || ownerKey),
        sessions: Number(group.sessions || 0),
        messages,
        memories,
        last_active_at: group.last_active_at || null,
      };
    });
    return { items, total: groups.length, limit, offset };
  });
  app.get(`${api}/admin/business-users/:ownerKey/memories`, async (request) => {
    const ownerKey = String((request.params as Row).ownerKey);
    const exists = store.one("SELECT owner_key FROM sessions WHERE owner_key=? LIMIT 1", [ownerKey])
      || store.one("SELECT owner_key FROM memories WHERE owner_key=? LIMIT 1", [ownerKey]);
    if (!exists) throw new AppError("业务用户不存在", 404);
    return { owner_key: ownerKey, items: store.all("SELECT * FROM memories WHERE owner_key=? ORDER BY updated_at DESC", [ownerKey]).map(memoryRow) };
  });
  app.patch(`${api}/admin/memories/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const previous = Number.isSafeInteger(id) ? store.one("SELECT * FROM memories WHERE id=?", [id]) : undefined;
    if (!previous) throw new AppError("记忆不存在", 404);
    const body = z.object({ content: z.string().trim().min(1).max(2000).optional(), enabled: z.boolean().optional() }).strict().parse(request.body);
    if (body.content === undefined && body.enabled === undefined) throw new AppError("没有可更新的字段", 422);
    const memory = store.update("memories", id, body)!;
    store.audit(auth.admin(request).username, "memory.update", String(id), { owner_key: previous.owner_key, content: body.content !== undefined, enabled: body.enabled });
    return { memory: memoryRow(memory) };
  });
  app.delete(`${api}/admin/memories/:id`, async (request) => {
    const id = Number((request.params as Row).id);
    const previous = Number.isSafeInteger(id) ? store.one("SELECT * FROM memories WHERE id=?", [id]) : undefined;
    if (!previous) throw new AppError("记忆不存在", 404);
    store.run("DELETE FROM memories WHERE id=?", [id]);
    store.audit(auth.admin(request).username, "memory.delete", String(id), { owner_key: previous.owner_key });
    return { ok: true };
  });
  app.get(`${api}/admin/sessions/:id`, async (request) => { const id = (request.params as Row).id; const session = store.one("SELECT * FROM sessions WHERE id=?", [id]); if (!session) throw new AppError("会话不存在", 404); return { session, messages: store.settings().admin_session_content ? store.conversations.messages(id) : [], llm_calls: store.all("SELECT * FROM llm_calls WHERE session_id=? ORDER BY id", [id]), compactions: store.all("SELECT * FROM compaction_events WHERE session_id=? ORDER BY id", [id]), runs: store.all("SELECT * FROM runs WHERE session_id=? ORDER BY started_at DESC", [id]) }; });
  app.get(`${api}/admin/sessions/:id/export`, async (request, reply) => { const id = (request.params as Row).id; if (!store.settings().admin_session_content) throw new AppError("管理员查看会话内容已关闭", 403); if (!store.one("SELECT id FROM sessions WHERE id=?", [id])) throw new AppError("会话不存在", 404); reply.header("Content-Disposition", `attachment; filename="session-${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json"`); return { session: store.one("SELECT * FROM sessions WHERE id=?", [id]), messages: store.conversations.messages(id) }; });
  app.get(`${api}/admin/audit`, async () => ({ items: store.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300") }));
  app.get(`${api}/admin/usage/summary`, async () => ({
    totals: store.one("SELECT count(*) AS calls,coalesce(sum(total_tokens),0) AS total_tokens,coalesce(sum(cost_usd),0) AS cost_usd,coalesce(avg(latency_ms),0) AS avg_latency_ms FROM llm_calls"),
    by_user: store.all("SELECT username,count(*) AS calls,sum(total_tokens) AS total_tokens,sum(cost_usd) AS cost_usd FROM llm_calls GROUP BY username"),
    by_purpose: store.all("SELECT purpose,count(*) AS calls,sum(total_tokens) AS total_tokens,avg(latency_ms) AS avg_latency_ms FROM llm_calls GROUP BY purpose ORDER BY calls DESC"),
    calls: store.all("SELECT * FROM llm_calls ORDER BY id DESC LIMIT 300"),
  }));
  const fileSize = (target: string) => {
    const resolved = target.startsWith("/") ? target : path.join(store.dataDir, target);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) return stat.size;
      return fs.readdirSync(resolved, { withFileTypes: true }).reduce((total, entry) => total + fileSize(path.join(resolved, entry.name)), 0);
    } catch { return 0; }
  };
  const storageInfo = () => {
    const page = store.one("PRAGMA page_count")?.page_count || 0;
    const pageSize = store.one("PRAGMA page_size")?.page_size || 0;
    return {
      data_dir: store.dataDir,
      agent_db_bytes: fileSize(store.paths.database), agent_wal_bytes: fileSize(`${store.paths.database}-wal`), agent_shm_bytes: fileSize(`${store.paths.database}-shm`),
      agent_sqlite_bytes: Number(page) * Number(pageSize),
      config_bytes: fileSize(store.paths.config), tools_bytes: fileSize(store.paths.tools), skills_bytes: fileSize(store.paths.skills), cache_bytes: fileSize(store.paths.cache),
      sessions: store.one("SELECT count(*) AS n FROM sessions")!.n,
      messages: store.conversations.totalMessages(),
      conversation_bytes: store.conversations.bytes(),
      runs: store.one("SELECT count(*) AS n FROM runs")!.n,
      run_events: store.one("SELECT count(*) AS n FROM run_events")!.n,
      llm_calls: store.one("SELECT count(*) AS n FROM llm_calls")!.n,
      compactions: store.one("SELECT count(*) AS n FROM compaction_events")!.n,
      questions: store.one("SELECT count(*) AS n FROM questions")!.n,
      approvals: store.one("SELECT count(*) AS n FROM approvals_v2")!.n,
      oldest_session: store.one("SELECT min(updated_at) AS value FROM sessions")?.value || null,
      newest_session: store.one("SELECT max(updated_at) AS value FROM sessions")?.value || null,
    };
  };
  const cleanupPlan = (input: Row) => {
    const days = Number(input.days);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new AppError("清理天数必须是 1–3650 的整数", 422);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const sessions = store.all("SELECT id,username,title,updated_at FROM sessions WHERE updated_at < ? AND id NOT IN (SELECT session_id FROM runs WHERE status='running') ORDER BY updated_at", [cutoff]);
    const ids = sessions.map((row) => row.id);
    const messages = ids.reduce((total, id) => total + store.conversations.count(id), 0);
    return { days, cutoff, sessions, ids, messages, bytes: storageInfo().agent_db_bytes };
  };
  app.get(`${api}/admin/storage`, async () => storageInfo());
  app.post(`${api}/admin/sessions/cleanup-preview`, async (request) => { const plan = cleanupPlan(request.body as Row || {}); return { ...plan, count: plan.ids.length }; });
  app.post(`${api}/admin/sessions/cleanup`, async (request) => {
    const plan = cleanupPlan(request.body as Row || {});
    if (!plan.ids.length) return { deleted: 0, messages: 0, cutoff: plan.cutoff };
    const deleted = plan.ids.filter((id) => store.removeSession(id)).length;
    store.audit(auth.admin(request).username, "sessions.cleanup", "sessions", { count: deleted, cutoff: plan.cutoff });
    return { deleted, messages: plan.messages, cutoff: plan.cutoff };
  });
  app.delete(`${api}/admin/sessions/:id`, async (request) => {
    const id = (request.params as Row).id;
    const session = store.one("SELECT * FROM sessions WHERE id=?", [id]); if (!session) throw new AppError("会话不存在", 404);
    store.assertIdle(id);
    store.removeSession(id);
    store.audit(auth.admin(request).username, "session.delete", id, { username: session.username, title: session.title });
    return { ok: true };
  });
  app.post(`${api}/admin/storage/vacuum`, async (request) => {
    if (store.one("SELECT count(*) AS n FROM runs WHERE status='running'")!.n) throw new AppError("仍有运行中的任务，暂不执行 VACUUM", 409);
    store.agent.exec("VACUUM");
    store.audit(auth.admin(request).username, "storage.vacuum", "agent.db");
    return { ok: true, storage: storageInfo() };
  });
  app.get(`${api}/admin/runs/:id`, async (request) => runs.diagnostics((request.params as Row).id));
  app.get(`${api}/admin/pagepilot`, async () => { const settings = store.settings(); return { ...publications.status(), base_url: settings.pagepilot_base_url, token_set: Boolean(settings.pagepilot_token), token_masked: mask(settings.pagepilot_token ? decrypt(settings.pagepilot_token) : ""), default_title: settings.pagepilot_default_title, default_description: settings.pagepilot_default_description, default_visibility: settings.pagepilot_default_visibility }; });
  app.put(`${api}/admin/pagepilot`, async (request) => { const body = z.object({ base_url: z.string().max(1000), token: z.string().max(1000).optional(), clear_token: z.boolean().optional(), enabled: z.boolean().optional(), default_title: z.string().max(100).optional(), default_description: z.string().max(240).optional(), default_visibility: z.enum(["public", "unlisted"]).optional() }).parse(request.body); if (body.base_url) safeUrl(body.base_url); const values: Row = { pagepilot_base_url: body.base_url.replace(/\/$/, "") }; for (const key of ["enabled", "default_title", "default_description", "default_visibility"] as const) if (body[key] !== undefined) values[`pagepilot_${key}`] = body[key]; if (body.clear_token || body.token) values.pagepilot_token = encrypt(body.clear_token ? "" : body.token!); store.setSettings(values); return { ok: true }; });
  app.post(`${api}/admin/pagepilot/test`, async () => { try { return await publications.test(); } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "测试失败" }; } });
  app.get(`${api}/admin/runtime-core`, async () => core.info());
  app.get(`${api}/admin/runtime-core/updates`, async () => core.updates());
  app.post(`${api}/admin/runtime-core/upgrade-plan`, async (request) => core.plan(z.string().max(40).parse((request.body as Row).version)));
}
