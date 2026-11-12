import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentRequest,
  consumeAgentEvents,
  type AgentEvent,
  type AgentAttachment,
  type AgentMessage,
  type AgentSession,
} from "../api/agent";
import { apiErrorMessage } from "../api/pagepilot";
import type { AccessMode } from "../components/Composer/Composer";
import { ConversationRun } from "../lib/conversationRun";
import type { ArtifactData, ChatMessage, MessagePart, ProcessData } from "../types";

export function extractHtmlArtifacts(content: string, messageId: string): { parts: MessagePart[]; artifacts: ArtifactData[] } {
  const parts: MessagePart[] = [];
  const artifacts: ArtifactData[] = [];
  const blocks = /```(?:html|htm)\s*\n([\s\S]*?)```/gi;
  let previous = 0;
  let match: RegExpExecArray | null;
  while ((match = blocks.exec(content)) !== null) {
    const before = content.slice(previous, match.index);
    if (before.trim()) parts.push({ kind: "markdown", content: before });
    const html = match[1];
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() || "HTML 页面";
    const artifact: ArtifactData = { id: `${messageId}-html-${artifacts.length}`, title, html };
    artifacts.push(artifact);
    parts.push({ kind: "artifact", artifact });
    previous = blocks.lastIndex;
  }
  const remainder = content.slice(previous);
  if (remainder.trim()) {
    if (previous === 0 && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(remainder)) {
      const artifact: ArtifactData = { id: `${messageId}-html-0`, title: remainder.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() || "HTML 页面", html: remainder };
      artifacts.push(artifact);
      parts.push({ kind: "artifact", artifact });
    } else {
      parts.push({ kind: "markdown", content: remainder });
    }
  }
  return { parts, artifacts };
}

function processFromMessage(message: AgentMessage): ProcessData | null {
  const runs = message.tool_runs || [];
  const reasoning = message.reasoning || "";
  if (!runs.length && !reasoning && !message.metadata.reasoning?.had_reasoning) return null;
  const failed = ["failed", "error"].includes(message.metadata.status || "");
  const awaitingApproval = message.metadata.status === "approval_required" && !message.metadata.approval_status;
  return {
    title: failed ? "运行失败" : awaitingApproval ? "等待操作确认" : "已完成",
    status: failed ? "failed" : awaitingApproval ? "approval" : "done",
    reasoningStored: Boolean(reasoning),
    duration: message.metadata.run?.elapsed_seconds !== undefined ? `${message.metadata.run.elapsed_seconds.toFixed(1)}s` : message.metadata.usage?.latency_ms !== undefined ? `${(message.metadata.usage.latency_ms / 1000).toFixed(1)}s` : "—",
    steps: [
      ...(reasoning ? [{ id: "reasoning", title: "模型思考", kind: "think" as const, status: "done" as const, reasoning }] : message.metadata.reasoning?.had_reasoning ? [{ id: "reasoning", title: "模型已完成思考", kind: "think" as const, status: "done" as const, description: "思考原文未保存，仅在本次流式回答中可见。" }] : []),
      ...runs.map((run, index) => ({ id: run.call_id || String(index), title: run.tool, kind: "tool" as const, status: ["error", "failed", "rejected", "cancelled"].includes(run.status) ? "failed" as const : run.status === "pending" ? "approval" as const : "done" as const, meta: run.summary, arguments: run.arguments, result: run.result })),
    ],
  };
}

function storedMessage(message: AgentMessage, liveProcess?: ProcessData, renderKey?: string): ChatMessage {
  const process = liveProcess && !message.metadata.approval_status ? { ...liveProcess, reasoningStored: Boolean(message.reasoning) } : processFromMessage(message);
  const parts: MessagePart[] = [];
  if (process) parts.push({ kind: "process", process });
  parts.push(...(message.role === "assistant" ? extractHtmlArtifacts(message.content, String(message.id)).parts : [{ kind: "markdown" as const, content: message.content }]));
  const approval = message.metadata.approval;
  if (approval && !message.metadata.approval_status) parts.push({ kind: "approval", approval: { id: approval.id, tool: approval.tool, title: "等待操作确认", description: approval.summary, arguments: approval.arguments, risk: approval.risk, status: "pending" } });
  return { id: String(message.id), renderKey, role: message.role, name: message.role === "user" ? "你" : "智能助手", parts, usage: message.metadata.usage, time: new Date(message.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) };
}

export interface SendAgentOptions { modelId?: number; toolIds: string[]; reasoning: string; accessMode: AccessMode; assistantId?: number; attachments?: AgentAttachment[] }

