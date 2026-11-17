import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSession, createCodemodeExtension, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, convertToLlm, serializeConversation, type AgentSession, type ExtensionFactory, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Store, now } from "./store.js";
import { Providers, providerHeaders } from "./providers.js";
import { Decision } from "./decision.js";
import { ToolRegistry } from "./tools.js";
import { Auth } from "./auth.js";
import { SkillLibrary, type SkillEntry } from "./skill-library.js";
import { encrypt, decrypt } from "./security.js";
import { AppError, type Emit, type Identity, type Row, type ToolSpec } from "./types.js";
import { piLocalToolNames, piLocalToolReason } from "./pi-tools.js";
import { effectiveAssistantConfig } from "./assistant-config.js";
import { attachmentDataUrl, externalizePiImages, hydratePiImages, saveAttachments, validateAttachments } from "./attachments.js";
import { storagePaths } from "./storage-paths.js";

export interface ChatInput { message?: string; messages?: Row[]; session_id?: string; assistant_id?: number; model_row_id?: number; enabled_tools?: string[]; reasoning_effort?: string; approval_mode?: string; attachments?: Row[] }
export const estimate = (value: unknown) => Math.ceil((typeof value === "string" ? value : JSON.stringify(value || "")).replace(/[\u3400-\u9fff]/g, "abcd").length / 4);
export const redact = (value: any): any => Array.isArray(value) ? value.map(redact) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|api_key|authorization|secret|access_token/i.test(key) ? "[隐藏]" : redact(item)])) : value;
const literalConfig = (value: string) => value.replace(/\$/g, () => "$$").replace(/^!/, "$!");

