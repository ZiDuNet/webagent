import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { safeUrl, mask } from "./security.js";
import { AppError, type Emit, type Row } from "./types.js";
import { Store, now } from "./store.js";
import { storagePaths } from "./storage-paths.js";

export const kinds = ["chat", "vision", "asr", "asr_realtime", "tts", "tts_realtime", "image_generation", "decision", "embedding", "rerank"] as const;
export const classifyModel = (id: string) => /decision|systemone|typesafe\/jev|laya/i.test(id) ? "decision" : /tts|text-to-speech/i.test(id) ? (/real.?time/i.test(id) ? "tts_realtime" : "tts") : /asr|whisper|transcrib|speech-to-text|\bstt\b/i.test(id) ? (/real.?time/i.test(id) ? "asr_realtime" : "asr") : /rerank/i.test(id) ? "rerank" : /embed|bge-|gte-/i.test(id) ? "embedding" : /dall-e|gpt-image|image-generation|imagen|flux|seedream/i.test(id) ? "image_generation" : /vision|[-/]vl|gpt-4o|gpt-4\.1|gpt-5|gemini|claude/i.test(id) ? "vision" : "chat";
export const requiresKey = (provider: Row) => !["127.0.0.1", "localhost", "[::1]"].includes(safeUrl(provider.base_url).hostname);
export function providerHeaders(provider: Row) {
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const [key, value] of Object.entries(provider.extra_headers || {})) {
    if (["authorization", "cookie", "host", "content-length", "proxy-authorization", "x-internal-token"].includes(key.toLowerCase()) || /[\r\n:]/.test(key) || /[\r\n]/.test(String(value))) throw new AppError("自定义请求头包含保留字段或换行", 422);
    headers[key] = String(value);
  }
  if (provider.api_key) headers.Authorization = `Bearer ${provider.api_key}`;
  return headers;
}
export function publicProvider(provider: Row): Row {
  const { api_key, ...rest } = provider;
  return { ...rest, api_key_set: Boolean(api_key), api_key_masked: mask(api_key), requires_key: requiresKey(provider) };
}
export function sameOriginEndpoint(provider: Row, endpoint: string, fallback: string) {
  const base = safeUrl(provider.base_url);
  const target = safeUrl(endpoint || fallback, `${base.href.replace(/\/$/, "")}/`);
  if (target.origin !== base.origin || target.search) throw new AppError("端点必须与供应商地址同源且不含查询参数", 422);
  return target.href;
}
export async function limitedResponse(response: Response, maximum = 8 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > maximum) { await response.body?.cancel(); throw new AppError("远端响应超过大小限制", 502); }
  const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0);
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > maximum) throw new AppError("远端响应超过大小限制", 502); chunks.push(item.value); } } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function requestJson(url: string, options: RequestInit = {}, maximum = 8 * 1024 * 1024): Promise<Row> {
  let response: Response;
  let raw: Buffer;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(12000) });
    raw = await limitedResponse(response, maximum);
  } catch (failure) {
    if (failure instanceof AppError) throw failure;
    const error = failure as { name?: string; code?: unknown; cause?: { code?: unknown; name?: string } };
    const code = String(error?.cause?.code || error?.code || "");
    const timeout = error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError" || /TIMEOUT|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(code);
    if (timeout) throw new AppError("远端响应超时，请检查网络、代理或稍后重试", 504);
    if (options.signal?.aborted) throw new AppError("请求已取消", 499);
    throw new AppError(`连接远端失败${code ? `（${code}）` : ""}，请检查网络或供应商地址`, 502);
  }
  let payload: Row;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new AppError(`远端返回非 JSON 数据（HTTP ${response.status}）`, 502); }
  if (!response.ok || payload.success === false) {
    const error = new AppError(`远端 HTTP ${response.status}：${String(payload.error?.message || payload.message || payload.detail || "请求失败").slice(0, 350)}`, response.status >= 500 ? 502 : 400) as AppError & { retryAfterMs?: number };
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }
  return payload;
}
const definitions: [string, string, string, string[], string[]][] = [
  ["openai", "OpenAI", "https://api.openai.com/v1", ["chat", "voice", "image", "retrieval"], ["gpt-4.1-mini", "gpt-4o-mini-transcribe", "gpt-4o-mini-tts", "gpt-image-1", "text-embedding-3-small"]],
  ["deepseek", "DeepSeek", "https://api.deepseek.com/v1", ["chat"], ["deepseek-chat", "deepseek-reasoner"]],
  ["dashscope", "通义千问 / 百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1", ["chat", "voice", "decision", "retrieval"], ["qwen-plus", "qwen-flash", "qwen3-asr-flash", "qwen3-asr-flash-realtime", "qwen3-tts-flash", "decision-model-preview", "text-embedding-v4", "gte-rerank-v2"]],
  ["zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", ["chat"], ["glm-4.5-flash"]],
  ["moonshot", "Moonshot / Kimi", "https://api.moonshot.cn/v1", ["chat"], ["moonshot-v1-32k"]],
  ["minimax", "MiniMax", "https://api.minimax.io/v1", ["chat"], []],
  ["doubao", "火山方舟 / 豆包", "https://ark.cn-beijing.volces.com/api/v3", ["chat", "image"], []],
  ["siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", ["chat", "voice", "image", "retrieval"], ["BAAI/bge-m3", "BAAI/bge-reranker-v2-m3"]],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", ["chat", "decision"], ["typesafe/jev-1.13", "microsoft/microsoft-decision-1"]],
  ["ollama", "Ollama", "http://127.0.0.1:11434/v1", ["chat"], []],
  ["lmstudio", "LM Studio", "http://127.0.0.1:1234/v1", ["chat"], []],
  ["custom", "自定义供应商", "", ["chat", "voice", "image", "decision", "retrieval"], []],
];
export const presets = definitions.map(([id, name, base_url, categories, models]) => ({ id, name, base_url, categories, local: ["ollama", "lmstudio"].includes(id), requires_key: !["ollama", "lmstudio"].includes(id), description: "可创建多个独立连接；模型 ID 和可用能力以实际账号权限为准。", models: models.map((modelId) => ({ id: modelId, name: modelId, kind: classifyModel(modelId) })) }));

