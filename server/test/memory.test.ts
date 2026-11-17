import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, mockServer, sse } from "./helpers.js";
import { config } from "../src/config.js";
import type { Row } from "../src/types.js";

const memoryCalls = (service: Awaited<ReturnType<typeof fixture>>, sessionId: string) =>
  Number(service.store.one("SELECT COUNT(*) AS n FROM llm_calls WHERE purpose='memory' AND session_id=?", [sessionId])?.n || 0);

async function waitFor(check: () => boolean, message: string, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

function memoryUpstream() {
  return mockServer((body: Row, _request, response) => {
    if (body.stream) {
      sse(response, [{ content: "已经回答。" }]);
      return true;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    return true;
  });
}

async function runRound(service: Awaited<ReturnType<typeof fixture>>, sessionId: string, round: number) {
  const result = await (await service.runs.start(service.credential(), { session_id: sessionId, message: `第 ${round} 轮消息` })).task;
  assert.equal(result.status, "ok");
}

test("memory extraction runs every 3 completed rounds and skips the first", async () => {
  const upstream = await memoryUpstream();
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.setSettings({ memory_auto_extract: true, memory_extract_interval: 3 });
    const session = await service.session();
    for (let round = 1; round <= 6; round++) await runRound(service, session.id, round);
    await waitFor(() => memoryCalls(service, session.id) >= 2, "第 3、6 轮应各触发一次记忆提取");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(memoryCalls(service, session.id), 2);
    const calls = service.store.all("SELECT * FROM llm_calls WHERE purpose='memory' AND session_id=? ORDER BY id", [session.id]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.status === "ok"));
  } finally { await service.close(); await upstream.close(); }
});

test("memory extraction interval 0 runs every later round but never the first", async () => {
  const upstream = await memoryUpstream();
  const service = await fixture(upstream.baseUrl);
  try {
    service.store.setSettings({ memory_auto_extract: true, memory_extract_interval: 0 });
    const session = await service.session();
    await runRound(service, session.id, 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(memoryCalls(service, session.id), 0, "会话第一轮不应提取记忆");
    await runRound(service, session.id, 2);
    await runRound(service, session.id, 3);
    await waitFor(() => memoryCalls(service, session.id) >= 2, "第 2、3 轮应各触发一次记忆提取");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(memoryCalls(service, session.id), 2);
  } finally { await service.close(); await upstream.close(); }
});

test("memory extract interval defaults to 3 and the control API accepts only 0-50 integers", async () => {
  const service = await fixture();
  try {
    const login = await service.app.inject({ method: "POST", url: "/api/control/auth/login", payload: { username: "admin", password: config.adminPassword } });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    const current = await service.app.inject({ url: "/api/control/config", headers: { cookie } });
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().memory_extract_interval, 3);

    const accepted = await service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { memory_extract_interval: 5 } });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().memory_extract_interval, 5);
    assert.equal(service.store.settings().memory_extract_interval, 5);

    for (const value of [-1, 51, 3.5]) {
      const rejected = await service.app.inject({ method: "PUT", url: "/api/control/config", headers: { cookie }, payload: { memory_extract_interval: value } });
      assert.equal(rejected.statusCode, 422, `memory_extract_interval=${value} 应被拒绝`);
      assert.match(rejected.json().detail, /0–50/);
    }
  } finally { await service.close(); }
});
