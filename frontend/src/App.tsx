import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { agentJson, agentRequest, type AgentAssistant, type AgentAttachment, type AgentModel, type AgentSession, type AgentStatus, type AgentTool, type AgentUser } from "./api/agent";
import { apiErrorMessage, PagePilotApiError, readApiResponse } from "./api/pagepilot";
import { Composer, type AccessMode } from "./components/Composer/Composer";
import { MessageList } from "./components/MessageList/MessageList";
import type { ArtifactAction } from "./components/HtmlArtifactCard/HtmlArtifactCard";
import { PublishedPages } from "./components/PublishedPages/PublishedPages";
import { PublishPageDialog } from "./components/PublishedPages/PublishPageDialog";
import { SessionList } from "./components/SessionList/SessionList";
import { Dialog } from "./components/ui/Dialog";
import { Icon } from "./components/ui/Icon";
import { useAgentConversation } from "./hooks/useAgentConversation";
import { useVoiceInput } from "./hooks/useVoiceInput";
import type { ArtifactData, ModelOption, ToolOption } from "./types";
import "./styles/theme.css";
import "./styles/app.css";

export default function App() {
  const [user, setUser] = useState<AgentUser | null>(null);
  const [checkingLogin, setCheckingLogin] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [modelId, setModelId] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("confirm");
  const [navOpen, setNavOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [publishing, setPublishing] = useState<ArtifactData | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const businessUrl = import.meta.env.VITE_BUSINESS_URL || (import.meta.env.DEV ? "http://127.0.0.1:8000/admin/" : "/admin/");

  const updateSession = useCallback((session: AgentSession) => {
    setSessions((previous) => previous.map((item) => item.id === session.id ? { ...item, ...session } : item));
  }, []);
  const conversation = useAgentConversation(activeSessionId, updateSession);

  useEffect(() => {
    const controller = new AbortController();
    agentRequest<{ user: AgentUser }>("/api/me", { signal: controller.signal })
      .then((result) => setUser(result.user))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && !(failure instanceof PagePilotApiError && failure.status === 401)) setLoginError(apiErrorMessage(failure));
      })
      .finally(() => !controller.signal.aborted && setCheckingLogin(false));
    return () => controller.abort();
  }, []);

  const refreshSessions = useCallback(async () => {
    const result = await agentRequest<{ items: AgentSession[] }>("/api/agent/sessions");
    setSessions(result.items);
    return result.items;
  }, []);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setModels([]);
      setTools([]);
      setAssistants([]);
      setStatus(null);
      setAttachments([]);
      setEditing(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      agentRequest<{ items: AgentSession[] }>("/api/agent/sessions", { signal: controller.signal }),
      agentRequest<{ items: AgentModel[] }>("/api/agent/models", { signal: controller.signal }),
      agentRequest<{ items: AgentAssistant[] }>("/api/agent/assistants", { signal: controller.signal }),
      agentRequest<AgentStatus>("/api/agent/status", { signal: controller.signal }),
    ])
      .then(([sessionResult, modelResult, assistantResult, statusResult]) => {
        if (controller.signal.aborted) return;
        const chatModels = modelResult.items.filter((model) => !model.model_kind || ["chat", "vision"].includes(model.model_kind));
        setSessions(sessionResult.items);
        setActiveSessionId(sessionResult.items[0]?.id);
        setModels(chatModels);
        setModelId(String(chatModels.find((model) => model.id === sessionResult.items[0]?.last_model_id)?.id ?? chatModels.find((model) => model.is_default)?.id ?? chatModels[0]?.id ?? ""));
        setAssistants(assistantResult.items);
        setStatus(statusResult);
        setAccessMode(statusResult.default_approval_mode || "confirm");
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [user]);

  const assistantId = activeSession?.assistant_id ?? assistants[0]?.id;
  useEffect(() => {
    if (!user || !assistantId) return;
    const controller = new AbortController();
    agentRequest<{ items: AgentTool[] }>(`/api/agent/tools?assistant_id=${assistantId}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setTools(result.items);
        setToolIds(result.items.filter((tool) => tool.default_selected).map((tool) => tool.name));
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)));
    return () => controller.abort();
  }, [user, assistantId]);

  const createSession = async () => {
    const result = await agentJson<{ session: AgentSession }>("/api/agent/sessions", { assistant_id: assistants[0]?.id, title: "新对话" });
    setSessions((previous) => [result.session, ...previous]);
    setActiveSessionId(result.session.id);
    setNavOpen(false);
    return result.session.id;
  };

  const perform = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); } catch (failure) { setError(apiErrorMessage(failure)); }
  };

  const send = async (text: string) => {
    if (!activeSessionId) { setError("请先点击「新建对话」，再发送消息。"); return; }
    if (!models.length) { setError("管理员尚未配置可用对话模型。"); return; }
    if (attachments.length && !models.find((model) => String(model.id) === modelId)?.capabilities?.includes("image")) { setError("当前模型不支持图片，请切换支持图片的模型。"); return; }
    await conversation.send(text, { modelId: Number(modelId), toolIds, reasoning, accessMode, assistantId: assistantId || undefined, attachments });
    setAttachments([]);
    await refreshSessions();
  };
  const voice = useVoiceInput(send, Boolean(status?.asr?.configured && activeSessionId), activeSessionId);

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    if (attachments.length + files.length > 4) throw new Error("每条消息最多添加 4 张图片。");
    const existingSize = attachments.reduce((total, item) => total + (item.size ?? atob(item.data_url.split(",")[1] || "").length), 0);
    if (existingSize + Array.from(files).reduce((total, file) => total + file.size, 0) > 8 * 1024 * 1024) throw new Error("本轮图片总大小不能超过 8 MB。");
    const next = await Promise.all(Array.from(files).map(async (file) => {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片。");
      if (file.size > 3 * 1024 * 1024) throw new Error("每张图片请小于 3 MB。");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("无法读取图片。"));
        reader.readAsDataURL(file);
      });
      return { name: file.name.slice(0, 160), mime_type: file.type, data_url: dataUrl, size: file.size };
    }));
    setAttachments((previous) => [...previous, ...next]);
  };

  const modelOptions: ModelOption[] = models.map((model) => ({ id: String(model.id), name: model.name, contextWindow: model.context_window, supportsReasoning: model.supports_reasoning, reasoningEfforts: model.reasoning_efforts, defaultReasoningEffort: model.default_reasoning_effort }));
  const toolOptions: ToolOption[] = tools.map((tool) => ({ id: tool.name, name: tool.title || tool.name, description: tool.description, selectable: tool.selectable, defaultSelected: tool.default_selected }));
  const currentHtml = useMemo(() => {
    for (const message of [...conversation.messages].reverse()) {
      const artifact = [...message.parts].reverse().find((part) => part.kind === "artifact");
      if (artifact?.kind === "artifact") return artifact.artifact.html;
    }
    return undefined;
  }, [conversation.messages]);

  const artifactAction = async (action: ArtifactAction, artifact: ArtifactData) => {
    if (action === "publish") { setPublishing(artifact); return; }
    if (action === "published") { setPublishedOpen(true); return; }
    const response = await fetch("/api/agent/artifacts/screenshot", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: artifact.html }) });
    if (!response.ok) { await readApiResponse(response); return; }
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${artifact.title.replace(/[\\/:*?"<>|]/g, "-")}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const result = await agentJson<{ user: AgentUser }>("/api/login", { username, password });
      setPassword("");
      setUser(result.user);
    } catch (failure) { setLoginError(failure instanceof Error ? failure.message : "登录失败。"); }
    finally { setLoggingIn(false); }
  };

  if (checkingLogin) return <div className="app-auth"><Icon name="loader" className="wa-spinner" size={26} /><p>正在检查业务系统登录态…</p></div>;
  if (!user) return (
    <main className="app-auth">
      <form className="app-login" onSubmit={(event) => void login(event)}>
        <span className="brand__mark">WA</span>
        <h1>登录 WebAgent</h1>
        <p>使用业务系统账号，查看你的会话和已发布页面。</p>
        <label className="wa-field"><span>账号</span><input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus /></label>
        <label className="wa-field"><span>密码</span><input name="password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {loginError && <p className="wa-error" role="alert">{loginError}</p>}
        <button type="submit" className="wa-button wa-button--primary" disabled={loggingIn}>{loggingIn ? "登录中…" : "登录"}</button>
        <small>后端未启动时，请先启动项目根目录的业务服务。</small>
      </form>
    </main>
  );

  const chooseSession = (id: string) => {
    setActiveSessionId(id);
    setNavOpen(false);
    const model = models.find((item) => item.id === sessions.find((session) => session.id === id)?.last_model_id);
    if (model) setModelId(String(model.id));
    setReasoning("");
  };

  const fork = async (sessionId: string, messageId?: string) => {
    const result = await agentJson<{ session: AgentSession }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/fork`, messageId ? { until_message_id: Number(messageId) } : {});
    await refreshSessions();
    chooseSession(result.session.id);
  };

  const selectedModel = models.find((model) => String(model.id) === modelId);
  const configuredCap = assistants.find((assistant) => assistant.id === assistantId)?.context_max_tokens || status?.context_max_tokens || 0;
  const modelWindow = selectedModel?.context_window || configuredCap || 32768;
  const cappedWindow = Math.max(2048, configuredCap > 0 ? Math.min(modelWindow, configuredCap) : modelWindow);
  const totalTokens = Math.max(1200, cappedWindow - Math.min(selectedModel?.max_output_tokens || 0, Math.floor(cappedWindow / 2)) - (status?.context_reserve_tokens || 1600));
  const displayedError = error || conversation.error || voice.error;
  const welcomePrompts = Array.isArray(status?.welcome_prompts) ? status.welcome_prompts : String(status?.welcome_prompts || "").split("\n").filter(Boolean);

  return (
    <div className="app-shell">
      {navOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭侧边栏" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`}>
        <div className="brand"><span className="brand__mark">WA</span><span className="brand__name">WebAgent</span><span className="brand__badge">React</span></div>
        <button type="button" className="new-chat" disabled={loading || conversation.streaming || !assistants.length} onClick={() => void perform(createSession)}><Icon name="plus" size={14} />新建对话</button>
        <label className="sidebar-search"><Icon name="search" size={13} /><input placeholder="搜索会话" aria-label="搜索会话" value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} /></label>
        <div className="sidebar__scroll"><SessionList sessions={sessions.filter((session) => session.title.includes(sessionQuery)).map((session) => ({ id: session.id, title: session.title, meta: session.assistant_name }))} activeId={activeSessionId} onSelect={chooseSession} onFork={(id) => void perform(() => fork(id))} onRename={(id, title) => void perform(async () => { await agentJson(`/api/agent/sessions/${encodeURIComponent(id)}`, { title }, "PATCH"); await refreshSessions(); })} onDelete={(id) => void perform(async () => { await agentRequest(`/api/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); const next = await refreshSessions(); if (id === activeSessionId) setActiveSessionId(next[0]?.id); })} /></div>
        <div className="sidebar__footer"><div className="account"><span className="account__avatar"><Icon name="user" size={15} /></span><span className="account__text"><strong>{user.display_name || user.username}</strong><small>{user.role || "当前业务账号"}</small></span><button type="button" className="account__button" aria-label="退出登录" title="退出登录" onClick={() => void perform(async () => { await agentRequest("/api/logout", { method: "POST" }); setUser(null); setActiveSessionId(undefined); setPublishedOpen(false); setPublishing(null); })}><Icon name="external" size={15} /></button></div></div>
      </aside>
      <main className="workspace">
        <header className="workspace__header">
          <button type="button" className="header-icon-button mobile-nav-button" aria-label="打开侧边栏" onClick={() => setNavOpen(true)}><Icon name="menu" size={16} /></button>
          <div className="workspace__identity"><span className="workspace__avatar"><Icon name="sparkles" size={16} /></span><div className="workspace__title"><strong>{activeSession?.title || "智能助手"}</strong><span><i />{status?.demo_mode ? "后台已开启模拟模式" : "业务账号已连接"}</span></div></div>
          <div className="workspace__actions"><button type="button" className="header-button" onClick={() => setPublishedOpen(true)}><Icon name="globe" size={14} /><span>已发布</span></button><button type="button" className="header-icon-button" disabled={conversation.streaming} aria-label="刷新会话" onClick={() => void perform(async () => { await refreshSessions(); conversation.refresh(); })}><Icon name="refresh" size={15} /></button><a className="header-icon-button" aria-label="打开业务系统配置" title="业务系统" href={businessUrl} target="_blank" rel="noopener noreferrer"><Icon name="settings" size={15} /></a></div>
        </header>
        <div className="workspace__body">
          {(loading || conversation.loading) && <p className="app-loading" role="status"><Icon name="loader" className="wa-spinner" size={14} />正在读取会话…</p>}
          {displayedError && <p className="wa-error app-error" role="alert">{displayedError}</p>}
          <MessageList messages={conversation.messages} onApprove={(_, id) => void perform(async () => { await agentRequest(`/api/agent/approvals/${encodeURIComponent(id)}/approve`, { method: "POST" }); conversation.refresh(); })} onReject={(_, id) => void perform(async () => { await agentRequest(`/api/agent/approvals/${encodeURIComponent(id)}/reject`, { method: "POST" }); conversation.refresh(); })} onForkMessage={(id) => activeSessionId && void perform(() => fork(activeSessionId, id))} onEditMessage={(id) => { const message = conversation.messages.find((item) => item.id === id); setEditing({ id, content: message?.parts.filter((part) => part.kind === "markdown").map((part) => part.kind === "markdown" ? part.content : "").join("\n") || "" }); }} onDeleteMessage={(id) => void perform(async () => { await agentRequest(`/api/agent/sessions/${encodeURIComponent(activeSessionId || "")}/messages/${encodeURIComponent(id)}`, { method: "DELETE" }); conversation.refresh(); })} onArtifactAction={artifactAction} emptyState={<div className="empty-state"><span className="empty-state__icon"><Icon name="sparkles" size={21} /></span><h2>{status?.welcome_title || "从业务问题开始"}</h2><p>{activeSessionId ? status?.welcome_subtitle || "模型、工具和操作权限来自当前业务账号。生成的 HTML 可保存到你的发布记录。" : "点击「新建对话」开始。你也可以通过右上角「已发布」查看已有页面。"}</p><div className="empty-state__chips">{activeSessionId && welcomePrompts.slice(0, 4).map((prompt) => <button type="button" key={prompt} onClick={() => void perform(() => send(prompt))}>{prompt}</button>)}</div></div>} />
          <div className="composer-zone">
            {attachments.length > 0 && <div className="app-attachments">{attachments.map((attachment, index) => <button type="button" key={`${attachment.name}-${index}`} aria-label={`移除图片 ${attachment.name}`} onClick={() => setAttachments((previous) => previous.filter((_, position) => position !== index))}><Icon name="image" size={13} />{attachment.name}<Icon name="x" size={12} /></button>)}</div>}
            <Composer
              models={modelOptions}
              selectedModelId={modelId}
              onModelChange={(id) => { setModelId(id); setReasoning(""); }}
              tools={toolOptions}
              selectedToolIds={toolIds}
              onToolsChange={setToolIds}
              onSend={(text) => void perform(() => send(text))}
              onStop={conversation.stopReceiving}
              streaming={conversation.streaming}
              disabled={loading || !activeSessionId || !models.length}
              placeholder={!activeSessionId ? "新建或选择一个会话后输入消息" : undefined}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              allowFullAccess={status?.allow_full_access}
              showReasoning
              selectedReasoning={reasoning}
              onReasoningChange={setReasoning}
              voiceEnabled={Boolean(status?.asr?.configured)}
              voiceDisabledReason={status?.asr?.reason || "管理员尚未配置可用语音识别模型"}
              voiceBusy={voice.busy}
              recording={voice.recording}
              onVoiceToggle={() => void voice.toggle()}
              onAttach={(files) => void perform(() => addAttachments(files))}
              contextInfo={{ usedTokens: conversation.contextTokens, totalTokens }}
              note={voice.recording ? "正在录音，点击停止后识别并发送；最长 60 秒" : "工具调用继承当前账号权限"}
            />
          </div>
        </div>
      </main>
      <PublishedPages open={publishedOpen} onOpenChange={setPublishedOpen} currentSessionId={activeSessionId} sessions={sessions} currentHtml={currentHtml} onOpenSession={chooseSession} />
      {publishing && <PublishPageDialog open onOpenChange={(next) => !next && setPublishing(null)} html={publishing.html} title={publishing.title} description={publishing.description} sessionId={activeSessionId} />}
      <Dialog open={Boolean(editing)} onOpenChange={(next) => !next && setEditing(null)} title="编辑用户消息" description="修改已保存的消息不会自动重新执行工具。">
        <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { if (!editing?.content.trim()) return; await agentJson(`/api/agent/sessions/${encodeURIComponent(activeSessionId || "")}/messages/${editing.id}`, { content: editing.content }, "PATCH"); setEditing(null); conversation.refresh(); }); }} className="publish-form"><div className="wa-dialog__body"><label className="wa-field"><span>消息内容</span><textarea rows={7} value={editing?.content || ""} onChange={(event) => setEditing((previous) => previous && { ...previous, content: event.target.value })} required /></label></div><footer className="wa-dialog__footer"><button type="button" className="wa-button" onClick={() => setEditing(null)}>取消</button><button type="submit" className="wa-button wa-button--primary">保存修改</button></footer></form>
      </Dialog>
    </div>
  );
}