export function useAgentConversation(sessionId: string | undefined, onSessionChange?: (session: AgentSession) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState(0);
  const [revision, setRevision] = useState(0);
  const streamRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(sessionId);
  const callbackRef = useRef(onSessionChange);
  const processRef = useRef(new Map<string, ProcessData>());
  const messageKeysRef = useRef(new Map<string, string>());
  callbackRef.current = onSessionChange;
  sessionRef.current = sessionId;

  useEffect(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setStreaming(false);
    setMessages([]);
    setContextTokens(0);
    setError(null);
    setLoading(false);
    if (!sessionId) { processRef.current.clear(); messageKeysRef.current.clear(); return; }
    const controller = new AbortController();
    setLoading(true);
    agentRequest<{ items: AgentMessage[]; session: AgentSession }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setMessages(result.items.map((message) => storedMessage(message, processRef.current.get(String(message.id)), messageKeysRef.current.get(String(message.id)))));
        const last = [...result.items].reverse().find((message) => message.role === "assistant");
        setContextTokens(last?.metadata.context?.context_tokens || last?.metadata.usage?.prompt_tokens || result.session.last_context_tokens || 0);
        callbackRef.current?.(result.session);
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [sessionId, revision]);

  useEffect(() => () => streamRef.current?.abort(), []);

  const send = useCallback(async (text: string, options: SendAgentOptions) => {
    if (!sessionId || streamRef.current) return;
    const controller = new AbortController();
    streamRef.current = controller;
    setStreaming(true);
    setError(null);
    const id = `live-${Date.now()}`;
    const run = new ConversationRun();
    let lastEventId = "";
    let frame: number | null = null;
    let renderTimer: number | null = null;
    let lastRenderAt = 0;
    const render = () => {
      if (sessionRef.current !== sessionId) return;
      lastRenderAt = Date.now();
      const parts: MessagePart[] = [{ kind: "process", process: run.snapshot() }];
      parts.push(...(run.completed ? extractHtmlArtifacts(run.answer, id).parts : run.answer ? [{ kind: "markdown" as const, content: run.answer }] : []));
      if (run.approval) parts.push({ kind: "approval", approval: { id: run.approval.id, tool: run.approval.tool, title: "等待操作确认", description: run.approval.summary, arguments: run.approval.arguments, risk: run.approval.risk, status: "pending" } });
      setMessages((previous) => previous.map((message) => message.id === id ? { ...message, parts, streaming: !run.completed && !run.failed, usage: run.usage } : message));
    };
    const cancelRender = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (renderTimer !== null) window.clearTimeout(renderTimer);
      frame = null;
      renderTimer = null;
    };
    const scheduleRender = () => {
      if (frame !== null || renderTimer !== null) return;
      renderTimer = window.setTimeout(() => {
        renderTimer = null;
        frame = window.requestAnimationFrame(() => { frame = null; render(); });
      }, Math.max(0, 50 - (Date.now() - lastRenderAt)));
    };
    const onEvent = (name: string, data: AgentEvent, eventId: string) => {
      if (sessionRef.current !== sessionId) return;
      if (eventId) lastEventId = eventId;
      const changed = run.accept(name, data);
      if (name === "usage" && data.usage?.prompt_tokens) setContextTokens(data.usage.prompt_tokens);
      if (name === "context" && data.context_tokens !== undefined) setContextTokens(data.context_tokens);
      if (name === "session.title" && data.title) callbackRef.current?.({ id: sessionId, title: data.title } as AgentSession);
      if (name === "run.completed") {
        if (data.context?.context_tokens !== undefined) setContextTokens(data.context.context_tokens);
      }
      if (name === "run.failed") setError(run.title);
      if (changed) scheduleRender();
    };
    setMessages((previous) => [...previous, { id: `${id}-user`, role: "user", name: "你", parts: [{ kind: "markdown", content: text }], streaming: true }, { id, role: "assistant", name: "智能助手", parts: [{ kind: "process", process: run.snapshot() }], streaming: true }]);
    try {
      const response = await fetch("/api/agent/chat/stream", { method: "POST", credentials: "same-origin", signal: controller.signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ message: text, session_id: sessionId, model_row_id: options.modelId, assistant_id: options.assistantId, enabled_tools: options.toolIds, reasoning_effort: options.reasoning || null, approval_mode: options.accessMode, attachments: options.attachments || [] }) });
      const runId = response.headers.get("X-Run-Id");
      try { await consumeAgentEvents(response, onEvent); }
      catch (failure) { if (!runId || controller.signal.aborted) throw failure; }
      if (!run.completed && !run.failed && runId && !controller.signal.aborted) {
        run.reconnect();
        render();
        const resumed = await fetch(`/api/agent/chat/stream/${encodeURIComponent(runId)}`, { credentials: "same-origin", signal: controller.signal, headers: { Accept: "text/event-stream", "Last-Event-ID": lastEventId } });
        await consumeAgentEvents(resumed, onEvent);
      }
      if (!run.completed && !run.failed) throw new Error("连接中断。后台任务可能仍在执行，请刷新会话查看结果。");
      cancelRender();
      render();
      if (run.completed && sessionRef.current === sessionId) {
        const latest = await agentRequest<{ items: AgentMessage[]; session: AgentSession }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { signal: controller.signal });
        if (sessionRef.current !== sessionId) return;
        const last = [...latest.items].reverse().find((message) => message.role === "assistant");
        const lastUser = [...latest.items].reverse().find((message) => message.role === "user");
        if (last) {
          processRef.current.set(String(last.id), run.snapshot());
          messageKeysRef.current.set(String(last.id), id);
        }
        if (lastUser) messageKeysRef.current.set(String(lastUser.id), `${id}-user`);
        setMessages(latest.items.map((message) => storedMessage(message, processRef.current.get(String(message.id)), messageKeysRef.current.get(String(message.id)))));
        callbackRef.current?.(latest.session);
      }
    } catch (failure) {
      if (sessionRef.current !== sessionId) return;
      if (run.completed) {
        setError("回答已完成，但同步会话失败；可刷新会话查看。");
      } else {
        run.interrupt(controller.signal.aborted ? "已停止接收；后台任务可能仍在执行" : apiErrorMessage(failure));
        setError(run.title);
      }
    } finally {
      cancelRender();
      if (!run.completed) render();
      if (streamRef.current === controller) {
        streamRef.current = null;
        setStreaming(false);
      }
    }
  }, [sessionId]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const stopReceiving = useCallback(() => streamRef.current?.abort(), []);
  return { messages, streaming, loading, error, contextTokens, send, refresh, stopReceiving };
}
