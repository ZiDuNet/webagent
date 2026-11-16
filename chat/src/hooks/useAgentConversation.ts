import { useCallback, useEffect, useRef, useState } from "react";
import { agentRequest, consumeAgentEvents, type AgentEvent, type AgentAttachment, type AgentMessage, type AgentSession } from "../api/agent";
import { apiErrorMessage } from "../api/pagepilot";
import type { AccessMode } from "../components/Composer/Composer";
import { extractHtmlArtifacts } from "../lib/answerContent";
import { ConversationRun } from "../lib/conversationRun";
import type { ChatMessage, MessagePart, ProcessData, QuestionData } from "../types";

export { extractHtmlArtifacts } from "../lib/answerContent";

function processFromMessage(message: AgentMessage): ProcessData | null {
  const runs = message.tool_runs || []; const reasoning = message.reasoning || "";
  if (!runs.length && !reasoning && !message.metadata.reasoning?.had_reasoning) return null;
  const failed = ["failed", "error"].includes(message.metadata.status || "");
  const pending = message.metadata.status === "approval_required" && !message.metadata.approval_status;
  const questionPending = message.metadata.status === "question_required" && !message.metadata.question_status;
  return { title: failed ? "运行失败" : message.metadata.status === "cancelled" ? "已停止" : message.metadata.status === "limited" ? "已达运行上限" : questionPending ? "等待你的回答" : pending ? "等待操作确认" : "已完成", status: failed ? "failed" : questionPending ? "question" as const : pending ? "approval" as const : "done" as const, reasoningStored: Boolean(reasoning), duration: message.metadata.run?.elapsed_seconds !== undefined ? `${message.metadata.run.elapsed_seconds.toFixed(1)}s` : "—", steps: [
    ...(reasoning ? [{ id: "reasoning", title: "模型思考", kind: "think" as const, status: "done" as const, reasoning }] : message.metadata.reasoning?.had_reasoning ? [{ id: "reasoning", title: "模型已完成思考", kind: "think" as const, status: "done" as const, description: "思考原文未保存，仅在本次流式回答中可见。" }] : []),
    ...runs.map((run, index) => ({ id: run.call_id || String(index), title: run.tool, kind: "tool" as const, status: ["error", "failed", "rejected", "cancelled"].includes(run.status) ? "failed" as const : run.status === "pending" ? "approval" as const : "done" as const, meta: run.summary, arguments: run.arguments, result: run.result })),
  ] };
}
function storedMessage(message: AgentMessage, liveProcess?: ProcessData, renderKey?: string): ChatMessage {
  const process = liveProcess && !message.metadata.approval_status && !message.metadata.question_status ? { ...liveProcess, reasoningStored: Boolean(message.reasoning) } : processFromMessage(message);
  const parts: MessagePart[] = process ? [{ kind: "process", process }] : [];
  parts.push(...(message.role === "assistant" ? extractHtmlArtifacts(message.content, String(message.id)).parts : [{ kind: "markdown" as const, content: message.content }]));
  const approval = message.metadata.approval;
  if (approval && !message.metadata.approval_status) parts.push({ kind: "approval", approval: { id: approval.id, tool: approval.tool, title: "等待操作确认", description: approval.summary, arguments: approval.arguments, risk: approval.risk, status: "pending" } });
  const q = message.metadata.question;
  if (q) {
    const status = (message.metadata.question_status || (message.metadata.status === "question_required" ? "pending" : "expired")) as QuestionData["status"];
    parts.push({ kind: "question", question: { id: q.id, question: q.question, description: q.description, options: q.options, selection: q.selection, allow_free_text: q.allow_free_text, required: q.required, expires_at: q.expires_at, status, values: message.metadata.question_answer?.values, free_text: message.metadata.question_answer?.free_text } });
  }
  return { id: String(message.id), renderKey, role: message.role, name: message.role === "user" ? "你" : "智能助手", parts, usage: message.metadata.usage, time: new Date(message.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) };
}
export interface SendAgentOptions { modelId?: number; toolIds: string[]; reasoning: string; accessMode: AccessMode; assistantId?: number; attachments?: AgentAttachment[] }
interface MessagesResponse { items: AgentMessage[]; session: AgentSession; active_run: { id: string } | null }

