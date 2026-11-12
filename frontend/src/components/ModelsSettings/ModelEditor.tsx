import { useEffect, useRef, useState } from "react";
import { Alert, AutoComplete, Button, Checkbox, Collapse, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag } from "antd";
import { CircleStop, Download, KeyRound, RefreshCw, Save, Settings2 } from "lucide-react";
import { apiErrorMessage } from "../../api/pagepilot";
import { jsonObject, modelKindLabel, modelsRequest, type ConfiguredModel, type ModelKind, type ModelPreset, type ModelProvider } from "./modelsApi";

export interface DecisionPresetDraft {
  id: string;
  name: string;
  base_url: string;
  model_id: string;
  protocol: "decisions" | "chat_completions";
  endpoint: string;
}

interface ModelEditorProps {
  baseUrl: string;
  model?: ConfiguredModel;
  initialKind: ModelKind;
  initialProviderId?: number;
  decisionPreset?: DecisionPresetDraft;
  providers: ModelProvider[];
  presets: ModelPreset[];
  onClose: () => void;
  onSaved: () => void;
  onEditProvider: (provider?: ModelProvider) => void;
}

interface ModelValues {
  provider_id: number;
  name: string;
  model_id: string;
  model_kind: ModelKind;
  enabled: boolean;
  is_default: boolean;
  capabilities: ("text" | "image")[];
  supports_tools: boolean;
  context_window: number;
  max_output_tokens: number;
  temperature: number;
  top_p: number;
  input_price_per_1m: number;
  output_price_per_1m: number;
  supports_reasoning: boolean;
  reasoning_efforts: string[];
  default_reasoning_effort: string;
  supports_reasoning_summary: boolean;
  metadata_source: string;
  extra_json: string;
  asr_protocol: string;
  asr_endpoint: string;
  asr_language: string;
  tts_protocol: "openai" | "dashscope";
  tts_endpoint: string;
  tts_voice: string;
  tts_format: string;
  tts_speed: number;
  decision_protocol: "decisions" | "chat_completions";
  decision_endpoint: string;
  decision_preset: string;
}

const KINDS: ModelKind[] = ["chat", "vision", "asr", "asr_realtime", "tts", "image_generation", "decision", "embedding", "rerank"];
const REASONING = [{ value: "off", label: "关闭思考" }, { value: "none", label: "None" }, { value: "minimal", label: "最少" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }, { value: "xhigh", label: "极高" }];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ttsDefaults(protocol: string, id: string, endpoint = "") {
  const nativeAudio = /speechsynthesizer\/?$/i.test(endpoint) || (!/multimodal-generation\/generation\/?$/i.test(endpoint) && /qwen-audio-?3/i.test(id));
  const dashscope = protocol === "dashscope";
  return {
    voice: dashscope ? nativeAudio ? "longanhuan_v3.1" : "Cherry" : "alloy",
    formats: dashscope ? nativeAudio ? ["mp3", "wav", "pcm", "opus"] : ["wav"] : ["mp3", "opus", "aac", "flac", "wav", "pcm"],
    min: dashscope ? nativeAudio ? .5 : 1 : .25,
    max: dashscope ? nativeAudio ? 2 : 1 : 4,
    limit: dashscope && !nativeAudio ? 600 : 4000,
    format: dashscope ? "wav" : "mp3",
  };
}

