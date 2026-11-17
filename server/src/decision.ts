import { Providers, providerHeaders, requestJson, sameOriginEndpoint } from "./providers.js";
import { Store } from "./store.js";
import type { SkillEntry } from "./skill-library.js";
import { AppError, type Emit, type Identity, type Row, type ToolSpec } from "./types.js";

export function parseScores(payload: Row, expected: string[]) {
  let rows = payload.answers || payload.scores || payload.results;
  if (Array.isArray(rows)) rows = Object.fromEntries(rows.map((row: Row) => [row.id || row.name, row]));
  if (!rows || typeof rows !== "object") throw new AppError("决策服务缺少评分", 502);
  const scores: Record<string, number> = {};
  for (const id of expected) {
    let value = rows[id];
    if (value && typeof value === "object" && "answer" in value) value = value.answer;
    if (value && typeof value === "object") value = value.noul ?? value.probability ?? value.p_yes ?? value.score;
    if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) throw new AppError("决策评分不完整或不是 0–1 有限数字", 502);
    scores[id] = Number(value);
  }
  return scores;
}
export function decisionConnection(model: Row, provider: Row) {
  const options = model.extra_params?._decision || {};
  const aliyun = model.model_id === "decision-model-preview" && aliyunHost(provider.base_url);
  const protocol = aliyun ? "decisions" : options.protocol || "chat_completions";
  if (!["decisions", "chat_completions"].includes(protocol)) throw new AppError("不支持的决策协议", 422);
  const fallback = protocol === "chat_completions" ? `${provider.base_url}/chat/completions` : aliyun ? aliyunDecisionEndpoint(provider.base_url) : new URL(provider.base_url).hostname === "openrouter.ai" ? "/api/alpha/decisions" : "";
  if (!fallback && !options.endpoint) throw new AppError("请配置决策端点", 422);
  return { protocol, endpoint: sameOriginEndpoint(provider, options.endpoint || "", fallback) };
}
const aliyunHost = (value: string) => { try { return new URL(value).hostname.endsWith(".aliyuncs.com"); } catch { return false; } };
/**
 * 阿里云 MaaS 决策模型只暴露 `.../compatible-mode/v1/systemone`。
 * 管理端经常只填域名（例如 `https://xxx.maas.aliyuncs.com`），这里统一补齐固定路径，
 * 避免把决策请求错误地发到 `/chat/completions` 后返回 404。
 */
function aliyunDecisionEndpoint(value: string) {
  const base = new URL(value);
  const path = base.pathname.replace(/\/+$/, "");
  const prefix = path.endsWith("/compatible-mode/v1") ? path : `${path}/compatible-mode/v1`.replace(/\/{2,}/g, "/");
  return new URL(`${prefix}/systemone`, base.origin).href;
}
export class Decision {
  constructor(private store: Store, private providers: Providers) {}
  async score(model: Row, state: string, candidates: Row[], options: { sessionId?: string; username?: string; signal?: AbortSignal } = {}) {
    const provider = this.providers.connection(model.provider_id);
    const connection = decisionConnection(model, provider);
    const started = Date.now();
    let body: Row;
    let payload: Row;
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.store.settings().decision_timeout_seconds * 1000)]) : AbortSignal.timeout(this.store.settings().decision_timeout_seconds * 1000);
    if (connection.protocol === "chat_completions") {
      body = { state, candidates };
      const result = await this.providers.complete(model, [{ role: "system", content: this.store.settings().decision_prompt }, { role: "user", content: JSON.stringify(body) }], "decision", { ...options, signal });
      payload = JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } else {
      body = { model: model.model_id, state, questions: Object.fromEntries(candidates.map((item) => [item.id, { type: "noul", instructions: item.description, criteria: { true: "适用", false: "不适用" } }])) };
      try {
        payload = await requestJson(connection.endpoint, { method: "POST", headers: { ...providerHeaders(provider), "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        this.providers.record(model, "decision", payload.usage, options.sessionId, options.username, Date.now() - started);
      } catch (error) { this.providers.record(model, "decision", {}, options.sessionId, options.username, Date.now() - started, "error", "决策服务请求失败"); throw error; }
    }
    return { scores: parseScores(payload, candidates.map((item) => item.id)), request: body, response: payload, protocol: connection.protocol, latency_ms: Date.now() - started };
  }
  async select(tools: ToolSpec[], skills: SkillEntry[], state: string, user: Identity, sessionId: string, signal: AbortSignal, emit: Emit, fixedTools: Iterable<string> = []) {
    const settings = this.store.settings();
    const candidates = [...(settings.decision_tools ? tools.map((tool) => ({ id: `tool:${tool.name}`, description: tool.description.slice(0, 1200) })) : []), ...(settings.decision_skills ? skills.map((skill) => ({ id: `skill:${skill.slug}`, description: `${skill.name}：${skill.description}` })) : [])];
    if (candidates.length < settings.decision_min_count || candidates.length > 200) { emit("decision.completed", { used: false, candidates: candidates.length, reason: candidates.length > 200 ? "candidate_limit" : "below_min_count" }); return { tools, skills }; }
    try {
      const model = this.store.model(settings.decision_model_id);
      if (!model?.enabled || model.model_kind !== "decision") throw new AppError("未配置可用决策模型");
      const result = await this.score(model, state, candidates, { sessionId, username: user.username, signal });
      const fixed = new Set(["ask_user", ...fixedTools]);
      const selectedTools = tools.filter((tool) => !settings.decision_tools || fixed.has(tool.name) || result.scores[`tool:${tool.name}`] >= settings.decision_threshold);
      const selectedSkills = skills.filter((skill) => !settings.decision_skills || result.scores[`skill:${skill.slug}`] >= settings.decision_threshold);
      emit("decision.completed", { used: true, model: model.name, candidates: candidates.length, selected_tools: selectedTools.map((tool) => tool.name), selected_skills: selectedSkills.map((skill) => skill.name), latency_ms: result.latency_ms, threshold: settings.decision_threshold });
      emit("decision.diagnostics", { ...result, state, candidates });
      return { tools: selectedTools, skills: selectedSkills };
    } catch {
      if (signal.aborted) throw new AppError("请求已取消");
      emit("decision.completed", { used: false, fallback: true, reason: "决策失败，保留原已授权候选，不切换 BM25" });
      return { tools, skills };
    }
  }
}