export function useAgentConversation(sessionId: string | undefined, onSessionChange?: (session: AgentSession) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState(0); const [revision, setRevision] = useState(0); const [answerVersion, setAnswerVersion] = useState(0);
  const streamRef = useRef<AbortController | null>(null); const runIdRef = useRef<string | undefined>(undefined);
  const stopRequestedRef = useRef(false); const sessionRef = useRef(sessionId); const callbackRef = useRef(onSessionChange);
  const processRef = useRef(new Map<string, ProcessData>()); const keysRef = useRef(new Map<string, string>());
  sessionRef.current = sessionId; callbackRef.current = onSessionChange;

  const consume = useCallback(async (target: string, controller: AbortController, responsePromise: Promise<Response>, optimisticText?: string, existingRunId?: string) => {
    streamRef.current = controller; runIdRef.current = existingRunId; stopRequestedRef.current = false;
    setStreaming(true); setError(null);
    const id = `live-${existingRunId || crypto.randomUUID()}`; const run = new ConversationRun();
    let lastEventId = ""; let frame: number | null = null; let renderTimer: number | null = null; let lastRender = 0;
    const current = () => sessionRef.current === target && streamRef.current === controller && !controller.signal.aborted;
    const render = () => {
      if (!current()) return;
      lastRender = Date.now();
      const done = run.completed || run.failed || run.answerCompleted;
      const output = extractHtmlArtifacts(run.answer, id, !done); const process = run.snapshot();
      if (output.pendingHtml && process.steps.at(-1)?.kind === "answer") { process.title = "正在生成 HTML"; process.preview = `${output.pendingHtml.title} · 已接收 ${output.pendingHtml.characters.toLocaleString()} 字符`; }
      const parts: MessagePart[] = [{ kind: "process", process }, ...output.parts];
      if (output.pendingHtml) parts.splice(1, 0, { kind: "html-stream", title: output.pendingHtml.title, characters: output.pendingHtml.characters, html: output.pendingHtml.partial });
      if (run.approval) parts.push({ kind: "approval", approval: { id: run.approval.id, tool: run.approval.tool, title: "等待操作确认", description: run.approval.summary, arguments: run.approval.arguments, risk: run.approval.risk, status: "pending" } });
      if (run.question) parts.push({ kind: "question", question: { id: run.question.id, question: run.question.question, description: run.question.description, options: run.question.options, selection: run.question.selection, allow_free_text: run.question.allow_free_text, required: run.question.required, expires_at: run.question.expires_at, status: "pending" } });
      setMessages((previous) => previous.map((message) => message.id === id ? { ...message, parts, streaming: !done, pendingRun: run.answerCompleted && !run.completed && !run.failed, usage: run.usage } : message));
    };
    const cancelRender = () => { if (frame !== null) cancelAnimationFrame(frame); if (renderTimer !== null) clearTimeout(renderTimer); frame = null; renderTimer = null; };
    const scheduleRender = () => { if (frame !== null || renderTimer !== null) return; renderTimer = window.setTimeout(() => { renderTimer = null; frame = requestAnimationFrame(() => { frame = null; render(); }); }, Math.max(0, 50 - (Date.now() - lastRender))); };
    const onEvent = (name: string, data: AgentEvent, eventId: string) => {
      if (!current()) return;
      if (eventId) lastEventId = eventId;
      if (name === "run.started" && data.run_id) runIdRef.current = data.run_id;
      if (name === "usage" && data.usage?.prompt_tokens) setContextTokens(data.usage.prompt_tokens);
      if (name === "context" && data.context_tokens !== undefined) setContextTokens(data.context_tokens);
      if (name === "session.title" && data.title) callbackRef.current?.({ id: target, title: data.title } as AgentSession);
      if (name === "run.completed" && data.context?.context_tokens !== undefined) setContextTokens(data.context.context_tokens);
      if (name === "answer.completed") {
        if (data.context?.context_tokens !== undefined) setContextTokens(data.context.context_tokens);
        setAnswerVersion((value) => value + 1);
      }
      if (run.accept(name, data)) scheduleRender();
      if (name === "run.failed") setError(run.title);
    };
    setMessages((previous) => [...previous, ...(optimisticText ? [{ id: `${id}-user`, role: "user" as const, name: "你", parts: [{ kind: "markdown" as const, content: optimisticText }], streaming: true }] : []), { id, role: "assistant", name: "智能助手", parts: [{ kind: "process", process: run.snapshot() }], streaming: true }]);
    try {
      const response = await responsePromise;
      if (!current()) { await response.body?.cancel(); return; }
      runIdRef.current = response.headers.get("X-Run-Id") || existingRunId;
      if (stopRequestedRef.current && runIdRef.current) await agentRequest(`/api/agent/runs/${encodeURIComponent(runIdRef.current)}/cancel`, { method: "POST" });
      try { await consumeAgentEvents(response, onEvent); } catch (failure) { if (!runIdRef.current || !response.ok || controller.signal.aborted) throw failure; }
      for (let attempt = 0; !run.completed && !run.failed && current() && runIdRef.current && attempt < 3; attempt++) {
        run.reconnect(); render();
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        if (!current()) return;
        const resumed = await fetch(`/api/agent/chat/stream/${encodeURIComponent(runIdRef.current)}`, { credentials: "same-origin", signal: controller.signal, headers: { Accept: "text/event-stream", "Last-Event-ID": lastEventId } });
        await consumeAgentEvents(resumed, onEvent);
      }
      if (!current()) return;
      if (!run.completed && !run.failed) throw new Error("连接中断；后台任务继续执行。刷新可重新接收过程。");
      cancelRender(); render();
      const latest = await agentRequest<MessagesResponse>(`/api/agent/sessions/${encodeURIComponent(target)}/messages`, { signal: controller.signal });
      if (!current()) return;
      const last = [...latest.items].reverse().find((message) => message.role === "assistant");
      const lastUser = [...latest.items].reverse().find((message) => message.role === "user");
      if (last && run.completed && run.answer) { processRef.current.set(String(last.id), run.snapshot()); keysRef.current.set(String(last.id), id); }
      if (lastUser && optimisticText) keysRef.current.set(String(lastUser.id), `${id}-user`);
      setMessages(latest.items.map((message) => storedMessage(message, processRef.current.get(String(message.id)), keysRef.current.get(String(message.id)))));
      callbackRef.current?.(latest.session);
    } catch (failure) {
      if (!current()) return;
      run.interrupt(apiErrorMessage(failure)); render(); setError(run.title);
    } finally {
      cancelRender();
      if (streamRef.current === controller) { streamRef.current = null; runIdRef.current = undefined; setStreaming(false); }
    }
  }, []);

  useEffect(() => {
    streamRef.current?.abort(); streamRef.current = null; runIdRef.current = undefined;
    setStreaming(false); setMessages([]); setContextTokens(0); setAnswerVersion(0); setError(null); setLoading(false);
    if (!sessionId) { processRef.current.clear(); keysRef.current.clear(); return; }
    const controller = new AbortController(); setLoading(true);
    agentRequest<MessagesResponse>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setMessages(result.items.map((message) => storedMessage(message, processRef.current.get(String(message.id)), keysRef.current.get(String(message.id)))));
      setContextTokens(result.session.last_context_tokens || 0); callbackRef.current?.(result.session); setLoading(false);
      if (result.active_run) void consume(sessionId, controller, fetch(`/api/agent/chat/stream/${encodeURIComponent(result.active_run.id)}`, { signal: controller.signal, credentials: "same-origin", headers: { Accept: "text/event-stream" } }), undefined, result.active_run.id);
    }).catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure))).finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [sessionId, revision, consume]);
  useEffect(() => () => streamRef.current?.abort(), []);

  const send = useCallback(async (text: string, options: SendAgentOptions) => {
    if (!sessionId || streamRef.current) return;
    const controller = new AbortController();
    await consume(sessionId, controller, fetch("/api/agent/chat/stream", { method: "POST", signal: controller.signal, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ message: text, session_id: sessionId, model_row_id: options.modelId, assistant_id: options.assistantId, enabled_tools: options.toolIds, reasoning_effort: options.reasoning || undefined, approval_mode: options.accessMode, attachments: options.attachments || [] }) }), text);
  }, [sessionId, consume]);
  const approve = useCallback(async (id: string, accepted: boolean) => {
    if (!sessionId || streamRef.current) return;
    if (!accepted) { await agentRequest(`/api/agent/approvals/${encodeURIComponent(id)}/reject`, { method: "POST" }); setRevision((value) => value + 1); return; }
    const controller = new AbortController();
    await consume(sessionId, controller, fetch(`/api/agent/approvals/${encodeURIComponent(id)}/approve`, { method: "POST", signal: controller.signal, credentials: "same-origin", headers: { Accept: "text/event-stream" } }));
  }, [sessionId, consume]);
  const answerQuestion = useCallback(async (questionId: string, values: string[], freeText: string) => {
    if (!sessionId || streamRef.current) return;
    const controller = new AbortController();
    await consume(sessionId, controller, fetch(`/api/agent/questions/${encodeURIComponent(questionId)}/answer`, { method: "POST", signal: controller.signal, credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ values, free_text: freeText }) }));
  }, [sessionId, consume]);
  const cancelQuestion = useCallback(async (questionId: string) => {
    if (!sessionId || streamRef.current) return;
    await agentRequest(`/api/agent/questions/${encodeURIComponent(questionId)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cancel: true }) });
    setRevision((value) => value + 1);
  }, [sessionId]);
  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    if (runIdRef.current) try { await agentRequest(`/api/agent/runs/${encodeURIComponent(runIdRef.current)}/cancel`, { method: "POST" }); } catch (failure) { setError(apiErrorMessage(failure)); }
  }, []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { messages, streaming, loading, error, contextTokens, answerVersion, send, approve, answerQuestion, cancelQuestion, refresh, stop };
}
