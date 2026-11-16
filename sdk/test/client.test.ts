import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents, WebAgentClient, WebAgentError } from "../src/index.js";

test("SSE parses split UTF-8 and CRLF without losing events", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nid: 1\r\nevent: text.delta\r\ndata: {"delta":"你好"}\r\n\r\nid: 2\nevent: run.completed\ndata: {"status":"ok"}\n\n');
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  const events = []; for await (const event of readEvents(response)) events.push(event);
  assert.deepEqual(events, [{ id: "1", name: "text.delta", data: { delta: "你好" } }, { id: "2", name: "run.completed", data: { status: "ok" } }]);
});
test("SDK refreshes business tokens for each request", async () => {
  let current = "one"; const headers: string[] = [];
  const client = new WebAgentClient({ baseUrl: "https://agent.example/", token: () => current, fetch: async (url, init) => { assert.equal(url, "https://agent.example/api/me"); headers.push(new Headers(init?.headers).get("Authorization")!); return Response.json({ user: { id: 7 } }); } });
  await client.me(); current = "two"; await client.me();
  assert.deepEqual(headers, ["Bearer one", "Bearer two"]);
});
test("SDK exposes server-side authorization errors", async () => {
  const client = new WebAgentClient({ fetch: async () => Response.json({ detail: "permission denied" }, { status: 403 }) });
  await assert.rejects(client.sessions(), (error: unknown) => error instanceof WebAgentError && error.status === 403 && error.message === "permission denied");
});
