import assert from "node:assert/strict";
import test from "node:test";
import { ConversationRun } from "../src/lib/conversationRun.ts";

test("cancelled runs report stopped instead of completed", () => {
  const run = new ConversationRun();
  run.accept("run.completed", { status: "cancelled", answer: "部分输出" });
  assert.equal(run.completed, true);
  assert.equal(run.snapshot().title, "已停止");
});
test("limited runs keep the limit notice instead of claiming successful completion", () => {
  const run = new ConversationRun();
  run.accept("run.completed", { status: "limited", answer: "已达到本次推理轮次上限" });
  assert.equal(run.completed, true);
  assert.equal(run.snapshot().title, "已达运行上限");
  assert.equal(run.answer, "已达到本次推理轮次上限");
});
import { extractHtmlArtifacts } from "../src/lib/answerContent.ts";
import { nextProcessActivity, processActivities } from "../src/lib/processActivity.ts";

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

test("decision phase exposes administrator input, output, summary and usage details", () => {
  const run = new ConversationRun();
  run.accept("run.phase", {
    phase: "decision_result",
    title: "已准备 1 个工具 · 0 个技能",
    description: "决策测试已对 2 个候选评分，阈值 0.60。",
    meta: "240ms · 输入 120 / 输出 8 tokens",
    arguments: { input: { state: "查记录", candidates: ["tool:read"] } },
    result: { parsed_scores: { "tool:read": 0.9 } },
    input_label: "决策模型输入",
    output_label: "决策模型输出",
  });
  const step = run.snapshot().steps[0];
  assert.equal(step.description, "决策测试已对 2 个候选评分，阈值 0.60。");
  assert.equal(step.meta, "240ms · 输入 120 / 输出 8 tokens");
  assert.equal(step.inputLabel, "决策模型输入");
  assert.equal(step.outputLabel, "决策模型输出");
  assert.deepEqual(step.arguments.input.candidates, ["tool:read"]);
  assert.deepEqual(step.result.parsed_scores, { "tool:read": 0.9 });
  assert.equal(run.snapshot().activities[0].preview, "决策测试已对 2 个候选评分，阈值 0.60。");
});

