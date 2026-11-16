import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Providers, requestJson } from "../src/providers.js";
import { AppError, type Row } from "../src/types.js";

const model = (id: string, name: string, context: number, output: number) => ({
  id, name, release_date: "2026-06-02", limit: { context, output }, modalities: { input: ["text", "image", "video"] }, tool_call: true, reasoning: true, cost: { input: 0.4, output: 1.6 },
});

async function catalogueFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webagent-models-test-"));
  const store = new Store(dir);
  await store.initialize(false);
  const catalogue: Row = {
    "alibaba-cn": { id: "alibaba-cn", api: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: { "qwen3.7-plus": model("qwen3.7-plus", "Qwen3.7 Plus", 1000000, 64000) } },
    "alibaba-coding-plan-cn": { id: "alibaba-coding-plan-cn", api: "https://coding.dashscope.aliyuncs.com/v1", models: { "qwen3.7-plus": model("qwen3.7-plus", "Qwen3.7 Plus", 1000000, 64000) } },
    alibaba: { id: "alibaba", api: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", models: { "qwen3.7-plus": model("qwen3.7-plus", "Qwen3.7 Plus", 1000000, 131072) } },
    requesty: { id: "requesty", api: "https://router.requesty.ai/v1", models: { "qwen3.7-plus": model("qwen3.7-plus", "Qwen3.7 Plus", 1048576, 131072), "longcat-2.0:thinking": model("longcat-2.0:thinking", "LongCat Thinking", 1048576, 131072), "qwen3.7-flash": model("qwen3.7-flash", "Qwen3.7 Flash", 1000000, 65536) } },
  };
  fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cache", "models-dev.json"), JSON.stringify({ fetched_at: new Date().toISOString(), catalogue }), { mode: 0o600 });
  const providers = new Providers(store);
  return { dir, store, providers, close: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("models.dev metadata uses the provider endpoint, exact ids and variant boundaries", async () => {
  const fixture = await catalogueFixture();
  try {
    const coding = { base_url: "https://coding.dashscope.aliyuncs.com/v1" };
    const international = { base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" };
    const codingPlus = await fixture.providers.suggest("qwen3.7-plus", coding, 5000);
    assert.equal(codingPlus.context_window, 1000000);
    assert.equal(codingPlus.max_output_tokens, 64000);
    assert.equal(codingPlus.metadata_match.provider, "alibaba-coding-plan-cn");
    assert.deepEqual(codingPlus.capabilities, ["text", "image"]);

    const internationalPlus = await fixture.providers.suggest("qwen3.7-plus", international, 5000);
    assert.equal(internationalPlus.max_output_tokens, 131072);
    assert.equal(internationalPlus.metadata_match.provider, "alibaba");

    const thinking = await fixture.providers.suggest("qwen3.7-plus:thinking", coding, 5000);
    assert.equal(thinking.metadata_match.id, "qwen3.7-plus");
    assert.notEqual(thinking.metadata_match.provider, "requesty");

    const flash = await fixture.providers.suggest("qwen3.7-flash", coding, 5000);
    assert.equal(flash.metadata_match.id, "qwen3.7-flash");
    assert.equal(flash.context_window, 1000000);
  } finally { fixture.close(); }
});

test("requestJson turns body timeouts into a 504 AppError instead of leaking a DOMException", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => { response.setHeader("Content-Type", "application/json"); response.end("{}"); }, 300);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(
      () => requestJson(`http://127.0.0.1:${port}/slow`, { signal: AbortSignal.timeout(50) }),
      (error: unknown) => error instanceof AppError && error.statusCode === 504,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