export class Providers {
  private discoveryInflight = new Map<string, Promise<Row[]>>();
  private catalogue: Row | undefined;
  private catalogueFetchedAt = 0;
  private catalogueInflight: Promise<Row | undefined> | undefined;
  private catalogueError = "";
  private catalogueSource = "";
  private readonly abort = new AbortController();
  constructor(private store: Store) {}
  /** 关闭时中断后台 models.dev 拉取，避免进程退出被网络请求拖住。 */
  close() { this.abort.abort(); }
  connection(id: number) { const provider = this.store.provider(id); if (!provider) throw new AppError("供应商不存在", 404); if (!provider.enabled) throw new AppError("供应商已停用", 422); if (requiresKey(provider) && !provider.api_key) throw new AppError("供应商未配置 API Key", 422); return provider; }
  private get cataloguePath() { return path.join(storagePaths(this.store.dataDir).cache, "models-dev.json"); }
  private get legacyCataloguePath() { return path.join(storagePaths(this.store.dataDir).legacy, "models_dev_cache.json"); }
  private get catalogueTtlMs() { return Math.max(1, Number(this.store.settings().modelsdev_cache_hours || 168)) * 3600000; }
  private normalizeModelId(value: string) {
    return value.trim().toLowerCase()
      .replace(/^[a-z0-9_.-]+\//, "")
      .replace(/:(free|thinking|nitro|online|extended|beta|preview|latest)$/, "");
  }
  private stripSnapshot(value: string) {
    return value.replace(/[-_](v?\d{4}-\d{2}-\d{2}|\d{8}|v\d+(?:\.\d+)*)$/, "");
  }
  private variantMismatch(a: string, b: string) {
    const variants = new Set(["mini", "nano", "flash", "plus", "max", "pro", "turbo", "ultra", "lite", "air", "thinking", "reasoner", "coder", "instruct", "omni", "vision", "realtime"]);
    const tokens = (value: string) => new Set(value.split(/[-_.]/).filter((token) => variants.has(token)));
    const left = tokens(a); const right = tokens(b);
    return [...left].some((token) => !right.has(token)) || [...right].some((token) => !left.has(token));
  }
  private matchScore(query: string, id: string, name: string) {
    const q = this.normalizeModelId(query); const modelId = this.normalizeModelId(id); const modelName = this.normalizeModelId(name);
    const shortId = modelId.split(/[/:]/).pop() || modelId;
    const compact = (value: string) => value.replace(/[^a-z0-9]+/g, "");
    if (modelId === q) return 1000;
    if (shortId === q) return 980;
    const qBase = this.stripSnapshot(q); const idBase = this.stripSnapshot(modelId); const shortBase = this.stripSnapshot(shortId);
    if (idBase === qBase || shortBase === qBase) return this.variantMismatch(qBase, idBase) ? 0 : 930;
    if (modelName === q) return 900;
    if (compact(modelId) === compact(q)) return 870;
    if (compact(modelName) === compact(q)) return 850;
    if (this.variantMismatch(qBase, idBase)) return 0;
    if (q.length >= 8 && (modelId.startsWith(`${q}-`) || modelId.endsWith(`-${q}`))) return 780;
    if (modelName.includes(q) && q.length > 2) return 650;
    if (modelId.includes(q) && q.length > 3) return 600;
    if (q.includes(modelId) && modelId.length > 4) return 560;
    const qTokens = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
    const idTokens = new Set(modelId.split(/[^a-z0-9]+/).filter(Boolean));
    if (qTokens.size && idTokens.size) {
      let overlap = 0; for (const token of qTokens) if (idTokens.has(token)) overlap++;
      const ratio = overlap / Math.max(qTokens.size, idTokens.size);
      if (ratio >= 0.8) return Math.round(300 + ratio * 120);
    }
    return 0;
  }
  async catalogueStatus() {
    await this.readCatalogue();
    const stat = await fs.stat(this.cataloguePath).catch(() => undefined);
    const legacyStat = await fs.stat(this.legacyCataloguePath).catch(() => undefined);
    const fetchedAt = this.catalogueFetchedAt || (stat?.mtimeMs ?? legacyStat?.mtimeMs ?? 0);
    return { cached: Boolean(this.catalogue || stat || legacyStat), source: this.catalogueSource || (stat ? "models-dev.json" : legacyStat ? "legacy-cache" : ""), models: this.catalogue ? Object.values(this.catalogue).reduce((total, provider: any) => total + Object.keys(provider?.models || {}).length, 0) : 0, fetched_at: fetchedAt ? new Date(fetchedAt).toISOString() : null, age_hours: fetchedAt ? Math.max(0, (Date.now() - fetchedAt) / 3600000) : null, ttl_hours: this.catalogueTtlMs / 3600000, stale: !fetchedAt || Date.now() - fetchedAt > this.catalogueTtlMs, last_error: this.catalogueError };
  }
  private async readCatalogue() {
    if (this.catalogue) return this.catalogue;
    for (const file of [this.cataloguePath, this.legacyCataloguePath]) {
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        const catalogue = parsed?.catalogue ?? parsed?.data ?? parsed;
        if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue)) continue;
        const fetchedAt = parsed?.fetched_at ? Date.parse(parsed.fetched_at) : parsed?._fetched_at ? Number(parsed._fetched_at) * 1000 : (await fs.stat(file)).mtimeMs;
        this.catalogue = catalogue;
        this.catalogueFetchedAt = Number.isFinite(fetchedAt) ? fetchedAt : 0;
        this.catalogueSource = file === this.cataloguePath ? "models-dev.json" : "legacy-cache";
        return this.catalogue;
      } catch {}
    }
    return this.catalogue;
  }
  async refreshCatalogue() {
    if (this.catalogueInflight) return this.catalogueInflight;
    this.catalogueInflight = (async () => {
      try {
        const url = process.env.WEBAGENT_MODELSDEV_URL || "https://models.dev/api.json";
        const timeout = AbortSignal.timeout(Number(process.env.WEBAGENT_MODELSDEV_TIMEOUT_SECONDS || 120) * 1000);
        const payload = await requestJson(url, { signal: AbortSignal.any([this.abort.signal, timeout]) }, 30000000);
        this.catalogue = payload;
        this.catalogueFetchedAt = Date.now();
        this.catalogueSource = "models-dev.json";
        this.catalogueError = "";
        const temporary = `${this.cataloguePath}.tmp`;
        await fs.mkdir(path.dirname(this.cataloguePath), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ fetched_at: new Date(this.catalogueFetchedAt).toISOString(), catalogue: payload }), { mode: 0o600 });
        await fs.rename(temporary, this.cataloguePath);
        return payload;
      } catch (error) {
        this.catalogueError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    })().finally(() => { this.catalogueInflight = undefined; });
    return this.catalogueInflight;
  }
  async ensureCatalogue(waitMs = 1500) {
    const cached = await this.readCatalogue();
    if (cached && this.catalogueFetchedAt && Date.now() - this.catalogueFetchedAt <= this.catalogueTtlMs) return cached;
    if (cached) { void this.refreshCatalogue().catch(() => {}); return cached; }
    return await Promise.race([
      this.refreshCatalogue().catch(() => undefined),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs)),
    ]);
  }
  async discover(providerId: number, _force = false) {
    const provider = this.connection(providerId);
    const cacheKey = JSON.stringify([providerId, provider.updated_at]);
    const existing = this.discoveryInflight.get(cacheKey); if (existing) return existing;
    const operation = (async () => {
      const payload = await requestJson(`${provider.base_url.replace(/\/$/, "")}/models`, { headers: providerHeaders(provider), signal: AbortSignal.timeout(10000) });
      if (!Array.isArray(payload.data)) throw new AppError("供应商没有返回模型列表，可直接填写模型 ID", 502);
      return [...new Map<string, Row>(payload.data.filter((item: Row) => typeof item.id === "string").map((item: Row) => [item.id, { model_id: item.id, name: item.name || item.id, model_kind: classifyModel(item.id) }])).values()];
    })();
    this.discoveryInflight.set(cacheKey, operation); try { return await operation; } finally { this.discoveryInflight.delete(cacheKey); }
  }
  private providerHints(catalogue: Row, provider?: Row) {
    if (!provider) return [] as string[];
    let target: URL;
    try { target = safeUrl(provider.base_url); } catch { return [] as string[]; }
    const exact: string[] = []; const sameHost: string[] = [];
    const normalizePath = (value: string) => value.replace(/\/+$/, "");
    for (const [providerId, entry] of Object.entries(catalogue) as [string, Row][]) {
      if (!entry?.api) continue;
      let api: URL;
      try { api = safeUrl(String(entry.api)); } catch { continue; }
      if (api.origin !== target.origin) continue;
      if (normalizePath(api.pathname) === normalizePath(target.pathname)) exact.push(providerId);
      else sameHost.push(providerId);
    }
    if (exact.length) return exact;
    if (sameHost.length) return sameHost;
    const host = target.hostname.toLowerCase();
    const hints: string[] = [];
    if (host === "api.openai.com") hints.push("openai");
    if (host.includes("deepseek.com")) hints.push("deepseek");
    if (host.includes("dashscope")) {
      if (host.startsWith("coding.")) hints.push("alibaba-coding-plan-cn", "alibaba-coding-plan");
      else if (host.includes("dashscope-intl")) hints.push("alibaba");
      else hints.push("alibaba-cn");
      hints.push("alibaba-cn", "alibaba");
    }
    if (host.includes("bigmodel.cn")) hints.push("zhipuai", "zhipuai-coding-plan");
    if (host.includes("moonshot.cn")) hints.push("moonshotai-cn", "moonshotai");
    if (host.includes("minimax.io")) hints.push("minimax");
    if (host.includes("minimaxi.com")) hints.push("minimax-cn");
    if (host.includes("volces.com")) hints.push("volcengine", "volcengine-coding-plan");
    if (host.includes("siliconflow.cn")) hints.push("siliconflow-cn", "siliconflow");
    if (host.includes("openrouter.ai")) hints.push("openrouter");
    return [...new Set(hints)];
  }
  async suggest(modelId: string, provider?: Row, waitMs = 1500) {
    const model_kind = classifyModel(modelId);
    const reasoning = /qwen3|reason|thinking|deepseek|gpt-5|^o[134]/i.test(modelId);
    const basic: Row = { model_kind, capabilities: model_kind === "vision" ? ["text", "image"] : ["text"], supports_tools: ["chat", "vision"].includes(model_kind), supports_transcription: model_kind.startsWith("asr"), supports_reasoning: reasoning, reasoning_efforts: reasoning ? ["off", "low", "medium", "high"] : [], context_window: ["chat", "vision"].includes(model_kind) ? 32768 : 0, max_output_tokens: ["chat", "vision"].includes(model_kind) ? 8192 : 0, metadata_source: "inferred", temperature: 0.3, top_p: 1 };
    const catalogue = await this.ensureCatalogue(waitMs);
    if (!catalogue) return basic;
    const hints = this.providerHints(catalogue, provider);
    const candidates: { provider: string; model: Row; base: number; affinity: number }[] = [];
    for (const [providerId, provider] of Object.entries(catalogue) as [string, Row][]) {
      for (const [key, model] of Object.entries(provider.models || {}) as [string, Row][]) {
        const id = String(model.id || key);
        const base = this.matchScore(modelId, id, String(model.name || id));
        if (!base) continue;
        const rank = hints.indexOf(providerId);
        candidates.push({ provider: providerId, model, base, affinity: rank >= 0 ? hints.length - rank : 0 });
      }
    }
    const match = candidates
      .filter((candidate) => candidate.base >= 300)
      .sort((a, b) => b.base - a.base || b.affinity - a.affinity || String(b.model.release_date || "").localeCompare(String(a.model.release_date || "")) || a.provider.localeCompare(b.provider))[0];
    if (!match) return basic;
    const source = match.model;
    const contextWindow = Number(source.limit?.context || 0);
    const maxOutput = Number(source.limit?.output || 0);
    return { ...basic, context_window: contextWindow > 0 ? contextWindow : basic.context_window, max_output_tokens: maxOutput > 0 ? maxOutput : basic.max_output_tokens, capabilities: source.modalities?.input?.includes("image") ? ["text", "image"] : basic.capabilities, supports_reasoning: source.reasoning ?? basic.supports_reasoning, supports_tools: source.tool_call ?? basic.supports_tools, input_price_per_1m: Number(source.cost?.input || 0), output_price_per_1m: Number(source.cost?.output || 0), metadata_source: "models.dev", metadata_match: { provider: match.provider, id: source.id, score: match.base } };
  }
  usage(raw: Row = {}, model: Row) {
    const input = Number(raw.prompt_tokens ?? raw.input_tokens ?? raw.inputTokens ?? 0);
    const output = Number(raw.completion_tokens ?? raw.output_tokens ?? raw.outputTokens ?? 0);
    return { prompt_tokens: input, completion_tokens: output, total_tokens: Number(raw.total_tokens ?? input + output), cost_usd: (input * model.input_price_per_1m + output * model.output_price_per_1m) / 1000000 || 0 };
  }
  record(model: Row, purpose: string, result: Row, sessionId = "", username = "", latency = 0, status = "ok", error = "", attempt = 1) {
    const usage = this.usage(result, model);
    const credential = this.store.provider(model.provider_id)?.api_key;
    const safeError = error.replaceAll(credential || "\u0000", "[隐藏]");
    this.store.insert("llm_calls", { session_id: sessionId || null, username, model: model.model_id, provider: model.provider_name || "", purpose, attempt, status, input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, cost_usd: usage.cost_usd, latency_ms: latency, error: safeError.slice(0, 500) });
    if (sessionId) this.store.run("UPDATE sessions SET total_input_tokens=total_input_tokens+?,total_output_tokens=total_output_tokens+?,total_tokens=total_tokens+?,total_cost_usd=total_cost_usd+? WHERE id=?", [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, usage.cost_usd, sessionId]);
    return usage;
  }
  async complete(model: Row, messages: Row[], purpose: string, options: { sessionId?: string; username?: string; signal?: AbortSignal; emit?: Emit } = {}) {
    const provider = this.connection(model.provider_id);
    const settings = this.store.settings();
    const attempts = settings.retry_enabled ? settings.retry_max_attempts : 1;
    const startedAll = Date.now();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      try {
        const timeout = AbortSignal.timeout(provider.timeout_seconds * 1000);
        const payload = await requestJson(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json" }, body: JSON.stringify({ model: model.model_id, messages, temperature: 0.2, max_tokens: Math.min(model.max_output_tokens || 2048, 4096), stream: false }), signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
        const usage = this.record(model, purpose, payload.usage, options.sessionId, options.username, Date.now() - started, "ok", "", attempt);
        return { content: String(payload.choices?.[0]?.message?.content || ""), usage };
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error).replaceAll(provider.api_key || "\u0000", "[隐藏]");
        this.record(model, purpose, {}, options.sessionId, options.username, Date.now() - started, "error", message, attempt);
        if (attempt === attempts || options.signal?.aborted || /HTTP 4(?!08|29)\d\d/.test(message)) throw new AppError(message, 502);
        const baseDelay = Math.min(settings.retry_max_backoff_ms, settings.retry_initial_backoff_ms * settings.retry_multiplier ** (attempt - 1));
        const retryAfter = settings.retry_honor_retry_after && Number.isFinite((error as { retryAfterMs?: number })?.retryAfterMs)
          ? Number((error as { retryAfterMs?: number }).retryAfterMs)
          : baseDelay;
        const jitter = settings.retry_jitter ? 1 + (Math.random() * 2 - 1) * settings.retry_jitter : 1;
        const delay = Math.max(0, Math.round(Math.min(settings.retry_max_backoff_ms, retryAfter) * jitter));
        if (Date.now() - startedAll + delay > settings.retry_max_elapsed_seconds * 1000) throw new AppError(message, 502);
        options.emit?.("retry", { attempt, delay_ms: delay, message: "模型请求暂时失败，稍后重试" });
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(timer); reject(new AppError("请求已取消")); };
          const timer = setTimeout(() => { options.signal?.removeEventListener("abort", aborted); resolve(); }, delay);
          if (options.signal?.aborted) aborted(); else options.signal?.addEventListener("abort", aborted, { once: true });
        });
      }
    }
    throw new AppError("模型请求失败", 502);
  }
}
