import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Auth } from "./auth.js";
import { Store } from "./store.js";
import { PiRuntime, type ChatInput } from "./pi-runtime.js";
import { Runs } from "./runs.js";
import { ToolRegistry } from "./tools.js";
import { Speech } from "./speech.js";
import { Publications } from "./publications.js";
import { SkillLibrary } from "./skill-library.js";
import { speakableText } from "./speech-text.js";
import { brandUrl, readBrandLogo } from "./brand.js";
import { AppError, type Row } from "./types.js";
import { effectiveAssistantConfig } from "./assistant-config.js";
import { copySessionAttachments, readSessionUpload } from "./attachments.js";
import { normalizeVoiceInputMode, resolveVoiceInputMode, voiceInputCandidates } from "./voice-input.js";

const prefix = "/api/agent";
const chatSchema = z.object({ message: z.string().max(20000).optional(), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).max(40).optional(), session_id: z.string().max(100).optional(), assistant_id: z.number().int().positive().optional(), model_row_id: z.number().int().positive().optional(), enabled_tools: z.array(z.string().max(64)).max(500).optional(), reasoning_effort: z.enum(["off", "none", "minimal", "low", "medium", "high", "xhigh"]).nullish().transform((value) => value ?? undefined), approval_mode: z.enum(["confirm", "full_access"]).optional(), attachments: z.array(z.object({ name: z.string().max(160), mime_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), data_url: z.string().max(8000000) })).max(4).optional() });
const answerSchema = z.object({ values: z.array(z.string().max(200)).max(12).optional(), free_text: z.string().max(4000).optional(), cancel: z.boolean().optional() });
export function chatRoutes(app: FastifyInstance, context: { store: Store; auth: Auth; skills: SkillLibrary; runtime: PiRuntime; runs: Runs; registry: ToolRegistry; speech: Speech; publications: Publications }) {
  const { store, auth, skills, runtime, runs, registry, speech, publications } = context;
  const speechStatus = (id: number | null, kinds: string[]) => {
    const model = id ? store.model(id) : undefined;
    const ready = Boolean(model?.enabled && model.provider_enabled !== false && kinds.includes(model.model_kind));
    return { configured: ready, model_id: ready ? model!.id : null, model_name: ready ? model!.name : "", model_kind: ready ? model!.model_kind : "", reason: ready ? "" : "管理员尚未配置可用语音模型" };
  };
  app.get(`${prefix}/status`, async (request, reply) => {
    const agent = await auth.agent(request, reply); const settings = store.settings();
    const assistant = runtime.assistant(agent.identity, Number((request.query as Row).assistant_id) || undefined);
    const effective = effectiveAssistantConfig(assistant, settings);
    const { pagepilot_token, memory_extraction_prompt, ...publicSettings } = settings;
    const fileAsr = speechStatus(effective.asr_model_id, ["asr"]);
    const realtimeAsr = speechStatus(effective.asr_realtime_model_id, ["asr_realtime"]);
    const fileTts = speechStatus(effective.tts_model_id, ["tts", "tts_realtime"]);
    const voiceAsr = speechStatus(effective.voice_asr_model_id, ["asr_realtime", "asr"]);
    const voiceTts = speechStatus(effective.voice_tts_model_id, ["tts_realtime", "tts"]);
    // voice_input_mode 返回解析后的实际通道；原始偏好单独返回，便于管理端和接入方区分
    // “自动优先文件/实时”与显式选择。只有 auto_* 会在模型不可用时跨通道兜底。
    const voiceInputCapabilities = { file: fileAsr.configured, realtime: realtimeAsr.configured };
    const voiceInputPrefer = normalizeVoiceInputMode(effective.voice_input_mode);
    const voiceInputMode = resolveVoiceInputMode(voiceInputPrefer, voiceInputCapabilities);
    const ownerKey = agent.identity.owner_key;
    const memoryCount = Number(store.one("SELECT COUNT(*) AS total FROM memories WHERE owner_key=? AND enabled=1", [ownerKey])?.total || 0);
    const memoryPending = Number(store.one("SELECT COUNT(*) AS total FROM memories WHERE owner_key=? AND enabled=0 AND kind='extracted'", [ownerKey])?.total || 0);
    return {
      ...publicSettings,
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      runtime: "pi",
      auth_mode: agent.mode,
      fixed_assistant_id: agent.identity.assistant_id ?? null,
      welcome_title: effective.welcome_title,
      welcome_subtitle: effective.welcome_subtitle,
      welcome_prompts: effective.welcome_prompts,
      welcome_logo: brandUrl(effective.welcome_logo),
      allow_full_access: effective.allow_full_access,
      memory: { enabled: Boolean(settings.memory_enabled && (assistant.memory_enabled ?? true)), auto_extract: Boolean(settings.memory_auto_extract), auto_confirm: Boolean(settings.memory_auto_confirm), count: memoryCount, pending: memoryPending },
      asr: fileAsr,
      asr_realtime: realtimeAsr,
      tts: fileTts.configured ? fileTts : voiceTts,
      voice_asr: voiceAsr,
      voice_tts: voiceTts,
      voice_input_mode: voiceInputMode,
      voice_input_prefer: voiceInputPrefer,
      voice_input_capabilities: voiceInputCapabilities,
      voice_auto_send: effective.voice_auto_send,
      tts_auto_read: effective.tts_auto_read,
      tts_max_read_chars: effective.tts_max_read_chars,
      default_reasoning_effort: effective.default_reasoning_effort,
      default_approval_mode: effective.default_approval_mode,
      pagepilot: publications.status(),
    };
  });
  // 品牌徽标是公开静态资源：文件名带内容哈希，Chat 在登录前也能正常显示空态。
  app.get(`${prefix}/brand/:file`, async (request, reply) => {
    const logo = readBrandLogo(store.dataDir, String((request.params as Row).file));
    if (!logo) throw new AppError("Logo 不存在", 404);
    return reply.type(logo.mime_type)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(logo.bytes);
  });
  app.get(`${prefix}/models`, async (request, reply) => { await auth.agent(request, reply); return { items: store.models(true).map(({ extra_params, ...model }) => model) }; });
  app.get(`${prefix}/assistants`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); return { items: runtime.assistants(user).map(({ system_prompt, allowed_roles, ...assistant }) => assistant) }; });
  app.get(`${prefix}/tools`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply); const assistant = runtime.assistant(user, Number((request.query as Row).assistant_id) || undefined);
    const authorized = (await registry.all()).filter((tool) => (!tool.permission || user.permissions.includes(tool.permission)) && (!assistant.tool_names.length || assistant.tool_names.includes(tool.name)) && registry.setting(tool).enabled);
    const visible = authorized.filter((tool) => registry.setting(tool).visible);
    const autoEnabled = authorized.filter((tool) => !registry.setting(tool).visible && registry.setting(tool).default_selected);
    return { items: visible.map((spec) => { const { execute, ...tool } = spec; return { ...tool, ...registry.setting(spec) }; }), auto_enabled_count: autoEnabled.length };
  });
  app.get(`${prefix}/skills`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply);
    const assistant = runtime.assistant(user, Number((request.query as Row).assistant_id) || undefined);
    const items = store.settings().skills_enabled
      ? skills.activeForAssistant(assistant).map(({ content, files, path, ...skill }) => ({ ...skill, file_count: Object.keys(files).length }))
      : [];
    return { items };
  });
  app.get(`${prefix}/sessions`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); return { items: store.all("SELECT * FROM sessions WHERE owner_key=? ORDER BY updated_at DESC LIMIT 200", [user.owner_key]).map((session) => ({ ...session, assistant_name: String(store.assistant(Number(session.assistant_id))?.name || "") })) }; });
  app.delete(`${prefix}/sessions`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply);
    let deleted = 0;
    let skipped = 0;
    for (const row of store.all("SELECT id FROM sessions WHERE owner_key=?", [user.owner_key])) {
      if (!store.removeSession(String(row.id))) skipped += 1;
      else deleted += 1;
    }
    return { ok: true, deleted, skipped };
  });
  app.post(`${prefix}/sessions`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const body = z.object({ title: z.string().max(120).optional(), assistant_id: z.number().int().positive().optional() }).parse(request.body || {}); reply.code(201); return { session: runtime.createSession(user, body) }; });
  app.patch(`${prefix}/sessions/:id`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const id = (request.params as Row).id; store.ownedSession(id, user); store.assertIdle(id); const body = z.object({ title: z.string().trim().min(1).max(120).optional(), assistant_id: z.number().int().positive().optional() }).parse(request.body); if (body.assistant_id) { runtime.assistant(user, body.assistant_id); store.invalidateContext(id); } return { session: store.update("sessions", id, body) }; });
  app.delete(`${prefix}/sessions/:id`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const id = (request.params as Row).id; store.ownedSession(id, user); store.assertIdle(id); store.removeSession(id); return { ok: true }; });
  app.get(`${prefix}/sessions/:id/messages`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const id = (request.params as Row).id; const session = store.ownedSession(id, user); return { session, items: store.conversations.messages(id), active_run: store.one("SELECT id,status FROM runs WHERE session_id=? AND status='running' ORDER BY started_at DESC LIMIT 1", [id]) || null }; });
  app.get(`${prefix}/sessions/:id/attachments/:file`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply);
    const { id, file } = request.params as Row;
    store.ownedSession(id, user);
    const upload = readSessionUpload(store.dataDir, id, String(file));
    if (!upload) throw new AppError("附件不存在", 404);
    return reply
      .type(upload.mime_type)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(file))}`)
      .send(upload.bytes);
  });
  app.delete(`${prefix}/sessions/:id/messages`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const id = (request.params as Row).id; store.ownedSession(id, user); store.assertIdle(id); store.run("DELETE FROM approvals_v2 WHERE session_id=?", [id]); store.invalidateContext(id); store.conversations.clear(id); return { ok: true }; });
  app.post(`${prefix}/sessions/:id/fork`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply); const id = (request.params as Row).id; const source = store.ownedSession(id, user); store.assertIdle(id);
    const body = z.object({ until_message_id: z.number().int().positive().optional(), title: z.string().min(1).max(120).optional() }).parse(request.body || {});
    const messages = store.conversations.messages(id);
    if (body.until_message_id && !messages.some((message) => message.id === body.until_message_id)) throw new AppError("分叉消息不存在", 404);
    const created = runtime.createSession(user, { assistant_id: source.assistant_id, title: body.title || `${source.title} · 分叉` });
    try {
      for (const message of messages) {
        if (body.until_message_id && message.id > body.until_message_id) break;
        const { id, metadata, created_at, ...copy } = message;
        const { approval, question, ...safeMetadata } = metadata;
        const attachments = copySessionAttachments(store.dataDir, source.id, created.id, message.attachments || []);
        store.conversations.insert(created.id, { ...copy, attachments, metadata: { ...safeMetadata, approval_status: approval ? "forked" : undefined, question_status: question ? "forked" : undefined } });
      }
      const session = store.update("sessions", created.id, { last_model_id: source.last_model_id, last_model_name: source.last_model_name })!;
      reply.code(201);
      return { session };
    } catch (error) {
      store.removeSession(created.id);
      throw error;
    }
  });
  for (const method of ["PATCH", "DELETE"] as const) app.route({ method, url: `${prefix}/sessions/:id/messages/:messageId`, handler: async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const params = request.params as Row; store.ownedSession(params.id, user); store.assertIdle(params.id); const message = store.conversations.message(params.id, Number(params.messageId)); if (!message) throw new AppError("消息不存在", 404); if (method === "PATCH") { const content = z.string().min(1).max(20000).parse((request.body as Row).content); store.conversations.update(params.id, Number(message.id), { content }); store.conversations.deleteFrom(params.id, Number(message.id), false); } else store.conversations.deleteFrom(params.id, Number(message.id), true); store.invalidateContext(params.id); store.run("UPDATE approvals_v2 SET status='invalidated' WHERE session_id=? AND status='pending'", [params.id]); return { ok: true }; } });
  app.post(`${prefix}/sessions/:id/compact`, async (request, reply) => { const { identity: user, credential } = await auth.agent(request, reply); return runtime.compact(user, credential, (request.params as Row).id, Number((request.body as Row)?.model_row_id) || undefined); });
  app.post(`${prefix}/chat/stream`, async (request, reply) => { const body = chatSchema.parse(request.body); const agent = await auth.agent(request, reply); const run = await runs.start(agent.credential, body, agent.identity); runs.subscribe(run.id, agent.identity, reply); });
  app.get(`${prefix}/chat/stream/:id`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); runs.subscribe((request.params as Row).id, user, reply, Number(request.headers["last-event-id"] || (request.query as Row).after || 0)); });
  app.post(`${prefix}/chat`, async (request, reply) => { const agent = await auth.agent(request, reply); const run = await runs.start(agent.credential, chatSchema.parse(request.body), agent.identity); return run.task; });
  app.post(`${prefix}/runs/:id/cancel`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return runs.cancel((request.params as Row).id, identity); });
  app.get(`${prefix}/runs/:id`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return { run: runs.owned((request.params as Row).id, identity) }; });
  for (const choice of ["approve", "reject"] as const) app.post(`${prefix}/approvals/:id/${choice}`, async (request, reply) => { const agent = await auth.agent(request, reply); const run = await runs.approval(agent.credential, (request.params as Row).id, choice === "approve", agent.identity); if (request.headers.accept?.includes("text/event-stream")) { runs.subscribe(run.id, agent.identity, reply); return; } return run.task; });
  app.post(`${prefix}/questions/:id/answer`, async (request, reply) => { const body = answerSchema.parse(request.body || {}); const agent = await auth.agent(request, reply); const run = await runs.answer(agent.credential, (request.params as Row).id, body, agent.identity); if (run.task && request.headers.accept?.includes("text/event-stream")) { runs.subscribe(run.id, agent.identity, reply); return; } return run.task || run.result; });
  app.get(`${prefix}/memories`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); return { items: store.all("SELECT * FROM memories WHERE owner_key=? ORDER BY updated_at DESC", [user.owner_key]) }; });
  app.post(`${prefix}/memories`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const body = z.object({ content: z.string().min(1).max(2000), kind: z.string().max(20).default("fact") }).parse(request.body); reply.code(201); return { memory: store.insert("memories", { ...body, ...store.ownerColumns(user) }) }; });
  app.patch(`${prefix}/memories/:id`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const id = Number((request.params as Row).id); if (!store.one("SELECT id FROM memories WHERE id=? AND owner_key=?", [id, user.owner_key])) throw new AppError("记忆不存在", 404); const body = z.object({ content: z.string().min(1).max(2000).optional(), enabled: z.boolean().optional() }).parse(request.body); return { memory: store.update("memories", id, body) }; });
  app.delete(`${prefix}/memories/:id`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); store.run("DELETE FROM memories WHERE id=? AND owner_key=?", [Number((request.params as Row).id), user.owner_key]); return { ok: true }; });
  app.get(`${prefix}/usage/me`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); return { totals: store.one("SELECT coalesce(sum(lc.total_tokens),0) AS total_tokens,coalesce(sum(lc.cost_usd),0) AS cost_usd FROM llm_calls lc JOIN sessions s ON s.id=lc.session_id WHERE s.owner_key=?", [user.owner_key]), calls: store.all("SELECT lc.* FROM llm_calls lc JOIN sessions s ON s.id=lc.session_id WHERE s.owner_key=? ORDER BY lc.id DESC LIMIT 100", [user.owner_key]) }; });
  app.post(`${prefix}/transcribe`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply);
    const settings = store.settings();
    const body = z.object({ audio_data_url: z.string().max(18000000), language: z.string().max(20).default("zh"), assistant_id: z.number().int().positive().optional(), session_id: z.string().max(100).optional() }).parse(request.body);
    if (body.session_id) store.ownedSession(body.session_id, user);
    const assistant = runtime.assistant(user, body.assistant_id);
    const effective = effectiveAssistantConfig(assistant, settings);
    const fileModel = effective.asr_model_id ? store.model(effective.asr_model_id) : undefined;
    const realtimeModel = effective.asr_realtime_model_id ? store.model(effective.asr_realtime_model_id) : undefined;
    const capabilities = {
      file: Boolean(fileModel?.enabled && fileModel.provider_enabled !== false && fileModel.model_kind === "asr"),
      realtime: Boolean(realtimeModel?.enabled && realtimeModel.provider_enabled !== false && realtimeModel.model_kind === "asr_realtime"),
    };
    const candidatesByMode = voiceInputCandidates(normalizeVoiceInputMode(effective.voice_input_mode), capabilities)
      .map((channel) => channel === "realtime" ? effective.asr_realtime_model_id : effective.asr_model_id);
    const models = [...new Set(candidatesByMode.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
    const candidates = models.map((id) => store.model(id)).filter((model): model is Row => Boolean(model?.enabled && model.provider_enabled && ["asr", "asr_realtime"].includes(model.model_kind)));
    if (!candidates.length) throw new AppError("管理员尚未配置可用 STT 模型", 422);
    let lastError: unknown;
    for (const model of candidates) {
      try { return { ...await speech.transcribe(model, body.audio_data_url, body.language, undefined, { sessionId: body.session_id, username: user.username }), model_id: model.id, model_name: model.name }; }
      catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new AppError("语音识别失败", 502);
  });
  app.post(`${prefix}/audio/speech`, async (request, reply) => {
    const { identity: user } = await auth.agent(request, reply);
    const controller = new AbortController();
    request.raw.once("close", () => controller.abort());
    const settings = store.settings();
    const body = request.body as Row;
    const assistant = runtime.assistant(user, Number(body.assistant_id) || undefined);
    const effective = effectiveAssistantConfig(assistant, settings);
    const model = store.model(effective.tts_model_id || effective.voice_tts_model_id || 0);
    if (!model) throw new AppError("管理员尚未配置非实时 TTS 模型", 422);
    const maxChars = Math.min(4000, Math.max(1, Number(effective.tts_max_read_chars || 1200)));
    const text = speakableText(String(body.text || body.input || "")).slice(0, maxChars);
    if (!text.trim()) throw new AppError("没有可朗读的正文；代码、HTML、表格和链接不会被朗读", 422);
    if (body.session_id) store.ownedSession(String(body.session_id), user);
    const result = await speech.synthesize(model, text, body, controller.signal, { sessionId: body.session_id ? String(body.session_id) : undefined, username: user.username });
    return reply.type(result.mime_type).header("Cache-Control", "no-store").send(result.bytes);
  });
  app.get(`${prefix}/pagepilot/status`, async (request, reply) => { await auth.agent(request, reply); return publications.status(); });
  app.get(`${prefix}/pagepilot/publications`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return publications.list(identity, request.query as Row); });
  app.get(`${prefix}/pagepilot/publications/:id`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return { publication: publications.detail(Number((request.params as Row).id), identity) }; });
  app.get(`${prefix}/pagepilot/publications/:id/versions/:version`, async (request, reply) => { const { identity: user } = await auth.agent(request, reply); const params = request.params as Row; publications.owned(Number(params.id), user); const version = store.one("SELECT * FROM publication_versions WHERE publication_id=? AND id=?", [Number(params.id), Number(params.version)]); if (!version) throw new AppError("页面版本不存在", 404); return { version }; });
  app.delete(`${prefix}/pagepilot/publications/:id`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return publications.remove(Number((request.params as Row).id), identity); });
  app.post(`${prefix}/pagepilot/publish`, async (request, reply) => { const { identity } = await auth.agent(request, reply); return publications.publish(identity, request.body as Row); });
}
