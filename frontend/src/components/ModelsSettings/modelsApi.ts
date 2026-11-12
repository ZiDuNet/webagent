import { readApiResponse } from "../../api/pagepilot";

export type ModelsCategory = "chat" | "voice" | "image" | "decision";
export type ModelKind = "chat" | "vision" | "asr" | "asr_realtime" | "tts" | "image_generation" | "decision" | "embedding" | "rerank";

export interface ModelProvider {
  id: number;
  name: string;
  provider_type: "openai_compatible";
  base_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  requires_key?: boolean;
  extra_headers: Record<string, string>;
  timeout_seconds: number;
  enabled: boolean;
  model_count: number;
}

export interface ModelPreset {
  id: string;
  name: string;
  base_url: string;
  description: string;
  categories: ModelsCategory[];
  models: { id: string; name: string; kind: ModelKind }[];
  local: boolean;
  requires_key: boolean;
}

export interface ConfiguredModel {
  id: number;
  provider_id: number;
  provider_name?: string;
  provider_enabled?: boolean;
  name: string;
  model_id: string;
  model_kind: ModelKind;
  enabled: boolean;
  is_default: boolean;
  capabilities: ("text" | "image")[];
  supports_tools: boolean;
  context_window: number;
  max_output_tokens: number;
  temperature: number;
  top_p: number;
  input_price_per_1m: number;
  output_price_per_1m: number;
  supports_reasoning: boolean;
  reasoning_efforts: string[];
  default_reasoning_effort: string;
  supports_reasoning_summary: boolean;
  supports_transcription: boolean;
  metadata_source: string;
  extra_params: Record<string, unknown>;
}

export interface ModelsRuntimeConfig {
  asr_model_id: number | null;
  tts_model_id: number | null;
  bm25_enabled: boolean;
  decision_enabled: boolean;
  decision_model_id: number | null;
  decision_tools: boolean;
  decision_skills: boolean;
  decision_threshold: number;
  decision_min_count: number;
  decision_timeout_seconds: number;
}

export interface ModelTestResult {
  ok: boolean;
  message?: string;
  reply?: string;
  text?: string;
  latency_ms?: number;
  elapsed_ms?: number;
  audio?: { data_url: string; mime_type: string };
  image?: { data_url?: string; url?: string };
  [key: string]: unknown;
}

export async function modelsRequest<Result>(baseUrl: string, path: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<Result> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...options,
      signal: controller.signal,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    return await readApiResponse<Result>(response);
  } catch (failure) {
    if (timedOut) throw new Error("请求超时，请检查供应商连接后重试。模型 ID 也可以直接填写。");
    throw failure;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function modelKindLabel(kind: ModelKind): string {
  return { chat: "对话", vision: "视觉对话", asr: "STT 文件识别", asr_realtime: "STT 实时识别", tts: "TTS 语音合成", image_generation: "图片生成", decision: "决策", embedding: "Embedding", rerank: "Rerank" }[kind] ?? kind;
}

export function modelCategory(kind: ModelKind): ModelsCategory {
  if (kind === "asr" || kind === "asr_realtime" || kind === "tts") return "voice";
  if (kind === "image_generation") return "image";
  if (kind === "decision") return "decision";
  return "chat";
}

export function jsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value || "{}"); } catch { throw new Error(`${label}必须是有效的 JSON。`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象。`);
  return parsed as Record<string, unknown>;
}
