export { browserAudioToWav, encodePcmWav } from "./audio.js";

export type JsonObject = Record<string, unknown>;
export interface ClientOptions {
  baseUrl?: string;
  token?: string | (() => string | Promise<string>);
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
}
export interface ChatInput {
  message: string;
  session_id?: string;
  assistant_id?: number;
  model_row_id?: number;
  enabled_tools?: string[];
  reasoning_effort?: "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  approval_mode?: "confirm" | "full_access";
  attachments?: { name: string; mime_type: string; data_url: string }[];
}
export interface AgentEvent { id: string; name: string; data: JsonObject }
export interface Session { id: string; title: string; assistant_id: number | null; [key: string]: unknown }
export interface ChatResult { status: string; session_id: string; answer?: string; message?: string; [key: string]: unknown }
export interface AccessExchange { user: JsonObject; access: { mode: "token"; fixed_assistant_id: number; token_name: string; expires_at?: string } }
export class WebAgentError extends Error {
  constructor(message: string, public readonly status: number, public readonly response?: unknown) { super(message); this.name = "WebAgentError"; }
}
export async function* readEvents(response: Response): AsyncGenerator<AgentEvent> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as JsonObject;
    throw new WebAgentError(String(payload.detail || payload.message || `HTTP ${response.status}`), response.status, payload);
  }
  if (!response.body) throw new WebAgentError("Streaming response body is unavailable", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string): AgentEvent | undefined => {
    let name = "message"; let id = ""; const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) return { id, name, data: JSON.parse(data.join("\n")) as JsonObject };
  };
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let delimiter = /\r?\n\r?\n/.exec(buffer);
      while (delimiter?.index !== undefined) {
        const event = parse(buffer.slice(0, delimiter.index));
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        if (event) yield event;
        delimiter = /\r?\n\r?\n/.exec(buffer);
      }
      if (buffer.length > 8 * 1024 * 1024) throw new WebAgentError("SSE frame exceeds the size limit", 502);
      if (chunk.done) break;
    }
    if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class WebAgentClient {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: ClientOptions = {}) { this.fetcher = options.fetch || globalThis.fetch.bind(globalThis); }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = typeof this.options.token === "function" ? await this.options.token() : this.options.token;
    const headers = new Headers(init.headers); headers.set("Accept", headers.get("Accept") || "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return this.fetcher(`${(this.options.baseUrl || "").replace(/\/$/, "")}${path}`, { ...init, headers, credentials: this.options.credentials || "same-origin" });
  }
  async json<Result = JsonObject>(path: string, body?: unknown, method?: string, signal?: AbortSignal, headers?: HeadersInit): Promise<Result> {
    const response = await this.request(path, { method: method || (body === undefined ? "GET" : "POST"), body: body === undefined ? undefined : JSON.stringify(body), signal, headers });
    const payload = await response.json().catch(() => ({})) as JsonObject;
    if (!response.ok) throw new WebAgentError(String(payload.detail || payload.message || `HTTP ${response.status}`), response.status, payload);
    return payload as Result;
  }
  me(signal?: AbortSignal) { return this.json("/api/me", undefined, "GET", signal); }
  agentMe(signal?: AbortSignal) { return this.json<{ user: JsonObject; access: { mode: "business" | "token"; fixed_assistant_id?: number | null } }>("/api/agent/me", undefined, "GET", signal); }
  exchangeAccessToken(accessToken?: string, signal?: AbortSignal) {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    return this.json<AccessExchange>("/api/agent/auth/exchange", undefined, "POST", signal, headers);
  }
  status(signal?: AbortSignal) { return this.json("/api/agent/status", undefined, "GET", signal); }
  models() { return this.json<{ items: JsonObject[] }>("/api/agent/models"); }
  assistants() { return this.json<{ items: JsonObject[] }>("/api/agent/assistants"); }
  tools(assistantId?: number) { return this.json<{ items: JsonObject[] }>(`/api/agent/tools${assistantId ? `?assistant_id=${assistantId}` : ""}`); }
  sessions() { return this.json<{ items: Session[] }>("/api/agent/sessions"); }
  createSession(input: { title?: string; assistant_id?: number } = {}) { return this.json<{ session: Session }>("/api/agent/sessions", input); }
  messages(sessionId: string, signal?: AbortSignal) { return this.json<{ session: Session; items: JsonObject[]; active_run: { id: string; status: string } | null }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, undefined, "GET", signal); }
  deleteSession(sessionId: string) { return this.json(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, undefined, "DELETE"); }
  forkSession(sessionId: string, untilMessageId?: number) { return this.json<{ session: Session }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/fork`, { until_message_id: untilMessageId }); }
  compact(sessionId: string, modelId?: number) { return this.json(`/api/agent/sessions/${encodeURIComponent(sessionId)}/compact`, { model_row_id: modelId }); }
  chat(input: ChatInput, signal?: AbortSignal) { return this.json<ChatResult>("/api/agent/chat", input, "POST", signal); }
  async *stream(input: ChatInput, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const response = await this.request("/api/agent/chat/stream", { method: "POST", headers: { Accept: "text/event-stream" }, body: JSON.stringify(input), signal });
    yield* readEvents(response);
  }
  async *resume(runId: string, afterEventId = "", signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    yield* readEvents(await this.request(`/api/agent/chat/stream/${encodeURIComponent(runId)}`, { headers: { Accept: "text/event-stream", "Last-Event-ID": afterEventId }, signal }));
  }
  cancel(runId: string) { return this.json(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {}); }
  approve(approvalId: string) { return this.json<ChatResult>(`/api/agent/approvals/${encodeURIComponent(approvalId)}/approve`, {}); }
  reject(approvalId: string) { return this.json(`/api/agent/approvals/${encodeURIComponent(approvalId)}/reject`, {}); }
  answerQuestion(questionId: string, input: { values?: string[]; free_text?: string }) { return this.json<ChatResult>(`/api/agent/questions/${encodeURIComponent(questionId)}/answer`, input); }
  cancelQuestion(questionId: string) { return this.json(`/api/agent/questions/${encodeURIComponent(questionId)}/answer`, { cancel: true }); }
  memories() { return this.json<{ items: JsonObject[] }>("/api/agent/memories"); }
  publications() { return this.json<{ items: JsonObject[] }>("/api/agent/pagepilot/publications"); }
  logoutAgent() { return this.json("/api/agent/auth/logout", {}); }
  voiceStreamUrl(sessionId: string) {
    const base = (this.options.baseUrl || (typeof location !== "undefined" ? location.origin : "")).replace(/^http/, "ws");
    return `${base.replace(/\/$/, "")}/api/agent/voice/stream?session_id=${encodeURIComponent(sessionId)}`;
  }
}