export function ModelEditor({ baseUrl, model, initialKind, initialProviderId, decisionPreset, providers, presets, onClose, onSaved, onEditProvider }: ModelEditorProps) {
  const [form] = Form.useForm<ModelValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupNote, setLookupNote] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [remoteModels, setRemoteModels] = useState<{ model_id: string; name?: string }[]>([]);
  const discoverRef = useRef<AbortController | null>(null);
  const suggestRef = useRef<AbortController | null>(null);
  const kindChosenRef = useRef(false);
  const ttsConfiguredRef = useRef(Boolean(model));
  const providerId = Form.useWatch("provider_id", form) as number | undefined;
  const kind = (Form.useWatch("model_kind", form) || model?.model_kind || initialKind) as ModelKind;
  const modelId = (Form.useWatch("model_id", form) || "") as string;
  const ttsProtocol = (Form.useWatch("tts_protocol", form) || "openai") as string;
  const ttsEndpoint = (Form.useWatch("tts_endpoint", form) || "") as string;
  const reasoningEnabled = Form.useWatch("supports_reasoning", form);
  const reasoningEfforts = (Form.useWatch("reasoning_efforts", form) || []) as string[];
  const decisionProtocol = Form.useWatch("decision_protocol", form);
  const provider = providers.find((item) => item.id === providerId);
  const isChat = kind === "chat" || kind === "vision";
  const isAsr = kind === "asr" || kind === "asr_realtime";
  const tts = ttsDefaults(ttsProtocol, modelId, ttsEndpoint);
  const initialExtra = objectValue(model?.extra_params);
  const initialAsr = objectValue(initialExtra._asr);
  const initialTts = objectValue(initialExtra._tts);
  const initialTtsProtocol = String(initialTts.protocol || (/qwen.*tts/i.test(model?.model_id || "") ? "dashscope" : "openai"));
  const initialDecision = objectValue(initialExtra._decision);
  const advancedExtra = { ...initialExtra };
  delete advancedExtra._asr;
  delete advancedExtra._tts;
  delete advancedExtra._decision;

  useEffect(() => {
    discoverRef.current?.abort();
    suggestRef.current?.abort();
    setRemoteModels([]);
    setLookupError("");
    setLookupNote("");
    setDiscovering(false);
    setSuggesting(false);
    return () => { discoverRef.current?.abort(); suggestRef.current?.abort(); };
  }, [providerId]);

  useEffect(() => {
    if (!form.getFieldValue("provider_id") && providers.length === 1) form.setFieldValue("provider_id", providers[0].id);
  }, [providers, form]);

  useEffect(() => {
    if (initialProviderId) form.setFieldValue("provider_id", initialProviderId);
  }, [initialProviderId, form]);

  useEffect(() => {
    if (ttsConfiguredRef.current || kind !== "tts" || !modelId.trim()) return;
    const protocol = /qwen.*tts/i.test(modelId) ? "dashscope" : "openai";
    const defaults = ttsDefaults(protocol, modelId);
    form.setFieldsValue({ tts_protocol: protocol, tts_voice: defaults.voice, tts_format: defaults.format, tts_speed: 1 });
  }, [kind, modelId, model, form]);

  const discover = async () => {
    if (!providerId) return;
    discoverRef.current?.abort();
    const controller = new AbortController();
    discoverRef.current = controller;
    setDiscovering(true);
    setLookupError("");
    setLookupNote("");
    try {
      const result = await modelsRequest<{ items: { model_id: string; name?: string }[] }>(baseUrl, `/admin/providers/${providerId}/discover-models`, { signal: controller.signal }, 12_000);
      if (controller.signal.aborted) return;
      setRemoteModels(result.items || []);
      setLookupNote(`已读取 ${result.items.length} 个模型，点击模型 ID 输入框选择。只读取列表，不会自动创建模型。`);
    } catch (failure) {
      if (!controller.signal.aborted) setLookupError(apiErrorMessage(failure));
    } finally {
      if (discoverRef.current === controller) setDiscovering(false);
    }
  };

  const suggest = async () => {
    if (!modelId.trim()) { setLookupError("请先填写模型 ID。"); return; }
    suggestRef.current?.abort();
    const controller = new AbortController();
    suggestRef.current = controller;
    setSuggesting(true);
    setLookupError("");
    setLookupNote("");
    try {
      const params = new URLSearchParams({ model_id: modelId.trim() });
      if (providerId) params.set("provider_id", String(providerId));
      const result = await modelsRequest<{ suggested: Partial<ConfiguredModel> }>(baseUrl, `/admin/model-suggest?${params}`, { signal: controller.signal }, 12_000);
      if (controller.signal.aborted || form.getFieldValue("model_id")?.trim() !== modelId.trim()) return;
      const values = result.suggested;
      const supported = ["capabilities", "supports_tools", "context_window", "max_output_tokens", "temperature", "top_p", "input_price_per_1m", "output_price_per_1m", "supports_reasoning", "reasoning_efforts", "default_reasoning_effort", "supports_reasoning_summary", "metadata_source"] as const;
      for (const key of supported) if (values[key] !== undefined) form.setFieldValue(key, values[key]);
      if (!model && values.model_kind && !decisionPreset && !kindChosenRef.current && ["chat", "vision"].includes(initialKind)) form.setFieldValue("model_kind", values.model_kind);
      if (!form.getFieldValue("name")) form.setFieldValue("name", modelId.trim());
      if (!ttsConfiguredRef.current && (values.model_kind === "tts" || kind === "tts")) {
        const protocol = /qwen.*tts/i.test(modelId) ? "dashscope" : "openai";
        const defaults = ttsDefaults(protocol, modelId);
        form.setFieldsValue({ tts_protocol: protocol, tts_voice: defaults.voice, tts_format: defaults.format, tts_speed: 1 });
      }
      setLookupNote(values.context_window ? `已读取模型元信息（${values.metadata_source || "内置目录"}），请检查后保存。` : "已应用已知模型能力；未查到的上下文、价格等参数请按供应商文档填写，0 表示未指定。");
    } catch (failure) {
      if (!controller.signal.aborted) setLookupError(apiErrorMessage(failure));
    } finally {
      if (suggestRef.current === controller) setSuggesting(false);
    }
  };

  const save = async (submitted: ModelValues) => {
    const values = { ...form.getFieldsValue(true), ...submitted } as ModelValues;
    setError("");
    try {
      if (isChat && values.is_default && !values.enabled) throw new Error("默认对话模型需要保持启用，请先启用模型或取消默认设置。");
      if (isChat && (!values.capabilities || !values.capabilities.includes("text"))) throw new Error("对话模型需要保留文本输入能力，可额外启用图片。");
      if (isChat && values.supports_reasoning && values.default_reasoning_effort && !(values.reasoning_efforts || []).includes(values.default_reasoning_effort)) throw new Error("模型默认推理等级不在可用等级中，请重新选择。");
      const extra = jsonObject(values.extra_json, "额外参数");
      if (isAsr) extra._asr = { ...initialAsr, protocol: values.asr_protocol, endpoint: values.asr_endpoint?.trim() || "", language: values.asr_language?.trim() || "zh" };
      if (kind === "tts") extra._tts = { ...initialTts, protocol: values.tts_protocol, endpoint: values.tts_endpoint?.trim() || "", voice: values.tts_voice?.trim() || tts.voice, response_format: values.tts_format, speed: values.tts_speed };
      if (kind === "decision") extra._decision = { ...initialDecision, protocol: values.decision_protocol, endpoint: values.decision_endpoint?.trim() || "", preset: values.decision_preset || "custom" };
      const body = {
        provider_id: values.provider_id, name: values.name.trim(), model_id: values.model_id.trim(), model_kind: kind,
        enabled: values.enabled, is_default: isChat && values.is_default, capabilities: isChat ? values.capabilities : ["text"], supports_tools: isChat && values.supports_tools,
        context_window: values.context_window || 0, max_output_tokens: values.max_output_tokens || 0, temperature: values.temperature ?? .3, top_p: values.top_p ?? 1,
        input_price_per_1m: values.input_price_per_1m || 0, output_price_per_1m: values.output_price_per_1m || 0,
        supports_reasoning: isChat && values.supports_reasoning, reasoning_style: "effort", reasoning_efforts: isChat && values.supports_reasoning ? values.reasoning_efforts || [] : [],
        default_reasoning_effort: isChat && values.supports_reasoning ? values.default_reasoning_effort || "" : "", supports_reasoning_summary: values.supports_reasoning_summary,
        supports_transcription: isAsr, metadata_source: values.metadata_source || "manual", extra_params: extra,
      };
      setSaving(true);
      await modelsRequest(baseUrl, `/admin/models${model ? `/${model.id}` : ""}`, { method: model ? "PUT" : "POST", body: JSON.stringify(body) }, 20_000);
      onSaved();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const hintModels = presets.filter((preset) => provider && preset.base_url.replace(/\/$/, "") === provider.base_url.replace(/\/$/, "")).flatMap((preset) => preset.models);
  const choices = [...new Map([...hintModels.map((item) => [item.id, { value: item.id, label: `${item.name || item.id} · 预设示例` }] as const), ...remoteModels.map((item) => [item.model_id, { value: item.model_id, label: item.name && item.name !== item.model_id ? `${item.name} · ${item.model_id}` : item.model_id }] as const)].map(([key, value]) => [key, value])).values()];
  const chooseModel = (value: string) => {
    if (model || decisionPreset) return;
    const hint = hintModels.find((item) => item.id === value);
    if (!hint) return;
    if (!form.getFieldValue("name")) form.setFieldValue("name", hint.name || hint.id);
    if (kindChosenRef.current || !["chat", "vision"].includes(initialKind)) return;
    form.setFieldValue("model_kind", hint.kind);
    if (hint.kind === "vision") form.setFieldValue("capabilities", ["text", "image"]);
  };
  const inferKind = () => {
    if (model || decisionPreset || kindChosenRef.current || !["chat", "vision"].includes(initialKind)) return;
    const lower = modelId.toLowerCase();
    const inferred = /tts|text-to-speech|cosyvoice/.test(lower) ? "tts" : /asr|transcri|whisper/.test(lower) ? /realtime|real-time/.test(lower) ? "asr_realtime" : "asr" : /embedding|text-embed/.test(lower) ? "embedding" : /rerank/.test(lower) ? "rerank" : /gpt-image|dall-e|flux|stable-diffusion/.test(lower) ? "image_generation" : null;
    if (inferred) form.setFieldValue("model_kind", inferred);
  };

  return <Modal open title={<span className="ms-modal-title"><Settings2 size={19} />{model ? "编辑模型" : "添加模型"}</span>} onCancel={onClose} maskClosable={!saving} keyboard={!saving} closable={!saving} width={760} className="ms-modal ms-model-editor" footer={<><Button onClick={onClose} disabled={saving}>取消</Button><Button type="primary" icon={<Save size={15} />} loading={saving} onClick={() => form.submit()}>保存模型</Button></>}>
    <p className="ms-dialog-intro">选择供应商连接，再选择或输入模型 ID。拉取和同步只在点击时执行。</p>
    <Form form={form} layout="vertical" disabled={saving} requiredMark="optional" scrollToFirstError onValuesChange={(changedValues: Partial<ModelValues>) => { if (Object.keys(changedValues).some((key) => key.startsWith("tts_"))) ttsConfiguredRef.current = true; }} onFinish={(values) => void save(values)} initialValues={{ ...model, provider_id: model?.provider_id || initialProviderId || (providers.length === 1 ? providers[0].id : undefined), name: model?.name || (decisionPreset ? `${decisionPreset.name} 决策模型` : ""), model_id: model?.model_id || decisionPreset?.model_id || "", model_kind: model?.model_kind || initialKind, enabled: model?.enabled ?? true, is_default: model?.is_default ?? false, capabilities: model?.capabilities || ["text"], supports_tools: model?.supports_tools ?? initialKind === "chat", context_window: model?.context_window || 0, max_output_tokens: model?.max_output_tokens || 0, temperature: model?.temperature ?? .3, top_p: model?.top_p ?? 1, input_price_per_1m: model?.input_price_per_1m || 0, output_price_per_1m: model?.output_price_per_1m || 0, supports_reasoning: model?.supports_reasoning ?? false, reasoning_efforts: model?.reasoning_efforts || [], default_reasoning_effort: model?.default_reasoning_effort || "", supports_reasoning_summary: model?.supports_reasoning_summary ?? true, metadata_source: model?.metadata_source || "manual", extra_json: JSON.stringify(advancedExtra, null, 2), asr_protocol: String(initialAsr.protocol || "auto"), asr_endpoint: String(initialAsr.endpoint || ""), asr_language: String(initialAsr.language || "zh"), tts_protocol: initialTtsProtocol, tts_endpoint: String(initialTts.endpoint || ""), tts_voice: String(initialTts.voice || ttsDefaults(initialTtsProtocol, model?.model_id || "").voice), tts_format: String(initialTts.response_format || ttsDefaults(initialTtsProtocol, model?.model_id || "").format), tts_speed: Number(initialTts.speed || 1), decision_protocol: initialDecision.protocol || decisionPreset?.protocol || "chat_completions", decision_endpoint: initialDecision.endpoint || decisionPreset?.endpoint || "", decision_preset: initialDecision.preset || decisionPreset?.id || "custom" }}>
      <Form.Item name="provider_id" label="供应商连接" rules={[{ required: true, message: "请选择或先创建供应商连接" }]}><Select placeholder="请选择已保存的连接" options={providers.map((item) => ({ value: item.id, label: `${item.name} · ${item.base_url}${item.enabled ? "" : "（已停用）"}` }))} showSearch optionFilterProp="label" /></Form.Item>
      <div className="ms-connection-preview"><div><span><span className={`ms-status-dot ${provider?.enabled ? "is-on" : ""}`} />{provider?.name || "尚未选择连接"}</span><code>{provider?.base_url || "新增连接后可在多个模型间复用"}</code><small><KeyRound size={12} />{provider?.api_key_set ? `已保存 ${provider.api_key_masked}` : "未设置 API Key"}{provider ? ` · 超时 ${provider.timeout_seconds}s` : ""}</small></div><Button size="small" onClick={() => onEditProvider(provider)} icon={<Settings2 size={13} />}>{provider ? "编辑连接" : "新增连接"}</Button></div>
      <div className="ms-form-grid"><Form.Item name="model_kind" label="模型类型" rules={[{ required: true }]}><Select options={KINDS.map((value) => ({ value, label: modelKindLabel(value) }))} onChange={() => { kindChosenRef.current = true; }} /></Form.Item><Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true, message: "请填写模型名称" }]}><Input placeholder="例如：业务助手 / 语音转写" maxLength={80} /></Form.Item></div>
      <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, whitespace: true, message: "请选择或填写模型 ID" }]} extra="支持下拉选择或直接输入；预设示例不代表供应商已开通此模型。"><AutoComplete options={choices} placeholder="选择或直接填写模型 ID" onSelect={chooseModel} onBlur={inferKind} filterOption={(input, option) => String(option?.value || "").toLowerCase().includes(input.toLowerCase())} /></Form.Item>
      <div className="ms-lookup-actions"><Space wrap><Button icon={<Download size={14} />} loading={discovering} disabled={!providerId || suggesting} onClick={() => void discover()}>拉取供应商模型</Button><Button icon={<RefreshCw size={14} />} loading={suggesting} disabled={!modelId.trim() || discovering} onClick={() => void suggest()}>同步模型信息到表单</Button>{(discovering || suggesting) && <Button icon={<CircleStop size={14} />} onClick={() => { discoverRef.current?.abort(); suggestRef.current?.abort(); setDiscovering(false); setSuggesting(false); setLookupNote("已取消读取，可直接填写并保存。"); }}>取消读取</Button>}</Space><small>12 秒超时，可随时取消</small></div>
      {lookupError && <Alert type="warning" showIcon title={lookupError} closable onClose={() => setLookupError("")} />}
      {lookupNote && <Alert type="info" showIcon title={lookupNote} closable onClose={() => setLookupNote("")} />}
      <div className="ms-form-grid ms-model-switches"><Form.Item name="enabled" label="启用模型" valuePropName="checked"><Switch /></Form.Item>{isChat && <Form.Item name="is_default" label="默认对话模型" valuePropName="checked"><Switch /></Form.Item>}</div>
      {isAsr && <section className="ms-editor-section"><h3>STT · 语音识别</h3>{kind === "asr_realtime" ? <Alert type="warning" showIcon title="已预留实时识别类型，当前浏览器录音使用文件转写，尚未实现 WebSocket 实时会话。请勿将实时模型设为文件识别默认模型。" /> : <p>识别完成后直接发送文本。Qwen ASR 可选择 Chat Audio 或 DashScope 原生协议。</p>}<Form.Item name="asr_protocol" label="识别协议"><Select options={[{ value: "auto", label: "自动识别（按模型 ID 与供应商地址）" }, { value: "transcriptions", label: "OpenAI Audio Transcriptions" }, { value: "chat_audio", label: "OpenAI Chat Completions · Audio" }, { value: "dashscope", label: "DashScope 原生 ASR" }]} /></Form.Item><Form.Item name="asr_endpoint" label="端点覆盖（可选）" extra="留空使用协议默认路径；地址必须与供应商连接同源。"><Input placeholder="留空自动选择，或填写 /api/v1/..." /></Form.Item><Form.Item name="asr_language" label="识别语言"><Input placeholder="zh" maxLength={20} /></Form.Item></section>}
      {kind === "tts" && <section className="ms-editor-section"><h3>TTS · 语音合成</h3><Form.Item name="tts_protocol" label="合成协议"><Select options={[{ value: "openai", label: "OpenAI Audio Speech" }, { value: "dashscope", label: "DashScope 原生 TTS" }]} onChange={(protocol: string) => { const defaults = ttsDefaults(protocol, modelId); form.setFieldsValue({ tts_voice: defaults.voice, tts_format: defaults.format, tts_speed: 1 }); }} /></Form.Item><Form.Item name="tts_endpoint" label="端点覆盖（可选）" extra="留空使用协议默认路径；跨域名请另建供应商连接。"><Input placeholder="留空自动选择" /></Form.Item><Form.Item name="tts_voice" label="默认音色" rules={[{ required: true, message: "请填写供应商支持的音色" }]} extra={ttsProtocol === "dashscope" ? `按模型类型选择音色，例如 ${tts.voice}；以供应商文档为准。` : "例如 alloy、nova；可填写当前模型支持的音色。"}><Input placeholder={tts.voice} /></Form.Item><div className="ms-form-grid"><Form.Item name="tts_format" label="音频格式" rules={[{ validator: (_, value) => tts.formats.includes(value) ? Promise.resolve() : Promise.reject(new Error("请选择当前协议支持的格式")) }]}><Select options={tts.formats.map((value) => ({ value, label: value.toUpperCase() }))} /></Form.Item><Form.Item name="tts_speed" label={`语速（${tts.min}–${tts.max}）`} rules={[{ type: "number", min: tts.min, max: tts.max, message: "语速超出当前模型支持范围" }]}><InputNumber min={tts.min} max={tts.max} step={.1} disabled={tts.min === tts.max} style={{ width: "100%" }} /></Form.Item></div><Alert type="info" showIcon title={`单次文本上限 ${tts.limit} 字。${ttsProtocol === "dashscope" && tts.min === 1 ? "Qwen3-TTS 当前返回 WAV，仅支持语速 1。" : "格式与语速按已选协议校验。"}`} /></section>}
      {kind === "decision" && <section className="ms-editor-section"><h3>候选项评分连接</h3><p>决策模型仅筛选已有权限内的工具和 Skill，不替代主对话模型。</p><Form.Item name="decision_preset" hidden><Input /></Form.Item><Form.Item name="decision_protocol" label="决策协议"><Select options={[{ value: "decisions", label: "Decisions 原生评分（Jev / Microsoft / Laya）" }, { value: "chat_completions", label: "OpenAI Chat Completions · JSON 评分" }]} /></Form.Item><Form.Item name="decision_endpoint" label="决策端点" rules={decisionProtocol === "decisions" ? [{ required: true, message: "请填写完整决策端点" }] : []} extra={decisionProtocol === "chat_completions" ? "留空使用供应商 Base URL 下的 /chat/completions。" : "必须与所选供应商连接同源。Laya 请填写实际完整 /v1/systemone 地址。"}><Input placeholder={decisionProtocol === "decisions" ? "https://openrouter.ai/api/alpha/decisions" : "留空使用 /chat/completions"} /></Form.Item>{(decisionPreset?.id === "laya" || initialDecision.preset === "laya") && <Alert type="warning" showIcon title="此处只保存 Laya 的服务配置，不安装、启动或假设本机已有 Laya。auto 表示由已部署服务选择模型。" />}</section>}
      {isChat && <section className="ms-editor-section"><h3>能力与上下文</h3><Form.Item name="capabilities" label="输入能力"><Checkbox.Group options={[{ label: "文本", value: "text" }, { label: "图片", value: "image" }]} /></Form.Item><Form.Item name="supports_tools" valuePropName="checked"><Checkbox>支持工具调用</Checkbox></Form.Item><div className="ms-form-grid"><Form.Item name="context_window" label="上下文窗口（Token）" extra="0 表示未指定，优先同步模型元信息。"><InputNumber min={0} max={10_000_000} precision={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="max_output_tokens" label="最大输出（Token）"><InputNumber min={0} max={1_000_000} precision={0} style={{ width: "100%" }} /></Form.Item></div><Form.Item name="supports_reasoning" valuePropName="checked"><Checkbox>支持思考 / 推理参数</Checkbox></Form.Item>{reasoningEnabled && <><Form.Item name="reasoning_efforts" label="可用推理等级" extra="只有供应商明确支持关闭思考时才添加「关闭思考」。固定思考模型不应声明 off。"><Select mode="multiple" options={REASONING} /></Form.Item><Form.Item name="default_reasoning_effort" label="模型默认推理等级"><Select options={[{ value: "", label: "跟随供应商默认" }, ...REASONING.filter((option) => reasoningEfforts.includes(option.value))]} /></Form.Item><Form.Item name="supports_reasoning_summary" valuePropName="checked"><Checkbox>支持推理摘要</Checkbox></Form.Item></>}</section>}
      <Collapse ghost items={[{ key: "advanced", label: <span className="ms-label-icon"><Settings2 size={15} />高级参数与价格<Tag bordered={false}>{model?.metadata_source || "manual"}</Tag></span>, children: <><div className="ms-form-grid"><Form.Item name="temperature" label="Temperature"><InputNumber min={0} max={2} step={.1} style={{ width: "100%" }} /></Form.Item><Form.Item name="top_p" label="Top P"><InputNumber min={0} max={1} step={.05} style={{ width: "100%" }} /></Form.Item><Form.Item name="input_price_per_1m" label="输入价格（USD / 百万 Token）"><InputNumber min={0} max={100000} step={.1} style={{ width: "100%" }} /></Form.Item><Form.Item name="output_price_per_1m" label="输出价格（USD / 百万 Token）"><InputNumber min={0} max={100000} step={.1} style={{ width: "100%" }} /></Form.Item></div><Form.Item name="metadata_source" hidden><Input /></Form.Item><Form.Item name="extra_json" label="额外参数（JSON）" extra="语音和决策私有协议由表单合并。不要覆盖 model、messages、tools、stream 等保留字段。"><Input.TextArea rows={5} spellCheck={false} className="ms-json-input" /></Form.Item></> }]} />
      {error && <Alert type="error" showIcon title={error} role="alert" />}
    </Form>
  </Modal>;
}
