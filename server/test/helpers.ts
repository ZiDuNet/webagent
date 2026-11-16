import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createWebAgent } from "../src/app.js";
import { Store } from "../src/store.js";
import { digest } from "../src/security.js";
import type { Row } from "../src/types.js";

export async function mockServer(handler?: (body: Row, request: IncomingMessage, response: ServerResponse) => Promise<boolean> | boolean) {
  const requests: Row[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: Row = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    requests.push({ ...body, path: request.url, method: request.method, authorization: request.headers.authorization });
    try {
      if (handler && await handler(body, request, response)) return;
      if (request.url === "/v1/models") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: ["test-chat", "whisper-1", "tts-1", "decision-model-preview"].map((id) => ({ id })) })); return; }
      if (!body.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "测试辅助模型摘要" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
      sse(response, [{ content: "这是来自测试供应商的真实流式响应。" }]);
    } catch (error) { if (!response.headersSent) response.writeHead(500); response.end(String(error)); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  return { server, requests, baseUrl: `http://127.0.0.1:${port}`, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
export function sse(response: ServerResponse, deltas: Row[], finishReason = "stop", usage: Row = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 }) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const data = (delta: Row, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: "test-completion", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "test-chat", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  data({ role: "assistant" });
  for (const delta of deltas) data(delta);
  data({}, finishReason);
  response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  response.end("data: [DONE]\n\n");
}
export function toolCall(response: ServerResponse, name: string, args: Row, id = "call-test") {
  sse(response, [{ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }], "tool_calls");
}
export async function fixture(baseUrl?: string, options: Parameters<typeof createWebAgent>[0] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-pi-test-"));
  const store = new Store(dir);
  const services = await createWebAgent({ ...options, store, logger: false, staticUi: false });
  store.setSettings({ retry_enabled: false });
  let model: Row | undefined;
  if (baseUrl) {
    const provider = store.insert("providers", { name: "Test provider", base_url: `${baseUrl}/v1`, api_key: "unit-test-key", timeout_seconds: 5 });
    model = store.insert("models", { provider_id: provider.id, name: "Test chat", model_id: "test-chat", is_default: true, context_window: 16384, max_output_tokens: 1024, capabilities: ["text", "image"], supports_reasoning: true, reasoning_efforts: ["off", "low", "high"] });
  }
  const credential = (username = "user1") => {
    const user = store.one("SELECT * FROM users WHERE username=?", [username], true)!;
    const token = `fixture-${username}`;
    store.run("INSERT OR REPLACE INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)", [digest(token), user.id, new Date().toISOString(), new Date(Date.now() + 3600000).toISOString()], true);
    return token;
  };
  const session = async (username = "user1") => services.runtime.createSession(await services.auth.identity(credential(username)), { title: "验证会话" });
  return { ...services, dir, model, credential, session, close: async () => { await services.app.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
