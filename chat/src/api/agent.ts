import { readApiResponse } from "./pagepilot";
import type { UsageData } from "../types";

export interface AgentUser { id?: number; username: string; display_name?: string; role?: string; is_admin?: boolean; auth_mode?: "business" | "token"; assistant_id?: number }
export interface AgentSession {
  id: string;
  title: string;
  assistant_id: number | null;
  assistant_name?: string;
  updated_at: string;
  last_context_tokens: number;
  last_model_id?: number;
}
export interface AgentModel {
  id: number;
  name: string;
  model_id: string;
  model_kind: string;
  context_window: number;
  max_output_tokens?: number;
  supports_reasoning: boolean;
  reasoning_efforts: string[];
  default_reasoning_effort: string;
  is_default: boolean;
  capabilities?: string[];
}
export interface AgentAttachment { name: string; mime_type: string; data_url?: string; path?: string; size?: number }
export interface AgentTool { name: string; title?: string; description: string; selectable: boolean; default_selected: boolean }
export interface AgentToolsResponse { items: AgentTool[]; auto_enabled_count?: number }
export interface AgentAssistant { id: number; name: string; description?: string; is_default: boolean; model_row_id?: number; allow_model_switch?: boolean; context_max_tokens?: number }
export interface AgentStatus {
  assistant_id?: number;
  assistant_name?: string;
  asr: VoiceModelStatus;
  asr_realtime: VoiceModelStatus;
  tts: VoiceModelStatus;
  voice_asr: VoiceModelStatus;
  voice_tts: VoiceModelStatus;
  auth_mode?: "business" | "token";
  fixed_assistant_id?: number | null;
  voice_input_mode?: "auto" | "realtime" | "file";
  voice_auto_send?: boolean;
  tts_auto_read?: boolean;
  tts_max_read_chars?: number;
  default_reasoning_effort: string;
  default_approval_mode: "confirm" | "full_access";
  allow_full_access: boolean;
  welcome_title?: string;
  welcome_subtitle?: string;
  welcome_prompts?: string[] | string;
  welcome_logo?: string;
  store_reasoning: boolean;
  context_max_tokens?: number;
  context_reserve_tokens?: number;
  memory?: { enabled: boolean; auto_extract: boolean; auto_confirm: boolean; count: number; pending: number };
}
export interface VoiceModelStatus { configured: boolean; model_id?: number | null; model_name?: string; model_kind?: string; protocol?: string; reason?: string }
export interface AgentApproval { id: string; tool: string; summary?: string; arguments?: unknown; risk?: string; expires_at?: string }
export interface AgentQuestionOption { label: string; value: string; description?: string }
export interface AgentQuestion {
  id: string;
  question: string;
  description?: string;
  options: AgentQuestionOption[];
  selection: "single" | "multiple";
  allow_free_text: boolean;
  required: boolean;
  expires_at?: string;
}
export interface AgentToolRun { call_id?: string; tool: string; arguments?: unknown; result?: unknown; summary?: string; status: string; risk?: string }
export interface AgentMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  attachments?: AgentAttachment[];
  tool_runs: AgentToolRun[];
  created_at: string;
  metadata: {
    usage?: UsageData;
    run?: { elapsed_seconds?: number };
    status?: string;
    approval?: AgentApproval;
    approval_status?: string;
    question?: AgentQuestion;
    question_status?: string;
    question_answer?: { values?: string[]; free_text?: string };
    reasoning?: { had_reasoning?: boolean; stored?: boolean };
    context?: { context_tokens?: number; budget_tokens?: number };
  };
}

export interface AgentEvent {
  run_id?: string;
  phase?: string;
  step?: number;
  max_steps?: number;
  attempt?: number;
  delta?: string;
  message?: string;
  title?: string;
  description?: string;
  preview?: string;
  meta?: string;
  input_label?: string;
  output_label?: string;
  tool?: string;
  call_id?: string;
  arguments?: unknown;
  result?: unknown;
  summary?: string;
  status?: string;
  risk?: string;
  id?: string;
  usage?: UsageData;
  answer?: string;
  tool_runs?: AgentToolRun[];
  run?: { elapsed_seconds?: number };
  context?: { context_tokens?: number; context_window?: number };
  context_tokens?: number;
  context_window?: number;
  approval?: AgentApproval;
  question?: AgentQuestion;
  approval_mode?: "confirm" | "full_access";
  delay_ms?: number;
  to?: string;
}

export async function agentRequest<Result>(path: string, init: RequestInit = {}): Promise<Result> {
  return readApiResponse<Result>(await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...init.headers },
  }));
}

export function agentJson<Result>(path: string, body: unknown, method = "POST"): Promise<Result> {
  return agentRequest<Result>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function consumeAgentEvents(response: Response, onEvent: (name: string, payload: AgentEvent, id: string) => void): Promise<void> {
  if (!response.ok) {
    await readApiResponse(response);
    return;
  }
  if (!response.body) throw new Error("当前浏览器不支持流式响应。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseBlock = (block: string) => {
    let name = "message";
    let id = "";
    const lines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("id:")) id = line.slice(3).trim();
      if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    }
    if (lines.length) onEvent(name, JSON.parse(lines.join("\n")) as AgentEvent, id);
  };
  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done }).replace(/\r\n/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        parseBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
      if (result.done) break;
    }
    if (buffer.trim()) parseBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}
