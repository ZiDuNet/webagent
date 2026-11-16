import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWebAgent } from "../src/app.js";
import { Store } from "../src/store.js";
import { digest, hashPassword, token as generateToken } from "../src/security.js";
import { mockServer, toolCall } from "./helpers.js";
import type { Row } from "../src/types.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-ui-"));
const report = [
  "## 业务数据概览\n\n",
  "已调用业务工具，以下统计来自隔离验收数据。\n\n",
  "| 记录状态 | 数量 |\n| --- | ---: |\n| 正常 | 4 |\n| 异常 | 1 |\n\n",
  "```mermaid\nflowchart LR\n  A[读取记录] --> B[核对状态]\n  B --> C[生成报告]\n```\n\n",
  '```chart\n{"title":"业务状态分布","type":"donut","unit":"条","data":[{"label":"正常","value":4,"tone":"green"},{"label":"异常","value":1,"tone":"amber"}]}\n```\n\n',
  "**建议**：优先处理异常记录并核对数据来源。\n\n",
  '```html\n<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>业务数据报告</title><style>body{font-family:system-ui;background:#f4f6fa;color:#162333;padding:48px}main{max-width:760px;margin:auto;background:white;padding:36px;border-radius:18px}strong{font-size:48px;color:#168f60}</style></head><body><main><p>WEBAGENT / PI</p><h1>业务数据报告</h1><p>隔离验收数据 · 非真实供应商回复</p><strong>5 条记录</strong><p>4 条正常 · 1 条异常</p></main></body></html>\n```',
].join("");
const upstream = await mockServer(async (body, _request, response) => {
  if (!body.stream) return false;
  if (!body.messages.some((message: Row) => message.role === "tool")) { toolCall(response, "business_overview", {}); return true; }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = (value: Row) => response.write(`data: ${JSON.stringify({ id: "ui-test", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: value, finish_reason: null }] })}\n\n`);
  delta({ role: "assistant" });
  for (const text of ["已收到业务统计结果。", "先核对正常与异常数量，", "再生成图表和可预览的报告。", "所有操作仍在当前业务用户的权限范围内。"] ) {
    if (response.destroyed) return true;
    delta({ reasoning_content: text }); await new Promise((resolve) => setTimeout(resolve, 180));
  }
  for (let offset = 0; offset < report.length; offset += 36) {
    if (response.destroyed) return true;
    delta({ content: report.slice(offset, offset + 36) }); await new Promise((resolve) => setTimeout(resolve, 90));
  }
  response.write(`data: ${JSON.stringify({ id: "ui-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 420, completion_tokens: 280, total_tokens: 700 } })}\n\n`);
  response.end("data: [DONE]\n\n"); return true;
});
const store = new Store(directory);
const { app } = await createWebAgent({ store, logger: false, tools: [{
  name: "business_overview",
  title: "业务概览",
  description: "返回隔离验收用的业务统计，不连接任何真实业务系统。",
  source: "native",
  category: "验收数据",
  permission: "",
  risk: "read",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ total: 5, by_status: [{ name: "正常", count: 4 }, { name: "异常", count: 1 }] }),
}] });
store.update("control_users", 1, { password_hash: await hashPassword("webagent-ui-test") });
store.setSettings({ retry_enabled: false, memory_auto_extract: false });
const provider = store.config.insertProvider({ name: "本地验收供应商", base_url: `${upstream.baseUrl}/v1`, api_key: "local-ui-fixture", timeout_seconds: 15 });
for (const [name, modelId, kind, contextWindow] of [["PI 验收模型", "test-chat", "chat", 16384], ["PI 长上下文模型", "test-chat-large", "chat", 32768], ["STT 协议示例", "whisper-1", "asr", 0], ["TTS 协议示例", "tts-1", "tts", 0], ["决策协议示例", "decision-model-preview", "decision", 0]] as const) store.config.insertModel({ provider_id: provider.id, name, model_id: modelId, model_kind: kind, context_window: contextWindow, is_default: modelId === "test-chat", max_output_tokens: 2048, supports_reasoning: kind === "chat", reasoning_efforts: ["off", "low", "high"], capabilities: ["text", "image"] });
const port = Number(process.env.WEBAGENT_UI_TEST_PORT || 18900);
const assistant = store.assistants()[0];
const accessToken = `wa_${generateToken()}`;
store.insert("access_tokens", { name: "UI 验收接入", token_hash: digest(accessToken), token_prefix: accessToken.slice(0, 12), assistant_id: assistant.id, enabled: 1, allowed_origins: [], rate_limit_per_minute: 0, daily_token_limit: 0, session_retention_days: 0, created_by: "ui-harness", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
await app.listen({ host: "127.0.0.1", port });
console.log(`隔离 UI 验收：管理端 http://127.0.0.1:${port}/admin/（admin / webagent-ui-test）；Chat 打开 http://127.0.0.1:${port}/chat/?token=${accessToken}（接入 Token，绑定「${assistant.name}」）。只连接本机 Mock。`);
for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, async () => { await app.close(); await upstream.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); process.exit(0); });
