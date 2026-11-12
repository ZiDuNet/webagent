import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRun } from "../src/lib/conversationRun.ts";

test("preparation phases reflect real server work before the first model round", () => {
  const run = new ConversationRun(1000);
  run.accept("run.phase", { phase: "identity", title: "校验身份" }, 1010);
  run.accept("run.phase", { phase: "tools", title: "发现工具" }, 1020);
  run.accept("run.phase", { phase: "context", title: "检查上下文" }, 1030);
  run.accept("step.started", { step: 1 }, 1040);
  const process = run.snapshot(2000);
  assert.equal(process.title, "等待模型响应");
  assert.equal(process.waitingForModel, true);
  assert.deepEqual(process.steps.map((step) => step.status), ["done", "done", "done", "running"]);
});

test("thinking never hides the tool action or the answer", () => {
  const run = new ConversationRun();
  run.accept("thinking.delta", { delta: "先查询设备。" });
  run.accept("tool.args.delta", { tool: "get_device_stats", call_id: "stats", delta: "{" });
  assert.equal(run.title, "准备调用 get_device_stats");
  assert.equal(run.steps[0].status, "done");
  run.accept("tool.started", { tool: "get_device_stats", call_id: "stats", arguments: {} });
  assert.equal(run.title, "正在调用 get_device_stats");
  run.accept("tool.finished", { tool: "get_device_stats", call_id: "stats", status: "ok", result: { total: 10 } });
  run.accept("step.started", { step: 2 });
  assert.equal(run.title, "等待模型继续");
  run.accept("text.delta", { delta: "共有 10 台设备。" });
  assert.equal(run.title, "正在回答");
  assert.deepEqual(run.steps.filter((step) => step.status === "running").map((step) => step.kind), ["answer"]);
  assert.equal(run.steps.filter((step) => step.kind === "tool").length, 1);
});

test("multiple reasoning rounds retain their original chronological position", () => {
  const run = new ConversationRun();
  run.accept("thinking.delta", { delta: "查询前的思考。" });
  run.accept("tool.started", { tool: "stats", call_id: "first" });
  run.accept("tool.finished", { tool: "stats", call_id: "first", status: "ok" });
  run.accept("thinking.delta", { delta: "查询后的思考。" });
  assert.deepEqual(run.steps.map((step) => step.kind), ["think", "tool", "think"]);
  assert.equal(run.steps[0].reasoning, "查询前的思考。");
  assert.equal(run.steps[2].reasoning, "查询后的思考。");
});

test("snapshots remain immutable while the next token arrives", () => {
  const run = new ConversationRun();
  run.accept("thinking.delta", { delta: "第一段" });
  const previous = run.snapshot();
  run.accept("thinking.delta", { delta: "第二段" });
  run.accept("text.delta", { delta: "回答" });
  assert.equal(previous.steps[0].reasoning, "第一段");
  assert.equal(previous.steps[0].status, "running");
  assert.equal(run.snapshot().steps[0].status, "done");
});

test("argument fragments are not exposed, stored or repeatedly rendered", () => {
  const run = new ConversationRun();
  assert.equal(run.accept("tool.args.delta", { tool: "publish", call_id: "publish", delta: '{"password":"private' }), true);
  assert.equal(run.accept("tool.args.delta", { tool: "publish", call_id: "publish", delta: '-secret"}' }), false);
  assert.equal(JSON.stringify(run).includes("private-secret"), false);
  run.accept("tool.started", { tool: "publish", call_id: "publish", arguments: { password: "[redacted]" } });
  assert.equal(run.steps.length, 1);
  assert.deepEqual(run.steps[0].arguments, { password: "[redacted]" });
});

test("completion freezes the timer and keeps the final answer", () => {
  const run = new ConversationRun(1000);
  run.accept("text.delta", { delta: "答" }, 1200);
  run.accept("run.completed", { answer: "答案", status: "ok" }, 2000);
  assert.equal(run.answer, "答案");
  assert.equal(run.snapshot(9000).duration, "1.0s");
  assert.equal(run.snapshot().status, "done");
  assert.equal(run.steps[0].status, "done");
  assert.equal(run.accept("thinking.delta", { delta: "late" }), false);
});

test("a completed error response is never shown as successful", () => {
  const run = new ConversationRun();
  run.accept("step.started", { step: 1 });
  run.accept("run.completed", { status: "error", answer: "模型调用失败" });
  assert.equal(run.snapshot().status, "failed");
  assert.equal(run.steps[0].status, "failed");
});

test("approval uses the existing tool row and remains an approval after completion", () => {
  const run = new ConversationRun();
  run.accept("tool.args.delta", { tool: "delete_device", call_id: "delete", delta: "{}" });
  run.accept("tool.approval_required", { tool: "delete_device", id: "approval", arguments: { device_id: 5 } });
  run.accept("run.completed", { status: "approval_required" });
  assert.equal(run.snapshot().status, "approval");
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].status, "approval");
});

test("retries, fallback and interruption are honest states, not fake reasoning", () => {
  const run = new ConversationRun();
  run.accept("step.started", { step: 1 });
  run.accept("retry", { delay_ms: 800, attempt: 1 });
  assert.equal(run.title, "请求重试");
  assert.equal(run.steps[0].status, "failed");
  run.accept("model.fallback", { to: "备用模型" });
  assert.equal(run.preview, "备用模型");
  run.reconnect();
  assert.equal(run.title, "正在恢复连接");
  run.interrupt("停止接收，任务继续");
  assert.equal(run.snapshot().status, "failed");
  assert.equal(run.steps.filter((step) => step.kind === "think").length, 0);
});

test("heartbeat and context-only events do not repaint the whole conversation", () => {
  const run = new ConversationRun();
  assert.equal(run.accept("heartbeat", {}), false);
  assert.equal(run.accept("context", { context_tokens: 123 }), false);
  assert.equal(run.accept("run.started", {}), false);
});

test("multiple tool requests stay pending until each is actually executed", () => {
  const run = new ConversationRun();
  run.accept("tool.args.delta", { tool: "first", call_id: "first", delta: "{}" });
  run.accept("tool.args.delta", { tool: "second", call_id: "second", delta: "{}" });
  assert.equal(run.steps[0].status, "pending");
  run.accept("tool.started", { tool: "first", call_id: "first", arguments: {} });
  assert.deepEqual(run.steps.map((step) => step.status), ["running", "pending"]);
  run.accept("tool.finished", { tool: "first", call_id: "first", status: "ok" });
  run.accept("tool.started", { tool: "second", call_id: "second", arguments: {} });
  assert.deepEqual(run.steps.map((step) => step.status), ["done", "running"]);
});
