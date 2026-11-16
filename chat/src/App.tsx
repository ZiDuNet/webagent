import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentJson, agentRequest, type AgentAssistant, type AgentAttachment, type AgentModel, type AgentSession, type AgentStatus, type AgentTool, type AgentToolsResponse, type AgentUser } from "./api/agent";
import { apiErrorMessage, PagePilotApiError, readApiResponse } from "./api/pagepilot";
import { Composer, type AccessMode } from "./components/Composer/Composer";
import { MessageList } from "./components/MessageList/MessageList";
import type { ArtifactAction } from "./components/HtmlArtifactCard/HtmlArtifactCard";
import { PublishedPages } from "./components/PublishedPages/PublishedPages";
import { PublishPageDialog } from "./components/PublishedPages/PublishPageDialog";
import { MemoryDialog } from "./components/Memory/MemoryDialog";
import { SessionList } from "./components/SessionList/SessionList";
import { Dialog } from "./components/ui/Dialog";
import { Icon } from "./components/ui/Icon";
import { EmptyState } from "./components/EmptyState/EmptyState";
import { parseQuickStart } from "./lib/quickStart";
import { VoiceCallDialog, type VoiceCallConfig } from "./components/VoiceCall/VoiceCallDialog";
import { useAgentConversation } from "./hooks/useAgentConversation";
import { useVoiceInput } from "./hooks/useVoiceInput";
import type { ArtifactData, ModelOption, ToolOption } from "./types";
import "./styles/theme.css";
import "./styles/app.css";