test("thinking never hides the tool action or the answer", () => {
  const run = new ConversationRun();
  run.accept("thinking.delta", { delta: "先查询业务记录。" });
  run.accept("tool.args.delta", { tool: "business_search", call_id: "stats", delta: "{" });
  assert.equal(run.title, "准备调用 business_search");
  assert.equal(run.steps[0].status, "done");
  run.accept("tool.started", { tool: "business_search", call_id: "stats", arguments: {} });
  assert.equal(run.title, "正在调用 business_search");
  run.accept("tool.finished", { tool: "business_search", call_id: "stats", status: "ok", result: { total: 10 } });
  run.accept("step.started", { step: 2 });
  assert.equal(run.title, "等待模型继续");
  run.accept("text.delta", { delta: "共有 10 条记录。" });
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
  run.accept("tool.args.delta", { tool: "delete_record", call_id: "delete", delta: "{}" });
  run.accept("tool.approval_required", { tool: "delete_record", id: "approval", arguments: { record_id: 5 } });
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

test("streaming HTML is hidden from Markdown while its progress remains available", () => {
  const result = extractHtmlArtifacts("说明\n```html\n<!doctype html><html><head><title>业务总览</title></head><body>", "message", true);
  assert.deepEqual(result.parts, [{ kind: "markdown", content: "说明\n" }]);
  assert.equal(result.pendingHtml.title, "业务总览");
  assert.ok(result.pendingHtml.characters > 30);
  assert.equal(result.artifacts.length, 0);
});

test("partial fence headers do not flash HTML code into the conversation", () => {
  for (const prefix of ["```", "```h", "```ht", "```html", "~~~html"]) {
    const result = extractHtmlArtifacts(prefix, "message", true);
    assert.deepEqual(result.parts, []);
    assert.ok(result.pendingHtml);
  }
});

test("completed HTML fences become cards without consuming following Markdown", () => {
  const result = extractHtmlArtifacts("```html\n<html><title>总览</title></html>\n```\n已完成 **报告**。", "message", true);
  assert.equal(result.parts[0].kind, "artifact");
  assert.equal(result.parts[0].artifact.title, "总览");
  assert.equal(result.parts[1].content, "\n已完成 **报告**。");
  assert.equal(result.pendingHtml, undefined);
});

test("HTML inside other code fences is preserved verbatim", () => {
  const content = '````markdown\n```html\n<html>示例</html>\n```\n````\n普通文本';
  const result = extractHtmlArtifacts(content, "message", true);
  assert.deepEqual(result.parts, [{ kind: "markdown", content }]);
  assert.equal(result.pendingHtml, undefined);
});

test("raw HTML documents stream as progress and keep trailing text after closure", () => {
  const html = "<!DOCTYPE html><html><title>报告</title><body>数据</body></html>";
  assert.deepEqual(extractHtmlArtifacts(html.slice(0, -8), "message", true).parts, []);
  for (const prefix of ["<", "<!doc", "<ht"]) assert.deepEqual(extractHtmlArtifacts(prefix, "message", true).parts, []);
  const result = extractHtmlArtifacts(`${html}\n下一步`, "message", true);
  assert.equal(result.artifacts[0].html, html);
  assert.equal(result.parts[1].content, "\n下一步");
});

test("multiple HTML artifacts and interrupted output retain their contents", () => {
  const result = extractHtmlArtifacts("~~~html\n<html>第一份</html>\n~~~\n说明\n```html\n<html>第二份", "message");
  assert.equal(result.artifacts.length, 2);
  assert.notEqual(result.artifacts[0].id, result.artifacts[1].id);
  assert.equal(result.artifacts[1].html, "<html>第二份");
  assert.equal(result.parts[1].content, "\n说明\n");
});

test("ordinary text, Mermaid and non-HTML code retain incremental rendering", () => {
  for (const content of ["正文 **继续", "```mermaid\ngraph TD; A-->B", "```python\nprint(1)", "1 < 2"]) {
    assert.deepEqual(extractHtmlArtifacts(content, "message", true).parts, [{ kind: "markdown", content }]);
  }
});

test("single-line playback contains phases, reasoning, safe tool inputs, results and answer in order", () => {
  const run = new ConversationRun();
  run.accept("run.phase", { phase: "context", title: "检查上下文" });
  run.accept("step.started", { step: 1 });
  run.accept("thinking.delta", { delta: "先读取业务统计，再分析异常记录。" });
  run.accept("tool.started", { tool: "业务统计", call_id: "stats", arguments: { status: "abnormal" } });
  run.accept("tool.finished", { tool: "业务统计", call_id: "stats", status: "ok", summary: "共 12 条", result: { total: 12 } });
  run.accept("step.started", { step: 2 });
  run.accept("thinking.delta", { delta: "已有结果，整理可操作的建议。" });
  run.accept("text.delta", { delta: "共查询到 **12 条记录**。" });
  const activities = processActivities(run.snapshot());
  assert.deepEqual(activities.map((activity) => activity.title), [
    "检查上下文", "模型请求已发送", "模型思考", "正在调用 业务统计", "业务统计 · 参数",
    "工具已返回 · 业务统计", "业务统计 · 结果", "模型请求已发送", "模型思考", "回答内容",
  ]);
  assert.equal(activities[2].preview, "先读取业务统计，再分析异常记录。");
  assert.equal(activities[4].preview, '{"status":"abnormal"}');
  assert.equal(activities[6].preview, '{"total":12}');
  assert.equal(activities.at(-1).preview, "共查询到 **12 条记录**。");
  assert.ok(activities.every((activity) => !/第 \d+ 轮|已完成 ·/.test(activity.title)));
  run.accept("run.completed", { status: "ok", answer: "完成" });
  assert.deepEqual(processActivities(run.snapshot()).map((activity) => activity.title), ["已完成"]);
});

test("long output is split into readable sequential fragments without losing content", () => {
  const run = new ConversationRun();
  const reasoning = "逐项核对记录。🙂".repeat(30);
  for (const delta of [reasoning.slice(0, 57), reasoning.slice(57)]) run.accept("thinking.delta", { delta });
  const activities = processActivities(run.snapshot());
  assert.ok(activities.length > 3);
  assert.ok(activities.every((activity) => Array.from(activity.preview).length <= 36));
  assert.equal(activities.map((activity) => activity.preview).join(""), reasoning);
  assert.equal(run.steps[0].reasoning, reasoning);
});

test("playback keeps its current item while new tokens arrive and never replays completed round labels", () => {
  const run = new ConversationRun();
  run.accept("thinking.delta", { delta: "片段一" });
  const previous = run.snapshot();
  const selected = previous.activities[0].id;
  run.accept("thinking.delta", { delta: "继续片段一" });
  assert.equal(run.snapshot().activities[0].id, selected);
  assert.equal(previous.activities[0].preview, "片段一");
  assert.equal(nextProcessActivity(run.snapshot().activities, selected), selected);
  run.accept("text.delta", { delta: "回答" });
  assert.equal(nextProcessActivity(run.snapshot().activities, selected), run.snapshot().activities[1].id);
  assert.equal(nextProcessActivity(run.snapshot().activities, "expired"), selected);
});

test("playback bounds retained fragments while keeping complete reasoning and answer details", () => {
  const run = new ConversationRun();
  const text = "内容".repeat(6000);
  run.accept("thinking.delta", { delta: text });
  run.accept("text.delta", { delta: text });
  assert.equal(run.snapshot().activities.length, 300);
  assert.equal(run.steps.find((step) => step.kind === "think").reasoning, text);
  assert.equal(run.steps.find((step) => step.kind === "answer").content, text);
});

test("answer.completed releases the answer while the run stays pending for compaction", () => {
  const run = new ConversationRun(1000);
  run.accept("text.delta", { delta: "最终回答。" }, 1100);
  const released = run.accept("answer.completed", { usage: { prompt_tokens: 1200, completion_tokens: 20 }, context: { context_tokens: 1200 } }, 1200);
  assert.equal(released, true);
  assert.equal(run.completed, false);
  assert.equal(run.answerCompleted, true);
  assert.equal(run.snapshot(1300).status, "done");
  assert.equal(run.snapshot(1300).title, "已完成");
  assert.equal(run.answer, "最终回答。");

  run.accept("text.delta", { delta: "续跑内容。" }, 1400);
  assert.equal(run.answerCompleted, false);
  assert.equal(run.snapshot(1400).status, "running");

  run.accept("run.completed", { status: "ok", answer: "最终回答。续跑内容。" }, 1500);
  assert.equal(run.completed, true);
  assert.equal(run.snapshot(1600).status, "done");
});