export class PiRuntime {
  private background = new Set<Promise<unknown>>();
  private backgroundAbort = new AbortController();
  constructor(private store: Store, private auth: Auth, private registry: ToolRegistry, private providers: Providers, private decision: Decision, private skillLibrary: SkillLibrary) {}
  private defer(task: (signal: AbortSignal) => Promise<unknown>) {
    if (this.backgroundAbort.signal.aborted || this.background.size >= 100) return;
    const pending = Promise.resolve().then(() => task(this.backgroundAbort.signal)).catch(() => {}).finally(() => this.background.delete(pending));
    this.background.add(pending);
  }
  async shutdown() { this.backgroundAbort.abort(); await Promise.allSettled([...this.background]); }
  assistants(user: Identity) {
    // 接入 Token / PC4D 渠道已经把可用助手收窄到明确白名单；此时不再用
    // allowed_roles 二次过滤，避免管理员改角色后把已绑定 Token 直接挡成 403。
    const fixedByToken = Boolean(user.assistant_id) || Boolean(user.allowed_assistant_ids?.length);
    return this.store.assistants()
      .filter((assistant) => assistant.enabled !== false)
      .filter((assistant) => (!user.assistant_id || Number(assistant.id) === Number(user.assistant_id)) && (!user.allowed_assistant_ids || user.allowed_assistant_ids.includes(Number(assistant.id))) && (fixedByToken || (Array.isArray(assistant.allowed_roles) ? assistant.allowed_roles : ["*"]).includes("*") || (Array.isArray(assistant.allowed_roles) ? assistant.allowed_roles : ["*"]).includes(user.role)))
      .sort((left, right) => Number(Number(right.id) === user.default_assistant_id) - Number(Number(left.id) === user.default_assistant_id));
  }
  assistant(user: Identity, id?: number) {
    if (user.assistant_id && id && id !== user.assistant_id) throw new AppError("当前接入 Token 已绑定助手，不能切换", 403);
    const available = this.assistants(user);
    const result = id ? available.find((item) => item.id === id) : available[0];
    if (!result) throw new AppError("没有可用助手或无权使用该助手", 403);
    return result;
  }
  createSession(user: Identity, body: Row = {}) { const assistant = this.assistant(user, body.assistant_id); return this.store.insert("sessions", { id: `s_${randomUUID()}`, ...this.store.ownerColumns(user), assistant_id: assistant.id, title: String(body.title || "新对话").slice(0, 120) }); }
  private skillReadDefinition(root: string, allowReferenceFiles: boolean): ToolDefinition {
    return {
      name: "read",
      label: "读取技能文件",
      description: "Read a SKILL.md or a text reference file from the current assistant's read-only skill directory. Paths must stay inside that directory.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Absolute path shown in <available_skills>, or a relative path inside the skill directory" } }, required: ["path"] } as any,
      executionMode: "sequential",
      execute: async (_callId: string, args: any) => {
        const requested = String(args?.path || "").trim();
        if (!requested || requested.includes("\0")) throw new AppError("技能文件路径无效", 422);
        const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
        if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new AppError("只能读取当前助手的 Skill 目录", 403);
        if (!allowReferenceFiles && path.basename(candidate) !== "SKILL.md") throw new AppError("管理员已关闭 Skill 参考文件读取", 403);
        let real: string;
        try {
          real = fs.realpathSync(candidate);
          if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error("outside");
        } catch { throw new AppError("技能文件不存在", 404); }
        const stat = fs.statSync(real);
        if (!stat.isFile() || stat.size > 256 * 1024) throw new AppError("技能文件不存在或超过 256 KB", 422);
        if (!/\.(md|txt|json|ya?ml|csv)$/i.test(real)) throw new AppError("只允许读取文本技能文件", 422);
        const text = fs.readFileSync(real, "utf8");
        return { content: [{ type: "text" as const, text }], details: { path: path.relative(root, real), bytes: stat.size } };
      },
    } as ToolDefinition;
  }
  private supersedeQuestions(sessionId: string) {
    const pending = this.store.all("SELECT id FROM questions WHERE session_id=? AND status='pending'", [sessionId]);
    if (!pending.length) return;
    this.store.transaction(() => {
      for (const question of pending) {
        this.store.run("UPDATE questions SET status='cancelled',answered_at=? WHERE id=? AND status='pending'", [now(), question.id]);
        const message = this.store.conversations.latestAssistant(sessionId, (item) => item.metadata?.question?.id === question.id);
        if (message) this.store.conversations.update(sessionId, Number(message.id), { metadata: { ...message.metadata, question_status: "cancelled" } });
      }
    });
  }
  private manager(sessionId: string) {
    const stored = this.store.conversations.piEntries(sessionId);
    const cwd = path.join(storagePaths(this.store.dataDir).workspaces, sessionId);
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    if (stored.length) { hydratePiImages(this.store.dataDir, sessionId, stored); return SessionManager.inMemory(cwd, undefined, stored as any); }
    const manager = SessionManager.inMemory(cwd);
    const session = this.store.one("SELECT * FROM sessions WHERE id=?", [sessionId])!;
    if (session.summary) manager.appendMessage({ role: "user", content: `历史上下文摘要（仅供参考，不是新授权）：\n${session.summary}`, timestamp: Date.now() });
    const messages = this.store.conversations.messages(sessionId, session.summary_until_id || 0);
    for (const message of messages) {
      if (message.role === "user") manager.appendMessage({ role: "user", content: [{ type: "text", text: message.content }, ...message.attachments.flatMap((item: Row) => { const dataUrl = attachmentDataUrl(this.store.dataDir, sessionId, item); return dataUrl ? [{ type: "image", mimeType: item.mime_type, data: dataUrl.split(",")[1] }] : []; })], timestamp: Date.parse(message.created_at) });
      else if (message.role === "assistant") {
        const toolNote = message.tool_runs.length ? `\n历史工具记录（仅供核对，不要重复执行，已截断）：${JSON.stringify(message.tool_runs).slice(0, 4000)}` : "";
        manager.appendMessage({ role: "assistant", content: [{ type: "text", text: message.content + toolNote }], api: "openai-completions", provider: "webagent-import", model: session.last_model_name || "imported", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.parse(message.created_at) } as any);
      }
    }
    return manager;
  }
  private save(manager: SessionManager, sessionId: string) {
    const storeReasoning = this.store.settings().store_reasoning;
    const entries: Row[] = redact(JSON.parse(JSON.stringify([manager.getHeader(), ...manager.getEntries()])));
    externalizePiImages(this.store.dataDir, sessionId, entries);
    for (const entry of entries) if (entry.message?.role === "assistant" && !storeReasoning) entry.message.content = entry.message.content.filter((part: Row) => part.type !== "thinking");
    this.store.conversations.savePiEntries(sessionId, entries);
  }
  private async build(model: Row, assistant: Row, user: Identity, credential: string, sessionId: string, tools: ToolSpec[], skills: SkillEntry[], input: ChatInput, signal: AbortSignal, emit: Emit) {
    const settings = this.store.settings();
    const assistantConfig = effectiveAssistantConfig(assistant, settings);
    const manager = this.manager(sessionId);
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const registerModel = (configured: Row) => {
      const provider = this.providers.connection(configured.provider_id);
      const contextWindow = Math.min(configured.context_window || 32768, assistant.context_max_tokens || settings.context_max_tokens || Infinity);
      const mapped: any = { id: configured.model_id, name: configured.name, api: "openai-completions", baseUrl: provider.base_url, input: configured.capabilities || ["text"], reasoning: configured.supports_reasoning, contextWindow, maxTokens: Math.min(configured.max_output_tokens || 8192, Math.floor(contextWindow / 2)), cost: { input: configured.input_price_per_1m || 0, output: configured.output_price_per_1m || 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" } };
      runtime.registerProvider(`wa_model_${configured.id}`, { baseUrl: provider.base_url, apiKey: literalConfig(provider.api_key || "local"), api: "openai-completions", headers: Object.fromEntries(Object.entries(providerHeaders(provider)).map(([key, value]) => [key, literalConfig(value)])), models: [mapped] });
      return runtime.getModel(`wa_model_${configured.id}`, configured.model_id)!;
    };
    const piModel = registerModel(model);
    const budget = piModel.contextWindow;
    const state = { turns: 0, calls: 0, pending: [] as Row[], question: undefined as Row | undefined, toolRuns: [] as Row[], reasoning: "", answer: "", answerCompleted: false, lastUsage: {} as Row, stopReason: "", limitReason: "", activeModel: model, requestStarted: Date.now(), usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 } };
    const maxSteps = assistant.max_steps || settings.max_iterations;
    const maxTools = assistant.max_tool_calls || settings.max_tool_calls;
    const approvalMode = input.approval_mode || assistantConfig.default_approval_mode;
    if (approvalMode === "full_access" && !assistantConfig.allow_full_access) throw new AppError("当前助手未允许完全访问模式", 403);
    const executeContext = { identity: user, credential, sessionId, signal };
    const runTool = async (spec: ToolSpec, callId: string, args: Row, toolSignal?: AbortSignal) => {
      state.calls++;
      if (maxTools > 0 && state.calls > maxTools) return { content: [{ type: "text" as const, text: "已达到本次工具调用上限，未执行。" }], details: {}, isError: true };
      spec = (await this.registry.authorize(spec.name, executeContext)).tool;
      if (state.question) return { content: [{ type: "text" as const, text: "已有一个问题等待用户回答，本轮不再执行其他工具。" }], details: { question_required: true, blocked: true }, isError: true };
      if (spec.name === "ask_user") {
        if (!this.registry.internalEnabled("ask_user")) throw new AppError("交互问答工具已停用", 403);
        if (state.question) return { content: [{ type: "text" as const, text: "本轮已经有一个问题等待用户回答，不要重复提问。" }], details: { question_required: true, duplicate: true }, isError: true };
        const options = Array.isArray(args.options) ? args.options.slice(0, 12).map((option: Row) => ({
          label: String(option?.label || "").trim().slice(0, 120),
          value: String(option?.value || option?.label || "").trim().slice(0, 200),
          description: String(option?.description || "").trim().slice(0, 500),
        })).filter((option: Row) => option.label && option.value) : [];
        const question = String(args.question || "").trim().slice(0, 1000);
        if (!question || !options.length) throw new AppError("ask_user 需要明确问题和至少一个有效选项", 422);
        state.question = {
          question,
          description: String(args.description || "").trim().slice(0, 2000),
          options,
          selection: args.selection === "multiple" ? "multiple" : "single",
          allow_free_text: args.allow_free_text !== false,
          required: args.required !== false,
        };
        return {
          content: [{ type: "text" as const, text: "问题已交给用户，本轮立即结束。不要猜测用户选择，也不要继续调用工具；用户回答后会收到新的用户消息。" }],
          details: { question_required: true, question },
        };
      }
      if (spec.risk !== "read" && approvalMode !== "full_access") {
        state.pending.push({ tool: spec.name, call_id: callId, arguments: args, risk: spec.risk });
        return { content: [{ type: "text" as const, text: "该操作尚未执行，需要用户在审批卡明确确认。不要宣称操作成功。" }], details: { approval_required: true } };
      }
      const result = await this.registry.execute(spec, args, { ...executeContext, signal: toolSignal ? AbortSignal.any([signal, toolSignal]) : signal });
      const safeResult = redact(result);
      const text = JSON.stringify(safeResult);
      return { content: [{ type: "text" as const, text: text.length > 24000 ? `${text.slice(0, 24000)}\n[工具结果过长已截断，请缩小查询范围]` : text }], details: safeResult as any };
    };
    const bm25 = settings.bm25_enabled && (tools.length > 0 || skills.length > 0);
    const fixed = new Set(tools.filter((tool) => !this.registry.setting(tool).selectable).map((tool) => tool.name));
    const definitions: ToolDefinition[] = tools.map((spec) => ({ name: spec.name, label: spec.title, description: spec.description, parameters: spec.parameters as any, exposure: bm25 && !fixed.has(spec.name) ? "deferred" : "direct", executionMode: "sequential", execute: (callId, args, toolSignal) => runTool(spec, callId, args as Row, toolSignal) }));
    const skillRoot = this.skillLibrary.materialize(assistant.id, skills);
    const localDefinitions = this.registry.localToolDefinitions(manager.getCwd())
      .filter((tool) => tool.name !== "read" || !skillRoot);
    definitions.push(...localDefinitions);
    if (skillRoot) definitions.push(this.skillReadDefinition(skillRoot, this.store.settings().skill_files_enabled));
    const hooks: ExtensionFactory = (pi) => {
      pi.on("tool_call", (event) => {
        if (event.toolName === "read" && skillRoot) return;
        if (piLocalToolNames.includes(event.toolName) && !this.registry.localToolEnabled(event.toolName)) return { block: true, reason: piLocalToolReason, terminate: true };
        if (event.toolName === "codemode" && !this.registry.codemodeEnabled()) return { block: true, reason: "CodeMode 未由部署者和管理员双重开启", terminate: true };
        if (event.toolName === "tool_search" && !this.store.settings().bm25_enabled) return { block: true, reason: "BM25 工具发现已由管理员关闭", terminate: true };
      });
      pi.on("context", (event) => {
        if (!settings.context_max_rounds) return;
        const positions = event.messages.flatMap((message, index) => message.role === "user" ? [index] : []);
        if (positions.length <= settings.context_max_rounds) return;
        const cutoff = positions[positions.length - settings.context_max_rounds];
        const summaries = event.messages.slice(0, cutoff).filter((message) => ["compactionSummary", "branchSummary", "custom"].includes(message.role));
        return { messages: [...summaries, ...event.messages.slice(cutoff)] };
      });
      pi.on("before_provider_request", (event) => {
        const payload = event.payload as Row;
        const extra = state.activeModel.extra_params || {};
        const allowed = Object.fromEntries(Object.entries(extra).filter(([key]) => !key.startsWith("_") && !["model", "messages", "tools", "stream", "stream_options", "extra_body"].includes(key)));
        Object.assign(payload, allowed, extra.extra_body || {});
        payload.temperature = state.activeModel.temperature ?? 0.3; payload.top_p = state.activeModel.top_p ?? 1;
        const effort = input.reasoning_effort || assistantConfig.default_reasoning_effort || state.activeModel.default_reasoning_effort;
        const reasoningProtocol = extra._reasoning?.protocol || (/qwen3/i.test(state.activeModel.model_id) ? "enable_thinking" : /deepseek/i.test(state.activeModel.model_id) ? "thinking" : "effort");
        if (state.activeModel.supports_reasoning && effort) {
          if (reasoningProtocol === "enable_thinking") { payload.enable_thinking = !["off", "none"].includes(effort); delete payload.reasoning_effort; }
          else if (reasoningProtocol === "thinking") { payload.thinking = { type: ["off", "none"].includes(effort) ? "disabled" : "enabled" }; delete payload.reasoning_effort; }
          else payload.reasoning_effort = effort === "off" ? "none" : effort;
        }
        return payload;
      });
      pi.on("session_before_compact", async (event) => {
        const summaryModel = settings.compaction_model_id ? this.store.model(settings.compaction_model_id) : state.activeModel;
        if (!summaryModel?.enabled || !["chat", "vision"].includes(summaryModel.model_kind)) throw new AppError("摘要模型不可用", 422);
        const preparation = event.preparation;
        const text = serializeConversation(convertToLlm([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]));
        const result = await this.providers.complete(summaryModel, [{ role: "system", content: settings.compaction_prompt }, { role: "user", content: JSON.stringify({ previous_summary: preparation.previousSummary || "", history: text, instructions: event.customInstructions || "" }) }], "compaction", { sessionId, username: user.username, signal: event.signal, emit });
        if (!result.content.trim()) throw new AppError("摘要模型返回空内容", 502);
        return { compaction: { summary: result.content, firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore, details: { model: summaryModel.name } } };
      });
    };
    const compactionSettings = (mapped: typeof piModel) => ({ enabled: settings.context_compression, reserveTokens: Math.min(mapped.contextWindow - 512, settings.context_reserve_tokens + mapped.maxTokens), keepRecentTokens: Math.max(256, Math.floor((mapped.contextWindow - mapped.maxTokens - settings.context_reserve_tokens) * settings.compaction_keep_ratio)) });
    // PI 的图像缩放依赖 Photon WASM；当前版本在部分 Node/WASM 组合上会直接 panic，
    // 导致所有图片被替换成「无法缩放」的文字。这里关闭自动缩放，保留浏览器已校验的原图；
    // 真正的尺寸/体积限制由前端上传检查和供应商协议负责。
    const settingsManager = SettingsManager.inMemory({ compaction: compactionSettings(piModel), images: { autoResize: false }, retry: { enabled: settings.retry_enabled, maxRetries: Math.max(0, settings.retry_max_attempts - 1), baseDelayMs: settings.retry_initial_backoff_ms, maxAgentDelayMs: settings.retry_max_backoff_ms, provider: { maxRetries: 0, timeoutMs: this.providers.connection(model.provider_id).timeout_seconds * 1000 } } });
    const memories = settings.memory_enabled && assistant.memory_enabled ? this.store.all("SELECT content FROM memories WHERE owner_key=? AND enabled=1 ORDER BY updated_at DESC LIMIT 30", [user.owner_key]) : [];
    const systemPrompt = [settings.base_system_prompt, assistant.system_prompt, settings.system_prompt_extra, memories.length ? `用户已确认的长期记忆：\n${memories.map((item) => item.content).join("\n")}` : ""].filter(Boolean).join("\n\n");
    const extensionFactories: ExtensionFactory[] = [hooks, ...(bm25 ? [createToolSearchExtension()] : [])];
    if (this.registry.codemodeEnabled()) extensionFactories.push(createCodemodeExtension() as ExtensionFactory);
    const loader = new DefaultResourceLoader({
      cwd: manager.getCwd(),
      agentDir: path.join(storagePaths(this.store.dataDir).runtime, "isolated-pi"),
      settingsManager,
      noExtensions: true,
      disabledBuiltinExtensions: ["mcp", "codemode", "tool-search"],
      // Always isolate skills: only the assistant's materialized skill directory may be loaded.
      // Without this, PI also scans the host's global skill directories (e.g. ~/.agents/skills),
      // injecting tens of kilobytes into every system prompt.
      noSkills: true,
      additionalSkillPaths: skillRoot ? [skillRoot] : [],
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt,
      extensionFactories,
    });
    await loader.reload();
    const leakedSkills = loader.getSkills().skills.filter((skill) => !skillRoot || !skill.filePath.startsWith(`${skillRoot}${path.sep}`));
    if (leakedSkills.length) throw new AppError(`Skill 加载越界：${leakedSkills[0].filePath}`, 500);
    const activeNames = [...definitions.filter((tool) => tool.exposure !== "deferred").map((tool) => tool.name), ...(bm25 ? ["tool_search"] : []), ...(this.registry.codemodeEnabled() ? ["codemode"] : [])];
    const effort = input.reasoning_effort || assistantConfig.default_reasoning_effort || model.default_reasoning_effort || "off";
    const { session, extensionsResult } = await createAgentSession({ cwd: manager.getCwd(), agentDir: path.join(storagePaths(this.store.dataDir).runtime, "isolated-pi"), modelRuntime: runtime, model: piModel, thinkingLevel: (effort === "none" ? "off" : effort) as any, sessionManager: manager, settingsManager, resourceLoader: loader, noTools: "builtin", tools: bm25 ? [...activeNames, ...tools.map((tool) => tool.name)] : activeNames, customTools: definitions });
    if (extensionsResult.errors.length) { session.dispose(); throw new AppError("PI 扩展加载失败：" + extensionsResult.errors.map((error) => error.error).join("；"), 500); }
    session.setActiveToolsByName(activeNames);
    const finishTurn = session.agent.finishTurn;
    session.agent.finishTurn = async (turn, turnSignal) => {
      const previous = await finishTurn?.(turn, turnSignal);
      if (state.question || state.pending.length) return { action: "end" };
      if (maxSteps > 0 && state.turns >= maxSteps || maxTools > 0 && state.calls >= maxTools) {
        if (turn.toolResults.length || previous?.action === "continue") state.limitReason = maxTools > 0 && state.calls >= maxTools ? "max_tool_calls" : "max_steps";
        return { action: "end" };
      }
      return previous || undefined;
    };
    session.subscribe((event: any) => {
      if (event.type === "turn_start") { state.turns++; state.requestStarted = Date.now(); emit("step.started", { step: state.turns, max_steps: maxSteps, model: state.activeModel.name }); }
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") { state.answer += update.delta; emit("text.delta", { delta: update.delta }); }
        if (update.type === "thinking_delta") { state.reasoning += update.delta; emit("thinking.delta", { delta: update.delta }); }
        if (update.type === "toolcall_delta" || update.type === "toolcall_start") { const call = update.partial?.content?.[update.contentIndex]; if (call?.name) emit("tool.args.delta", { tool: call.name, call_id: call.id }); }
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        state.stopReason = event.message.stopReason;
        const usage = this.providers.record(state.activeModel, "chat", { input_tokens: (event.message.usage?.input || 0) + (event.message.usage?.cacheRead || 0) + (event.message.usage?.cacheWrite || 0), output_tokens: event.message.usage?.output || 0 }, sessionId, user.username, Date.now() - state.requestStarted, event.message.stopReason === "error" ? "error" : event.message.stopReason === "aborted" ? "cancelled" : "ok", event.message.errorMessage || "");
        for (const key of Object.keys(state.usage)) state.usage[key] += usage[key] || 0;
        state.lastUsage = usage; emit("usage", { usage: state.usage });
        this.store.update("sessions", sessionId, { last_context_tokens: usage.prompt_tokens });
      }
      if (event.type === "agent_end" && !state.answerCompleted && ["stop", "end_turn"].includes(state.stopReason) && state.answer.trim() && !state.pending.length && !state.question) {
        // agent_end is the point where the whole agent loop is finished but PI may still run
        // automatic compaction inside session.prompt(). Release the answer for display now;
        // the run stays busy until run.completed, so the next user turn is still blocked.
        state.answerCompleted = true;
        emit("answer.completed", { usage: { ...state.usage, model: state.activeModel.name }, context: { context_tokens: state.lastUsage.prompt_tokens || estimate(manager.buildSessionContext().messages), context_window: session.model?.contextWindow || budget }, status: "ok" });
      }
      if (event.type === "tool_execution_start") { state.toolRuns.push({ tool: event.toolName, call_id: event.toolCallId, arguments: redact(event.args), status: "running" }); emit("tool.started", { tool: event.toolName, call_id: event.toolCallId, arguments: redact(event.args) }); }
      if (event.type === "tool_execution_end") { const run = state.toolRuns.find((item) => item.call_id === event.toolCallId); const result = redact(event.result?.details ?? event.result?.content); if (run) Object.assign(run, { result, status: event.isError ? "failed" : "ok" }); emit("tool.finished", { tool: event.toolName, call_id: event.toolCallId, result, status: event.isError ? "failed" : "ok", summary: event.isError ? "工具执行失败" : "工具已返回" }); }
      if (event.type === "auto_retry_start") emit("retry", { attempt: event.attempt, delay_ms: event.delayMs, message: "供应商请求异常，PI 正在退避重试" });
      if (event.type === "compaction_start") emit("run.phase", { phase: "compaction", title: "正在整理上下文", description: "保留原始聊天记录，生成模型下一次请求使用的摘要" });
      if (event.type === "compaction_end") {
        const afterTokens = event.result ? estimate(manager.buildSessionContext().messages) : 0;
        this.store.insert("compaction_events", { session_id: sessionId, trigger: event.reason, before_tokens: event.result?.tokensBefore || 0, after_tokens: afterTokens, summary_model: settings.compaction_model_id ? this.store.model(settings.compaction_model_id)?.name || "" : model.name, ok: Boolean(event.result), error: event.errorMessage || "" });
        if (event.result) this.store.run("UPDATE sessions SET summary=?,last_compacted_at=?,compaction_count=compaction_count+1 WHERE id=?", [event.result.summary, now(), sessionId]);
        emit("run.phase", {
          phase: "compaction_done",
          title: event.result ? "上下文已压缩" : "上下文压缩未完成",
          description: event.result ? "历史聊天记录仍保留，仅替换模型下一次请求使用的上下文摘要" : event.errorMessage || "压缩失败，已保留原上下文",
          ok: Boolean(event.result),
          ...(event.result ? { context: { context_tokens: afterTokens } } : {}),
          compaction: { before_tokens: event.result?.tokensBefore || 0, after_tokens: afterTokens }
        });
      }
      if (event.type === "entry_appended") this.save(manager, sessionId);
    });
    return { session, manager, state, registerModel, runtime, budget, approvalMode, settingsManager, compactionSettings };
  }
  async run(credential: string, input: ChatInput, signal: AbortSignal, emit: Emit, continuation?: { text: string }, presetUser?: Identity) {
    const user = presetUser || await this.auth.identity(credential);
    signal.throwIfAborted();
    const settings = this.store.settings();
    const current = input.session_id ? this.store.ownedSession(input.session_id, user) : this.createSession(user, input);
    const assistant = this.assistant(user, input.assistant_id || current.assistant_id);
    const selectedId = !assistant.allow_model_switch && assistant.model_row_id ? assistant.model_row_id : input.model_row_id || assistant.model_row_id || current.last_model_id;
    const model = selectedId ? this.store.model(selectedId) : this.store.defaultModel();
    if (!model?.enabled || !model.provider_enabled || !["chat", "vision"].includes(model.model_kind)) throw new AppError("没有可用对话模型；请管理员先配置，系统不会伪造回复", 422);
    this.providers.connection(model.provider_id);
    const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const used = this.store.one("SELECT coalesce(sum(lc.total_tokens),0) AS n FROM llm_calls lc JOIN sessions s ON s.id=lc.session_id WHERE s.owner_key=? AND lc.created_at>=?", [user.owner_key, dayStart])!.n;
    if (settings.user_daily_token_limit && used >= settings.user_daily_token_limit) throw new AppError("已达到今日模型用量限额", 429);
    if (user.daily_token_limit && used >= user.daily_token_limit) throw new AppError("已达到当前接入 Token 的今日用量限额", 429);
    const text = continuation?.text || input.message?.trim() || [...input.messages || []].reverse().find((item) => item.role === "user")?.content;
    if (!text || text.length > 20000) throw new AppError("消息不能为空且不能超过 20000 字符", 422);
    const attachments = input.attachments || [];
    if (attachments.length && !model.capabilities.includes("image")) throw new AppError("当前模型不支持图片", 422);
    validateAttachments(attachments);
    if (!continuation && input.session_id) this.supersedeQuestions(current.id);
    let tools = await this.registry.permitted(user, assistant, input.enabled_tools);
    let skills = settings.skills_enabled ? this.skillLibrary.activeForAssistant(assistant) : [];
    if (!model.supports_tools) { tools = []; skills = []; }
    if (settings.decision_enabled) {
      const fixedTools = tools.filter((tool) => !this.registry.setting(tool).selectable).map((tool) => tool.name);
      ({ tools, skills } = await this.decision.select(tools, skills, text, user, current.id, signal, emit, fixedTools));
    }
    this.store.update("sessions", current.id, { assistant_id: assistant.id, last_model_id: model.id, last_model_name: model.name, last_status: "running", last_error: "" });
    const built = await this.build(model, assistant, user, credential, current.id, tools, skills, input, signal, emit);
    const { session, manager, state } = built;
    // 模型构建成功后再落盘，避免构建失败在上传目录留下垃圾；会话 JSON 只记录相对路径。
    const savedAttachments = attachments.length ? saveAttachments(this.store.dataDir, current.id, attachments) : [];
    if (!continuation) this.store.conversations.insert(current.id, { role: "user", content: text, attachments: savedAttachments, token_estimate: estimate(text) });
    const started = Date.now();
    const timer = setTimeout(() => { state.stopReason = "timeout"; void session.abort(); }, (assistant.max_run_seconds || settings.max_run_seconds || 120) * 1000);
    const onAbort = () => void session.abort(); signal.addEventListener("abort", onAbort, { once: true });
    try {
      signal.throwIfAborted();
      const images = savedAttachments.flatMap((item) => { const dataUrl = attachmentDataUrl(this.store.dataDir, current.id, item); if (!dataUrl) throw new AppError("图片附件丢失，请重新上传", 422); return [{ type: "image" as const, mimeType: item.mime_type, data: dataUrl.split(",")[1] }]; });
      await session.prompt(text, { expandPromptTemplates: false, images });
      if (state.stopReason === "error" && !state.calls && !state.answer && settings.fallback_model_id && settings.fallback_model_id !== model.id) {
        const fallback = this.store.model(settings.fallback_model_id);
        if (fallback?.enabled && ["chat", "vision"].includes(fallback.model_kind) && (!attachments.length || fallback.capabilities.includes("image"))) {
          emit("model.fallback", { to: fallback.name }); state.activeModel = fallback;
          const fallbackPiModel = built.registerModel(fallback);
          built.settingsManager.applyOverrides({ compaction: built.compactionSettings(fallbackPiModel), retry: { provider: { maxRetries: 0, timeoutMs: this.providers.connection(fallback.provider_id).timeout_seconds * 1000 } } });
          await session.setModel(fallbackPiModel);
          this.store.update("sessions", current.id, { last_model_id: fallback.id, last_model_name: fallback.name });
          await session.prompt("请继续处理上一个用户请求。", { expandPromptTemplates: false });
        }
      }
      let question: Row | undefined;
      if (state.question) {
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
        this.supersedeQuestions(current.id);
        this.store.insert("questions", { id, ...this.store.ownerColumns(user), session_id: current.id, data: encrypt(JSON.stringify(state.question)), expires_at: expiresAt });
        question = { id, ...state.question, expires_at: expiresAt };
        emit("question.required", { question });
      }
      let approval: Row | undefined;
      if (state.pending.length && !question) {
        const id = randomUUID();
        this.store.insert("approvals_v2", { id, ...this.store.ownerColumns(user), session_id: current.id, data: { sealed: encrypt(JSON.stringify({ calls: state.pending, input: { ...input, session_id: current.id, attachments: [] } })) }, expires_at: new Date(Date.now() + 3600000).toISOString() });
        approval = { id, tool: state.pending.map((item) => item.tool).join("、"), summary: `确认后执行 ${state.pending.length} 项操作；仍使用当前业务权限。`, arguments: redact(state.pending), risk: state.pending.some((item) => item.risk === "delete") ? "delete" : "write" };
        emit("tool.approval_required", approval);
      }
      if (!state.answer && approval) state.answer = "操作尚未执行，请确认下方审批卡。";
      if (!state.answer && question) state.answer = "我需要你补充一个信息后继续。";
      if (["error", "timeout"].includes(state.stopReason) && !state.answer) throw new AppError(state.stopReason === "timeout" ? "运行达到时间上限" : "模型请求失败，请在管理端查看调用记录", 502);
      const status = signal.aborted || state.stopReason === "aborted" ? "cancelled" : ["error", "timeout"].includes(state.stopReason) ? "error" : question ? "question_required" : approval ? "approval_required" : state.limitReason ? "limited" : "ok";
      if (status === "limited") {
        const notice = `${state.answer ? "\n\n" : ""}已达到本次${state.limitReason === "max_steps" ? "推理轮次" : "工具调用"}上限，已停止继续执行。已执行的工具结果保留在过程中；如需继续，请发送下一条消息。`;
        state.answer += notice; emit("text.delta", { delta: notice });
      }
      const elapsedMs = Date.now() - started;
      const result: Row = { status, session_id: current.id, answer: state.answer, usage: { ...state.usage, latency_ms: elapsedMs, model: state.activeModel.name }, context: { context_tokens: state.lastUsage.prompt_tokens || estimate(manager.buildSessionContext().messages), context_window: session.model?.contextWindow || built.budget }, run: { elapsed_seconds: elapsedMs / 1000, steps: state.turns, tool_calls: state.calls, runtime: "pi", stop_reason: state.limitReason || state.stopReason }, tool_runs: state.toolRuns, approval, question, model: state.activeModel.name, approval_mode: built.approvalMode, enabled_tools: tools.map((tool) => tool.name) };
      const storeReasoning = this.store.settings().store_reasoning;
      this.store.conversations.insert(current.id, { role: "assistant", content: state.answer, reasoning: storeReasoning ? state.reasoning : "", tool_runs: state.toolRuns, metadata: { status, usage: result.usage, context: result.context, run: result.run, approval, question, reasoning: { had_reasoning: Boolean(state.reasoning), stored: storeReasoning } }, token_estimate: estimate(state.answer) });
      this.store.run("UPDATE sessions SET tool_calls=tool_calls+?,tool_failures=tool_failures+?,last_status=?,updated_at=? WHERE id=?", [state.calls, state.toolRuns.filter((item) => item.status === "failed").length, status, now(), current.id]);
      if (!continuation && ["新对话", ""].includes(current.title)) {
        const titleModel = settings.title_model_id ? this.store.model(settings.title_model_id) : state.activeModel;
        const fallbackTitle = text.replace(/\s+/g, " ").slice(0, 30);
        this.store.update("sessions", current.id, { title: fallbackTitle }); emit("session.title", { title: fallbackTitle });
        if (titleModel?.enabled) this.defer(async (backgroundSignal) => { const response = await this.providers.complete(titleModel, [{ role: "system", content: this.store.settings().title_prompt }, { role: "user", content: text.slice(0, 500) }], "title", { sessionId: current.id, username: user.username, signal: backgroundSignal }); const title = response.content.trim().slice(0, 60); if (title && this.store.one("SELECT title FROM sessions WHERE id=?", [current.id])?.title === fallbackTitle) this.store.update("sessions", current.id, { title }); });
      }
      if (settings.memory_auto_extract && settings.memory_enabled && assistant.memory_enabled && status === "ok") this.defer((backgroundSignal) => this.extractMemory(user, current.id, text, backgroundSignal));
      return result;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); this.save(manager, current.id); session.dispose(); }
  }
  async compact(user: Identity, credential: string, sessionId: string, modelId?: number) {
    const current = this.store.ownedSession(sessionId, user); this.store.assertIdle(sessionId);
    const assistant = this.assistant(user, current.assistant_id);
    const selectedId = !assistant.allow_model_switch && assistant.model_row_id ? assistant.model_row_id : modelId || current.last_model_id || assistant.model_row_id;
    const model = this.store.model(selectedId) || this.store.defaultModel();
    if (!model?.enabled || !model.provider_enabled || !["chat", "vision"].includes(model.model_kind)) throw new AppError("没有可用于压缩的对话模型", 422);
    const built = await this.build(model, assistant, user, credential, sessionId, [], [], {}, AbortSignal.timeout(90000), () => {});
    try {
      const result = await built.session.compact();
      this.save(built.manager, sessionId);
      return { ok: true, summary: result.summary, context_tokens: estimate(built.manager.buildSessionContext().messages), session: this.store.ownedSession(sessionId, user) };
    } catch (error) {
      // 手动压缩是幂等操作：会话太短或已经压缩过都不应显示成服务端错误。
      if (error instanceof Error && /nothing to compact/i.test(error.message)) {
        return { ok: true, skipped: true, message: "当前会话内容较少，无需压缩", context_tokens: current.last_context_tokens || 0, session: this.store.ownedSession(sessionId, user) };
      }
      if (error instanceof Error && /already compacted/i.test(error.message)) {
        return { ok: true, skipped: true, message: "当前上下文已压缩，无需重复操作", context_tokens: current.last_context_tokens || 0, session: this.store.ownedSession(sessionId, user) };
      }
      throw error;
    } finally { built.session.dispose(); }
  }
  approvalSession(user: Identity, id: string) {
    const approval = this.store.one("SELECT * FROM approvals_v2 WHERE id=? AND owner_key=?", [id, user.owner_key]);
    if (!approval) throw new AppError("审批不存在", 404);
    if (approval.status !== "pending" || approval.expires_at < now()) throw new AppError("审批已处理或过期", 409);
    return this.store.ownedSession(approval.session_id, user);
  }
  questionSession(user: Identity, id: string) {
    const question = this.store.one("SELECT * FROM questions WHERE id=? AND owner_key=?", [id, user.owner_key]);
    if (!question) throw new AppError("问题不存在", 404);
    if (question.status !== "pending" || question.expires_at < now()) throw new AppError("问题已回答、取消或过期", 409);
    return { question, session: this.store.ownedSession(question.session_id, user), data: JSON.parse(decrypt(question.data)) as Row };
  }
  validateAnswer(user: Identity, id: string, input: Row) {
    const current = this.questionSession(user, id);
    const { data } = current;
    const cancelled = Boolean(input.cancel);
    const selected = Array.isArray(input.values) ? input.values.map((value: unknown) => String(value)) : [];
    const freeText = String(input.free_text || "").trim().slice(0, 4000);
    const valid = new Set((data.options || []).map((option: Row) => String(option.value)));
    if (!cancelled) {
      if (selected.some((value: string) => !valid.has(value))) throw new AppError("回答包含无效选项", 422);
      if (data.selection === "single" && selected.length > 1) throw new AppError("该问题只能选择一个选项", 422);
      if (!selected.length && !freeText) throw new AppError("请选择一个选项或填写补充内容", 422);
      if (freeText && data.allow_free_text === false) throw new AppError("该问题不允许自由文本回答", 422);
    }
    return { ...current, cancelled, selected, freeText };
  }
  async answerQuestion(user: Identity, credential: string, id: string, input: Row, signal: AbortSignal, emit: Emit, runId = "") {
    const { question, session, data, cancelled, selected, freeText } = this.validateAnswer(user, id, input);
    const status = cancelled ? "cancelled" : "answered";
    const changed = this.store.run("UPDATE questions SET status=?,answered_at=? WHERE id=? AND status='pending'", [status, now(), id]);
    if (!changed.changes) throw new AppError("问题已被回答、取消或过期", 409);
    const message = this.store.conversations.latestAssistant(question.session_id, (item) => item.metadata?.question?.id === id);
    if (message) this.store.conversations.update(question.session_id, Number(message.id), { metadata: { ...message.metadata, question_status: status, question_answer: cancelled ? undefined : { values: selected, free_text: freeText } } });
    if (cancelled) {
      this.store.conversations.insert(question.session_id, { role: "user", content: "已取消本次补充信息。", metadata: { question_cancelled: id }, token_estimate: 8 });
      this.store.run("UPDATE sessions SET updated_at=? WHERE id=?", [now(), question.session_id]);
      return { ok: true, status: "cancelled", session_id: question.session_id };
    }
    const labels = selected.map((value: string) => (data.options as Row[]).find((option) => String(option.value) === value)?.label || value);
    const answerText = [labels.length ? `选择：${labels.join("、")}` : "", freeText ? `补充：${freeText}` : ""].filter(Boolean).join("\n");
    if (!answerText) throw new AppError("请选择一个选项或填写补充内容", 422);
    this.store.conversations.insert(question.session_id, { role: "user", content: `回答：\n${answerText}`, metadata: { question_answer: { question_id: id, values: selected, free_text: freeText } }, token_estimate: estimate(answerText) });
    this.store.run("UPDATE sessions SET updated_at=? WHERE id=?", [now(), question.session_id]);
    return await this.run(credential, { session_id: question.session_id, assistant_id: session.assistant_id }, signal, emit, {
      text: `用户已回答上一轮问题。\n问题：${data.question}\n${answerText}\n请基于这个真实回答继续原任务。不要再次询问同一个问题；如果还需要其他信息，可以再调用 ask_user。`,
    }, user);
  }
  async approve(user: Identity, credential: string, id: string, accepted: boolean, signal: AbortSignal, emit: Emit, runId = "") {
    const row = this.store.one("SELECT * FROM approvals_v2 WHERE id=? AND owner_key=?", [id, user.owner_key]);
    if (!row) throw new AppError("审批不存在", 404);
    if (row.status !== "pending" || row.expires_at < now()) throw new AppError("审批已处理或过期", 409);
    this.store.assertIdle(row.session_id, runId);
    const changed = this.store.run("UPDATE approvals_v2 SET status=? WHERE id=? AND status='pending'", [accepted ? "executing" : "rejected", id]);
    if (!changed.changes) throw new AppError("审批已被处理", 409);
    const message = this.store.conversations.latestAssistant(row.session_id, (item) => item.metadata?.approval?.id === id);
    if (message) this.store.conversations.update(row.session_id, Number(message.id), { metadata: { ...message.metadata, approval_status: accepted ? "approved" : "rejected" } });
    if (!accepted) { this.store.run("UPDATE sessions SET approval_rejections=approval_rejections+1 WHERE id=?", [row.session_id]); return { ok: true, status: "rejected" }; }
    const data = JSON.parse(decrypt(row.data.sealed));
    const current = this.store.ownedSession(row.session_id, user);
    const assistant = this.assistant(user, current.assistant_id);
    const permitted = await this.registry.permitted(user, assistant, data.input.enabled_tools);
    const results: Row[] = [];
    try {
      for (const call of data.calls) {
        signal.throwIfAborted();
        const tool = permitted.find((item) => item.name === call.tool);
        if (!tool) throw new AppError("当前权限或工具配置已变化，审批不能继续", 403);
        emit("tool.started", { tool: tool.name, call_id: call.call_id, arguments: redact(call.arguments) });
        const result = redact(await this.registry.execute(tool, call.arguments, { identity: user, credential, sessionId: row.session_id, signal }));
        results.push({ tool: tool.name, result });
        this.store.audit(user.username, "approval.tool_completed", id, { tool: tool.name });
        emit("tool.finished", { tool: tool.name, call_id: call.call_id, result, status: "ok", summary: "已确认的操作执行完成" });
      }
      this.store.run("UPDATE approvals_v2 SET status='approved' WHERE id=?", [id]);
      return await this.run(credential, { ...data.input, message: undefined }, signal, emit, { text: `用户已经在审批卡确认，以下操作已由服务器实际执行完成。不要重复执行，根据真实结果回复：\n${JSON.stringify(results)}` }, user);
    } catch (error) { this.store.run("UPDATE approvals_v2 SET status='failed' WHERE id=?", [id]); this.store.audit(user.username, "approval.failed", id, { completed: results.map((result) => result.tool) }); this.store.conversations.insert(row.session_id, { role: "assistant", content: `确认后的操作未全部完成；已成功执行 ${results.length} 项。请核对真实业务状态，不要直接重复提交。`, tool_runs: results.map((item) => ({ ...item, status: "ok" })), metadata: { status: "error" } }); throw error; }
  }
  private async extractMemory(user: Identity, sessionId: string, text: string, signal: AbortSignal) {
    const settings = this.store.settings();
    const model = this.store.model(settings.memory_model_id || settings.compaction_model_id) || this.store.defaultModel(); if (!model) return;
    try {
      const existing = this.store.all("SELECT id,content FROM memories WHERE owner_key=? ORDER BY updated_at DESC LIMIT 40", [user.owner_key]);
      const history = this.store.conversations.messages(sessionId).slice(-12)
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => `${message.role === "user" ? "用户" : "助手"}：${String(message.content || "").replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n");
      const payload = JSON.stringify({ existing_memories: existing.map((item) => item.content), recent_conversation: history, latest_user_message: text.slice(0, 1200) });
      const result = await this.providers.complete(model, [{ role: "system", content: settings.memory_extraction_prompt }, { role: "user", content: payload }], "memory", { sessionId, username: user.username, signal });
      const memories = JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (!Array.isArray(memories)) return;
      const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const known = new Set(existing.map((item) => normalized(String(item.content))));
      for (const item of memories.slice(0, 5)) {
        if (typeof item !== "string") continue;
        const content = item.replace(/\s+/g, " ").trim();
        if (!content || content.length > 1000 || known.has(normalized(content))) continue;
        known.add(normalized(content));
        this.store.insert("memories", { ...this.store.ownerColumns(user), content, kind: "extracted", enabled: settings.memory_auto_confirm });
      }
    } catch { /* 记忆提取失败不影响会话 */ }
  }
}