export default function App() {
  const [user, setUser] = useState<AgentUser | null>(null);
  const [checkingLogin, setCheckingLogin] = useState(true);
  const [tokenAttempted, setTokenAttempted] = useState(false);
  const [authMode, setAuthMode] = useState<"business" | "token">("business");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<number>();
  const [models, setModels] = useState<AgentModel[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [autoToolCount, setAutoToolCount] = useState(0);
  const [assistants, setAssistants] = useState<AgentAssistant[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [modelId, setModelId] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("confirm");
  const [navOpen, setNavOpen] = useState(false);
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const appliedAssistantRef = useRef<number | undefined>(undefined);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [publishing, setPublishing] = useState<ArtifactData | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const sessionLoadingSeenRef = useRef(false);
  const [voiceInsert, setVoiceInsert] = useState<{ text: string; nonce: number }>();
  const [voiceReset, setVoiceReset] = useState(0);
  const [ttsAutoRead, setTtsAutoRead] = useState(false);
  const [ttsBusy, setTtsBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsGenerationRef = useRef(0);
  const previousStreamingRef = useRef(false);
  const lastSpokenRef = useRef("");
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const adminUrl = import.meta.env.VITE_ADMIN_URL || "/admin/";
  const businessUrl = import.meta.env.VITE_BUSINESS_URL;

  const updateSession = useCallback((session: AgentSession) => {
    setSessions((previous) => previous.map((item) => item.id === session.id ? { ...item, ...session } : item));
  }, []);
  const conversation = useAgentConversation(activeSessionId, updateSession);

  useEffect(() => {
    const controller = new AbortController();
    let tokenFlow = false;
    const initialize = async () => {
      const url = new URL(location.href);
      const accessToken = url.searchParams.get("token");
      if (accessToken) {
        tokenFlow = true;
        setTokenAttempted(true);
        url.searchParams.delete("token");
        history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        await readApiResponse(await fetch("/api/agent/auth/exchange", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        }));
      }
      const result = await agentRequest<{ user: AgentUser; access: { mode: "business" | "token" } }>("/api/agent/me", { signal: controller.signal });
      if (!controller.signal.aborted) {
        setUser(result.user);
        setAuthMode(result.access.mode);
      }
    };
    void initialize()
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && (tokenFlow || !(failure instanceof PagePilotApiError && failure.status === 401))) setLoginError(apiErrorMessage(failure));
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
      setAutoToolCount(0);
      setAssistants([]);
      setSelectedAssistantId(undefined);
      setStatus(null);
      setAttachments([]);
      setEditing(null);
      setError(null);
      setTtsAutoRead(false);
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
        const firstAssistant = assistantResult.items.find((assistant) => assistant.id === sessionResult.items[0]?.assistant_id) ?? assistantResult.items.find((assistant) => assistant.is_default) ?? assistantResult.items[0];
        setSelectedAssistantId(firstAssistant?.id);
        setModelId(String(chatModels.find((model) => model.id === sessionResult.items[0]?.last_model_id)?.id ?? chatModels.find((model) => model.id === firstAssistant?.model_row_id)?.id ?? chatModels.find((model) => model.is_default)?.id ?? chatModels[0]?.id ?? ""));
        setAssistants(assistantResult.items);
        setStatus(statusResult);
        setAccessMode(statusResult.default_approval_mode || "confirm");
        setTtsAutoRead(Boolean(statusResult.tts_auto_read && statusResult.tts?.configured));
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [user]);

  const defaultAssistant = assistants.find((assistant) => assistant.is_default) ?? assistants[0];
  const fixedAssistantId = status?.fixed_assistant_id || (authMode === "token" ? user?.assistant_id : undefined);
  const assistantId = fixedAssistantId || activeSession?.assistant_id || selectedAssistantId || defaultAssistant?.id;
  const activeAssistant = assistants.find((assistant) => assistant.id === assistantId);
  useEffect(() => {
    if (activeAssistant?.allow_model_switch === false && activeAssistant.model_row_id) {
      setModelId(String(activeAssistant.model_row_id));
      setReasoning("");
    }
  }, [activeAssistant?.id, activeAssistant?.model_row_id, activeAssistant?.allow_model_switch]);
  useEffect(() => {
    if (!user || !assistantId) return;
    const controller = new AbortController();
    agentRequest<AgentToolsResponse>(`/api/agent/tools?assistant_id=${assistantId}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setTools(result.items);
        setAutoToolCount(result.auto_enabled_count || 0);
        setToolIds(result.items.filter((tool) => tool.default_selected).map((tool) => tool.name));
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)));
    return () => controller.abort();
  }, [user, assistantId]);
  useEffect(() => {
    if (!user || !assistantId) return;
    const controller = new AbortController();
    agentRequest<AgentStatus>(`/api/agent/status?assistant_id=${assistantId}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setStatus(result);
        if (appliedAssistantRef.current !== assistantId) {
          appliedAssistantRef.current = assistantId;
          setAccessMode(result.default_approval_mode || "confirm");
          setTtsAutoRead(Boolean(result.tts_auto_read && result.tts?.configured));
        }
      })
      .catch((failure: unknown) => !controller.signal.aborted && setError(apiErrorMessage(failure)));
    return () => controller.abort();
  }, [user, assistantId, statusRevision]);

  const createSession = async () => {
    if (!assistantId) { setError("请先选择助手。"); return; }
    const result = await agentJson<{ session: AgentSession }>("/api/agent/sessions", { title: "新对话", assistant_id: assistantId });
    setSessions((previous) => [result.session, ...previous]);
    setActiveSessionId(result.session.id);
    setSelectedAssistantId(result.session.assistant_id || assistantId);
    const assistant = assistants.find((item) => item.id === result.session.assistant_id);
    setModelId(String(assistant?.model_row_id || models.find((item) => item.is_default)?.id || models[0]?.id || ""));
    setReasoning("");
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
    // 先清空输入区，图片预览已经跟随消息进入对话流，避免流式期间附件仍然挂在输入框上。
    const pending = attachments;
    setAttachments([]);
    await conversation.send(text, { modelId: Number(modelId), toolIds, reasoning, accessMode, assistantId: assistantId || undefined, attachments: pending });
    await refreshSessions();
  };

  // 未选中会话时点快捷入口：先建会话，等消息加载完成后再发送，避免加载结果覆盖乐观消息。
  if (conversation.loading) sessionLoadingSeenRef.current = true;
  const startPrompt = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    if (activeSessionId) { await perform(() => send(message)); return; }
    sessionLoadingSeenRef.current = false;
    await perform(async () => { await createSession(); setPendingPrompt(message); });
  };
  useEffect(() => {
    if (!pendingPrompt || conversation.loading || conversation.streaming) return;
    if (!sessionLoadingSeenRef.current || !activeSessionId) return;
    sessionLoadingSeenRef.current = false;
    setPendingPrompt(null);
    void perform(() => send(pendingPrompt));
    // send/perform 每次渲染都会重建，这里只跟随会话与加载状态变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, conversation.loading, conversation.streaming, activeSessionId]);
  const stopSpeaking = useCallback(() => {
    ttsGenerationRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ""; audioRef.current = null; }
    setTtsBusy(false);
  }, []);
  const speakText = useCallback(async (text: string) => {
    if (!status?.tts?.configured || !text.trim()) return;
    stopSpeaking();
    const generation = ttsGenerationRef.current;
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setTtsBusy(true);
    try {
      const response = await fetch("/api/agent/audio/speech", {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "audio/*" },
        body: JSON.stringify({ text: text.slice(0, status.tts_max_read_chars || 1200), assistant_id: assistantId }),
      });
      if (generation !== ttsGenerationRef.current) return;
      if (!response.ok) { await readApiResponse(response); return; }
      const url = URL.createObjectURL(await response.blob());
      if (generation !== ttsGenerationRef.current) { URL.revokeObjectURL(url); return; }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; if (generation === ttsGenerationRef.current) setTtsBusy(false); };
      audio.onerror = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; if (generation === ttsGenerationRef.current) setTtsBusy(false); };
      try { await audio.play(); } catch (failure) {
        if (generation !== ttsGenerationRef.current || controller.signal.aborted) return;
        throw failure;
      }
    } catch (failure) {
      if (controller.signal.aborted || generation !== ttsGenerationRef.current) return;
      setTtsBusy(false);
      setError(apiErrorMessage(failure));
    }
  }, [assistantId, status?.tts?.configured, status?.tts_max_read_chars, stopSpeaking]);
  const voiceInputMode = status?.voice_input_mode || "auto";
  const voiceRealtime = Boolean(status?.asr_realtime?.configured && voiceInputMode !== "file");
  const voiceFile = Boolean(status?.asr?.configured && voiceInputMode !== "realtime");
  const voiceInputAvailable = Boolean(activeSessionId && (voiceRealtime || voiceFile));
  const voice = useVoiceInput((text) => {
    // 自动发送时只把文字交给会话，不再回填输入框，避免同一句话显示两遍。
    if (status?.voice_auto_send === true) { setVoiceReset((value) => value + 1); void send(text); return; }
    setVoiceInsert({ text, nonce: Date.now() });
  }, Boolean((voiceRealtime || voiceFile) && activeSessionId), activeSessionId, {
    realtime: voiceRealtime,
    assistantId,
  });

  useEffect(() => {
    const justFinished = previousStreamingRef.current && !conversation.streaming;
    previousStreamingRef.current = conversation.streaming;
    if (!justFinished || !ttsAutoRead) return;
    const latest = [...conversation.messages].reverse().find((message) => message.role === "assistant" && !message.streaming);
    const text = latest?.parts.filter((part) => part.kind === "markdown").map((part) => part.kind === "markdown" ? part.content : "").join("\n").trim();
    if (!text || text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    void speakText(text);
  }, [conversation.messages, conversation.streaming, speakText, ttsAutoRead]);

  useEffect(() => {
    if (!conversation.answerVersion || !ttsAutoRead) return;
    const latest = [...conversation.messages].reverse().find((message) => message.role === "assistant" && !message.streaming);
    const text = latest?.parts.filter((part) => part.kind === "markdown").map((part) => part.kind === "markdown" ? part.content : "").join("\n").trim();
    if (!text || text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;
    void speakText(text);
  }, [conversation.answerVersion, conversation.messages, speakText, ttsAutoRead]);

  const toggleTts = () => {
    if (!status?.tts?.configured) return;
    if (ttsAutoRead) {
      setTtsAutoRead(false);
      stopSpeaking();
      return;
    }
    // 只朗读开启之后的新回答：把当前最后一条记为基线，不回读历史消息。
    const latest = [...conversation.messages].reverse().find((message) => message.role === "assistant" && !message.streaming);
    const text = latest?.parts.filter((part) => part.kind === "markdown").map((part) => part.kind === "markdown" ? part.content : "").join("\n").trim();
    lastSpokenRef.current = text || "";
    setTtsAutoRead(true);
    setToast("自动朗读已开启，从下一条回答开始播放");
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    lastSpokenRef.current = "";
    stopSpeaking();
  }, [activeSessionId, stopSpeaking]);
  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    if (attachments.length + files.length > 4) throw new Error("每条消息最多添加 4 张图片。");
    const existingSize = attachments.reduce((total, item) => total + (item.size ?? (item.data_url ? atob(item.data_url.split(",")[1] || "").length : 0)), 0);
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

  const selectableModels = activeAssistant?.allow_model_switch === false && activeAssistant.model_row_id ? models.filter((model) => model.id === activeAssistant.model_row_id) : models;
  const modelOptions: ModelOption[] = selectableModels.map((model) => ({ id: String(model.id), name: model.name, contextWindow: model.context_window, supportsReasoning: model.supports_reasoning, reasoningEfforts: model.reasoning_efforts, defaultReasoningEffort: model.default_reasoning_effort }));
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
  };

  if (checkingLogin) return <div className="app-auth"><Icon name="loader" className="wa-spinner" size={26} /><p>正在检查业务系统登录态…</p></div>;
  if (!user && tokenAttempted) return (
    <main className="app-auth">
      <section className="app-login">
        <span className="brand__mark">WA</span>
        <h1>接入 Token 无效</h1>
        <p>{loginError || "Token 已停用、过期或不允许当前来源。请联系管理员轮换或检查 Origin 限制。"}</p>
        <small>Token Chat 不显示业务账号登录表单。管理员可在「接入与安全」重新签发 Token。</small>
        <a className="wa-button" href="/admin/?page=access">前往管理端</a>
      </section>
    </main>
  );
  if (!user) return (
    <main className="app-auth">
      <section className="app-login">
        <span className="brand__mark">WA</span>
        <h1>需要业务登录态或接入 Token</h1>
        <p>Chat 不提供独立的账号密码。集成到业务系统时由宿主登录态自动识别；单独部署时请在管理端「接入与安全」签发 Token，再用 <code>/chat/?token=…</code> 打开。</p>
        {loginError && <p className="wa-error" role="alert">{loginError}</p>}
        <div className="control-actions">
          <a className="wa-button wa-button--primary" href="/admin/?page=access">前往管理端签发 Token</a>
          <button type="button" className="wa-button" onClick={() => location.reload()}>重试</button>
        </div>
        <small>管理端账号与业务账号彼此独立：管理端只用于配置运行时，不能代替业务身份进入 Chat。</small>
      </section>
    </main>
  );

  const chooseSession = (id: string) => {
    setActiveSessionId(id);
    setNavOpen(false);
    const session = sessions.find((item) => item.id === id);
    if (session?.assistant_id) setSelectedAssistantId(session.assistant_id);
    const assistant = assistants.find((item) => item.id === session?.assistant_id);
    const preferredId = assistant?.allow_model_switch === false ? assistant.model_row_id : session?.last_model_id || assistant?.model_row_id;
    setModelId(String(models.find((item) => item.id === preferredId)?.id || models.find((item) => item.is_default)?.id || models[0]?.id || ""));
    setReasoning("");
  };

  const changeAssistant = async (nextId: number) => {
    if (fixedAssistantId) return;
    const next = assistants.find((assistant) => assistant.id === nextId);
    if (!next) return;
    if (activeSession && activeSession.assistant_id !== nextId) {
      if (!window.confirm(`切换到「${next.name}」会重建当前会话的 PI 上下文。聊天记录和已执行操作会保留，是否继续？`)) return;
      const result = await agentJson<{ session: AgentSession }>(`/api/agent/sessions/${encodeURIComponent(activeSession.id)}`, { assistant_id: nextId }, "PATCH");
      updateSession(result.session);
      conversation.refresh();
    }
    setSelectedAssistantId(nextId);
    const preferredModel = next.allow_model_switch === false ? next.model_row_id : next.model_row_id || models.find((model) => model.is_default)?.id;
    setModelId(String(models.find((model) => model.id === preferredModel)?.id || models[0]?.id || ""));
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
  const totalTokens = Math.max(1200, cappedWindow - Math.min(selectedModel?.max_output_tokens || 0, Math.floor(cappedWindow / 2)) - (status?.context_reserve_tokens ?? 1600));
  const displayedError = error || conversation.error || voice.error;
  const quickStart = parseQuickStart(status?.welcome_prompts);
  const compactCurrent = () => perform(async () => {
    const result = await agentJson<{ skipped?: boolean; message?: string }>(`/api/agent/sessions/${encodeURIComponent(activeSessionId || "")}/compact`, { model_row_id: Number(modelId) || undefined });
    conversation.refresh();
    setToast(result?.skipped ? result.message || "当前上下文无需压缩" : "上下文已压缩，历史消息仍保留在会话文件里");
  });
  const refreshCurrent = () => perform(async () => { await refreshSessions(); conversation.refresh(); });
  const voiceCallConfig: VoiceCallConfig | null = activeSessionId ? {
    sessionId: activeSessionId,
    assistantId: activeAssistant?.id,
    modelId: Number(modelId) || undefined,
    toolIds,
    reasoning,
    accessMode,
  } : null;
  const voiceCallAvailable = Boolean(activeSessionId && status?.voice_asr?.configured && status?.voice_tts?.configured);
  const voiceCallReason = !activeSessionId
    ? "请先新建或选择一个会话"
    : !status?.voice_asr?.configured
      ? status?.voice_asr?.reason || "管理员尚未配置实时通话 STT 模型"
      : !status?.voice_tts?.configured
        ? status?.voice_tts?.reason || "管理员尚未配置实时通话 TTS 模型"
        : "语音通话绑定当前会话与权限";

  return (
    <div className="app-shell">
      {navOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭侧边栏" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? "is-open" : ""}`}>
        <div className="brand"><span className="brand__mark">WA</span><span className="brand__name">WebAgent</span><span className="brand__badge">PI</span></div>
        <label className="sidebar-assistant">
          <span>当前助手</span>
          <select
            aria-label="选择助手"
            value={assistantId || ""}
            disabled={Boolean(fixedAssistantId) || conversation.streaming || !assistants.length}
            onChange={(event) => void perform(() => changeAssistant(Number(event.target.value)))}
          >
            {assistants.map((assistant) => <option value={assistant.id} key={assistant.id}>{assistant.name}{assistant.is_default ? " · 默认" : ""}</option>)}
          </select>
          <small>{fixedAssistantId ? "接入 Token 已固定此助手，不能切换" : activeAssistant?.description || "新建会话将使用此助手"}</small>
        </label>
        <button type="button" className="new-chat" disabled={loading || conversation.streaming || !assistants.length} onClick={() => void perform(createSession)}><Icon name="plus" size={14} />新建对话</button>
        <label className="sidebar-search"><Icon name="search" size={13} /><input placeholder="搜索会话" aria-label="搜索会话" value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} /></label>
        <div className="sidebar__scroll"><SessionList sessions={sessions.filter((session) => session.title.includes(sessionQuery)).map((session) => ({ id: session.id, title: session.title, meta: session.assistant_name }))} activeId={activeSessionId} onSelect={chooseSession} onFork={(id) => void perform(() => fork(id))} onRename={(id, title) => void perform(async () => { await agentJson(`/api/agent/sessions/${encodeURIComponent(id)}`, { title }, "PATCH"); await refreshSessions(); })} onDelete={(id) => void perform(async () => { await agentRequest(`/api/agent/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); const next = await refreshSessions(); if (id === activeSessionId) setActiveSessionId(next[0]?.id); })} /></div>
        <div className="sidebar__footer"><div className="account"><span className="account__avatar"><Icon name="user" size={15} /></span><span className="account__text"><strong>{user.display_name || user.username}</strong><small>{authMode === "token" ? "匿名接入 Token" : user.role || "当前业务账号"}</small></span>{authMode === "token" && <button type="button" className="account__button" aria-label="退出登录" title="退出匿名接入会话" onClick={() => void perform(async () => { if (authMode === "token") await agentRequest("/api/agent/auth/logout", { method: "POST" }); setUser(null); setActiveSessionId(undefined); setPublishedOpen(false); setPublishing(null); })}><Icon name="external" size={15} /></button>}</div></div>
      </aside>
      <main className="workspace">
        <header className="workspace__header">
          <button type="button" className="header-icon-button mobile-nav-button" aria-label="打开侧边栏" onClick={() => setNavOpen(true)}><Icon name="menu" size={16} /></button>
          <div className="workspace__identity"><span className="workspace__avatar"><Icon name="sparkles" size={16} /></span><div className="workspace__title"><strong>{activeSession?.title || activeAssistant?.name || "智能助手"}</strong><span><i />{authMode === "token" ? "接入 Token · 匿名会话" : "业务账号已连接"}</span></div></div>
          <div className="workspace__actions">
            <button type="button" className={`header-button ${ttsAutoRead ? "is-active" : ""}`} aria-label="自动朗读回答" title={status?.tts?.configured ? (ttsAutoRead ? "关闭自动朗读" : "自动朗读最终回答（过滤代码和 HTML）") : status?.tts?.reason || "管理员尚未配置 TTS 模型"} disabled={!status?.tts?.configured} onClick={toggleTts}><Icon name="audio-lines" size={14} /><span>{ttsBusy ? "朗读中" : ttsAutoRead ? "朗读已开" : "朗读"}</span></button>
            <button type="button" className="header-button header-voice-button" aria-label="语音通话" title={voiceCallReason} disabled={!voiceCallAvailable || conversation.streaming} onClick={() => { stopSpeaking(); setVoiceCallOpen(true); }}><Icon name="audio-lines" size={14} /><span>语音通话</span></button>
            <button type="button" className="header-button" aria-label="记忆" title={status?.memory?.pending ? `我的长期记忆（${status.memory.pending} 条待确认）` : "我的长期记忆"} onClick={() => setMemoryOpen(true)}><Icon name="sparkles" size={14} /><span>记忆</span>{Boolean(status?.memory?.count) && <i className="header-count">{status!.memory!.count}</i>}{Boolean(status?.memory?.pending) && <i className="header-count header-count--pending">{status!.memory!.pending}</i>}</button>
            <button type="button" className="header-button" aria-label="已发布" title="我的已发布页面" onClick={() => setPublishedOpen(true)}><Icon name="globe" size={14} /><span>已发布</span></button>
            <button type="button" className="header-icon-button header-desktop-only" disabled={conversation.streaming || !activeSessionId} aria-label="压缩上下文" title="压缩上下文" onClick={() => void compactCurrent()}><Icon name="layers" size={15} /></button>
            <button type="button" className="header-icon-button header-desktop-only" disabled={conversation.streaming} aria-label="刷新会话" onClick={() => void refreshCurrent()}><Icon name="refresh" size={15} /></button>
            <a className="header-icon-button header-desktop-only" aria-label="独立管理控制台" title="管理端（需单独登录）" href={adminUrl} target="_blank" rel="noopener noreferrer"><Icon name="settings" size={15} /></a>
            {businessUrl && <a className="header-icon-button header-desktop-only" aria-label="返回业务系统" title="业务系统" href={businessUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /></a>}
            <button type="button" className="header-icon-button mobile-actions-button" aria-label="更多会话操作" aria-haspopup="dialog" onClick={() => setMoreActionsOpen(true)}><Icon name="chevron-down" size={16} /></button>
          </div>
        </header>
        <div className="workspace__body">
          {(loading || conversation.loading) && <p className="app-loading" role="status"><Icon name="loader" className="wa-spinner" size={14} />正在读取会话…</p>}
          {displayedError && <p className="wa-error app-error" role="alert">{displayedError}</p>}
          <MessageList messages={conversation.messages} onApprove={(_, id) => void perform(() => conversation.approve(id, true))} onReject={(_, id) => void perform(() => conversation.approve(id, false))} onAnswerQuestion={(_, id, values, freeText) => void perform(() => conversation.answerQuestion(id, values, freeText))} onCancelQuestion={(_, id) => void perform(() => conversation.cancelQuestion(id))} onForkMessage={(id) => activeSessionId && void perform(() => fork(activeSessionId, id))} onEditMessage={(id) => { const message = conversation.messages.find((item) => item.id === id); setEditing({ id, content: message?.parts.filter((part) => part.kind === "markdown").map((part) => part.kind === "markdown" ? part.content : "").join("\n") || "" }); }} onDeleteMessage={(id) => void perform(async () => { await agentRequest(`/api/agent/sessions/${encodeURIComponent(activeSessionId || "")}/messages/${encodeURIComponent(id)}`, { method: "DELETE" }); conversation.refresh(); })} onArtifactAction={artifactAction} emptyState={<EmptyState title={status?.welcome_title || "有什么我能帮你的吗？"} subtitle={activeSessionId ? status?.welcome_subtitle || "模型、工具和操作权限来自当前业务账号，生成的页面可以随时发布。" : "选一个下面的入口直接开始，也可以先手动新建对话。"} prompts={quickStart} logo={status?.welcome_logo || undefined} onPick={(text) => void startPrompt(text)} />} />
          <div className="composer-zone">
            {attachments.length > 0 && <div className="app-attachments">{attachments.map((attachment, index) => <button type="button" key={`${attachment.name}-${index}`} aria-label={`移除图片 ${attachment.name}`} onClick={() => setAttachments((previous) => previous.filter((_, position) => position !== index))}><Icon name="image" size={13} />{attachment.name}<Icon name="x" size={12} /></button>)}</div>}
            <Composer
              models={modelOptions}
              selectedModelId={modelId}
              onModelChange={(id) => { setModelId(id); setReasoning(""); }}
              tools={toolOptions}
              autoEnabledCount={autoToolCount}
              selectedToolIds={toolIds}
              onToolsChange={setToolIds}
              onSend={(text) => void perform(() => send(text))}
              onStop={() => void conversation.stop()}
              streaming={conversation.streaming}
              disabled={loading || !activeSessionId || !models.length}
              placeholder={!activeSessionId ? "新建或选择一个会话后输入消息" : undefined}
              accessMode={accessMode}
              onAccessModeChange={setAccessMode}
              allowFullAccess={status?.allow_full_access}
              showReasoning
              selectedReasoning={reasoning}
              onReasoningChange={setReasoning}
              voiceEnabled={voiceInputAvailable}
              voiceDisabledReason={!activeSessionId ? "请先新建或选择一个会话" : voiceInputMode === "realtime" ? status?.asr_realtime?.reason || "管理员尚未配置实时语音识别模型" : status?.asr?.reason || status?.asr_realtime?.reason || "管理员尚未配置可用语音识别模型"}
              voiceBusy={voice.busy}
              recording={voice.recording}
              voiceRealtime={voiceRealtime}
              onVoiceToggle={() => { stopSpeaking(); void voice.toggle(); }}
              voiceInsert={voiceInsert}
              voiceReset={voiceReset}
              voicePartial={voiceRealtime ? voice.partial : ""}
              onAttach={(files) => void perform(() => addAttachments(files))}
              contextInfo={{ usedTokens: conversation.contextTokens, totalTokens }}
              note={voice.recording
                ? voiceRealtime
                  ? "正在实时听写，文字会持续填入输入框；点击停止后提交，最长 60 秒"
                  : "正在录音，点击停止后识别并填入输入框；最长 60 秒"
                : "工具调用继承当前账号权限"}
            />
          </div>
        </div>
      </main>
      <PublishedPages open={publishedOpen} onOpenChange={setPublishedOpen} currentSessionId={activeSessionId} sessions={sessions} currentHtml={currentHtml} onOpenSession={chooseSession} />
      <MemoryDialog open={memoryOpen} onOpenChange={(open) => { setMemoryOpen(open); if (!open) setStatusRevision((value) => value + 1); }} autoExtract={status?.memory?.auto_extract} autoConfirm={status?.memory?.auto_confirm} authMode={authMode} onChanged={() => setStatusRevision((value) => value + 1)} />
      <VoiceCallDialog open={voiceCallOpen} config={voiceCallConfig} onClose={() => { setVoiceCallOpen(false); void refreshCurrent(); }} />
      {toast && <div className="toast" role="status"><Icon name="check-circle" size={13} />{toast}</div>}
      <Dialog open={moreActionsOpen} onOpenChange={setMoreActionsOpen} title="会话操作" description="压缩只改变模型上下文，不会删除聊天记录。">
        <div className="wa-dialog__body mobile-session-actions">
          <button type="button" className="wa-button" disabled={conversation.streaming || !activeSessionId} onClick={() => { setMoreActionsOpen(false); void compactCurrent(); }}><Icon name="layers" size={16} />压缩上下文</button>
          <button type="button" className="wa-button" disabled={conversation.streaming} onClick={() => { setMoreActionsOpen(false); void refreshCurrent(); }}><Icon name="refresh" size={16} />刷新会话</button>
          <a className="wa-button" href={adminUrl} target="_blank" rel="noopener noreferrer"><Icon name="settings" size={16} />独立管理控制台</a>
          {businessUrl && <a className="wa-button" href={businessUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} />返回业务系统</a>}
        </div>
      </Dialog>
      {publishing && <PublishPageDialog open onOpenChange={(next) => !next && setPublishing(null)} html={publishing.html} title={publishing.title} description={publishing.description} sessionId={activeSessionId} />}
      <Dialog open={Boolean(editing)} onOpenChange={(next) => !next && setEditing(null)} title="编辑用户消息" description="此消息之后的对话和摘要将被清除；不会自动撤销或重放已执行的业务操作。">
        <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { if (!editing?.content.trim()) return; await agentJson(`/api/agent/sessions/${encodeURIComponent(activeSessionId || "")}/messages/${editing.id}`, { content: editing.content }, "PATCH"); setEditing(null); conversation.refresh(); }); }} className="publish-form"><div className="wa-dialog__body"><label className="wa-field"><span>消息内容</span><textarea rows={7} value={editing?.content || ""} onChange={(event) => setEditing((previous) => previous && { ...previous, content: event.target.value })} required /></label></div><footer className="wa-dialog__footer"><button type="button" className="wa-button" onClick={() => setEditing(null)}>取消</button><button type="submit" className="wa-button wa-button--primary">保存修改</button></footer></form>
      </Dialog>
    </div>
  );
}
