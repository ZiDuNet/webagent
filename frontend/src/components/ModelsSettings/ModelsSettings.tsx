import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Collapse, ConfigProvider, Empty, Input, Modal, Popconfirm, Select, Skeleton, Space, Switch, Tabs, Tag, Tooltip, theme } from "antd";
import { ArrowUpRight, AudioLines, BrainCircuit, Check, ChevronDown, CircleStop, FlaskConical, Image, KeyRound, MessageSquareText, Mic, Pencil, Plus, RefreshCw, Scale, Search, Server, Sparkles, Trash2, Volume2 } from "lucide-react";
import { apiErrorMessage } from "../../api/pagepilot";
import { DecisionSettings } from "./DecisionSettings";
import { ModelEditor, type DecisionPresetDraft } from "./ModelEditor";
import { ModelTestDialog } from "./ModelTestDialog";
import { ProviderEditor } from "./ProviderEditor";
import { modelCategory, modelKindLabel, modelsRequest, type ConfiguredModel, type ModelKind, type ModelPreset, type ModelProvider, type ModelsCategory, type ModelsRuntimeConfig } from "./modelsApi";
import "./ModelsSettings.css";

export interface ModelsSettingsProps {
  baseUrl?: string;
  initialCategory?: "chat" | "voice" | "image" | "decision";
  onChanged?: () => void;
}

export function ModelsSettings(props: ModelsSettingsProps) {
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#27c96a", colorBgBase: "#0b0d10", colorBgContainer: "#151920", colorBgElevated: "#191e27", colorBorder: "#303846", colorText: "#e8ecf3", colorTextSecondary: "#8c95a8", borderRadius: 10, fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif', controlHeight: 36 }, components: { Tabs: { itemSelectedColor: "#43da80", inkBarColor: "#27c96a" }, Modal: { contentBg: "#151920", headerBg: "#151920" }, Input: { activeBorderColor: "#27c96a" } } }}><ModelsSettingsContent {...props} /></ConfigProvider>;
}

interface ModelDraft { model?: ConfiguredModel; kind: ModelKind; providerId?: number; decision?: DecisionPresetDraft }
interface ProviderDraft { provider?: ModelProvider; preset?: ModelPreset; addModel?: boolean; decision?: DecisionPresetDraft }

function ModelsSettingsContent({ baseUrl = "/api/agent", initialCategory = "chat", onChanged }: ModelsSettingsProps) {
  const [category, setCategory] = useState<ModelsCategory>(initialCategory);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [config, setConfig] = useState<ModelsRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [testing, setTesting] = useState<ConfiguredModel | null>(null);
  const [busy, setBusy] = useState("");
  const [connectionTest, setConnectionTest] = useState<{ provider: ModelProvider; loading: boolean; result?: { ok: boolean; message?: string; sample?: string[] }; error?: string } | null>(null);
  const [showMore, setShowMore] = useState(false);
  const loadRef = useRef<AbortController | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const providerTestRef = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      modelsRequest<{ items: ModelProvider[] }>(baseUrl, "/admin/providers", { signal: controller.signal }),
      modelsRequest<{ items: ConfiguredModel[] }>(baseUrl, "/admin/models", { signal: controller.signal }),
      modelsRequest<{ items: ModelPreset[] }>(baseUrl, "/admin/providers/presets", { signal: controller.signal }),
      modelsRequest<ModelsRuntimeConfig>(baseUrl, "/config", { signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    const [providerResult, modelResult, presetResult, configResult] = results;
    if (providerResult.status === "fulfilled") setProviders(providerResult.value.items);
    if (modelResult.status === "fulfilled") setModels(modelResult.value.items);
    if (presetResult.status === "fulfilled") setPresets(presetResult.value.items);
    if (configResult.status === "fulfilled") setConfig(configResult.value);
    const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${["供应商", "模型", "供应商目录", "运行配置"][index]}：${apiErrorMessage(result.reason)}`] : []);
    if (errors.length) setError(errors.join("；"));
    setLoading(false);
  }, [baseUrl]);

  useEffect(() => {
    void load();
    return () => { loadRef.current?.abort(); operationRef.current?.abort(); providerTestRef.current?.abort(); };
  }, [load]);

  const changed = () => { onChangedRef.current?.(); void load(); };
  const run = async (key: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    const controller = new AbortController();
    operationRef.current = controller;
    setBusy(key);
    setError("");
    try { await action(controller.signal); } catch (failure) { if (!controller.signal.aborted) setError(apiErrorMessage(failure)); } finally { setBusy(""); }
  };

  const updateModel = (model: ConfiguredModel, patch: Partial<ConfiguredModel>, label: string) => void run(`model:${model.id}`, async (signal) => {
    const result = await modelsRequest<{ model: ConfiguredModel }>(baseUrl, `/admin/models/${model.id}`, { method: "PUT", signal, body: JSON.stringify(patch) });
    setModels((previous) => previous.map((item) => item.id === model.id ? result.model : patch.is_default ? { ...item, is_default: false } : item));
    setNotice(label);
    changed();
  });

  const providerSaved = (provider: ModelProvider) => {
    const previous = providerDraft;
    const decision = previous?.decision ? { ...previous.decision } : undefined;
    if (decision?.protocol === "decisions" && decision.endpoint && decision.base_url !== provider.base_url) {
      try { decision.endpoint = new URL(new URL(decision.endpoint).pathname, provider.base_url).href; } catch { decision.endpoint = ""; }
    }
    setProviders((items) => items.some((item) => item.id === provider.id) ? items.map((item) => item.id === provider.id ? provider : item) : [...items, provider]);
    setProviderDraft(null);
    if (modelDraft) setModelDraft((previous) => previous ? { ...previous, providerId: provider.id } : previous);
    if (previous?.addModel && !modelDraft) setModelDraft({ kind: decision ? "decision" : category === "voice" ? "asr" : category === "image" ? "image_generation" : category === "decision" ? "decision" : "chat", providerId: provider.id, decision });
    setNotice("供应商连接已保存，可以为此连接添加多个模型。");
    changed();
  };

  const addDecision = (preset: DecisionPresetDraft) => {
    const matching = providers.find((provider) => preset.base_url && provider.base_url.replace(/\/$/, "") === preset.base_url.replace(/\/$/, ""));
    if (matching || !preset.base_url) { setModelDraft({ kind: "decision", providerId: matching?.id, decision: preset }); return; }
    setProviderDraft({ addModel: true, decision: preset, preset: { id: preset.id, name: preset.id === "laya" ? "Laya 决策服务" : "OpenRouter 决策连接", base_url: preset.base_url, description: "决策模型连接", categories: ["decision"], models: [{ id: preset.model_id, name: preset.name, kind: "decision" }], local: preset.id === "laya", requires_key: preset.id !== "laya" } });
  };

  const testProvider = async (provider: ModelProvider) => {
    providerTestRef.current?.abort();
    const controller = new AbortController();
    providerTestRef.current = controller;
    setConnectionTest({ provider, loading: true });
    try {
      const result = await modelsRequest<{ ok: boolean; message?: string; sample?: string[] }>(baseUrl, `/admin/providers/${provider.id}/test`, { method: "POST", signal: controller.signal }, 12_000);
      if (!controller.signal.aborted) setConnectionTest({ provider, loading: false, result });
    } catch (failure) {
      if (!controller.signal.aborted) setConnectionTest({ provider, loading: false, error: apiErrorMessage(failure) });
    }
  };

  const filteredModels = models.filter((model) => !query.trim() || `${model.name} ${model.model_id} ${model.provider_name || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleModels = filteredModels.filter((model) => modelCategory(model.model_kind) === category && !["embedding", "rerank"].includes(model.model_kind));
  const categoryPresets = presets.filter((preset) => preset.id !== "custom" && preset.categories.includes(category));
  const pool = (items: ConfiguredModel[], emptyText: string) => items.length ? <div className="ms-model-list">{items.map((model) => {
    const provider = providers.find((item) => item.id === model.provider_id);
    const disabled = !model.enabled || provider?.enabled === false;
    const working = busy === `model:${model.id}`;
    return <article key={model.id} className={`ms-model-row ${disabled ? "is-disabled" : ""}`}>
      <span className={`ms-model-symbol ms-kind-${modelCategory(model.model_kind)}`}>{model.model_kind === "tts" ? <Volume2 size={18} /> : modelCategory(model.model_kind) === "voice" ? <Mic size={18} /> : model.model_kind === "image_generation" ? <Image size={18} /> : model.model_kind === "decision" ? <Scale size={18} /> : <MessageSquareText size={18} />}</span>
      <div className="ms-model-info">
        <div className="ms-model-name"><strong>{model.name}</strong>{model.is_default && <Tag color="green" icon={<Check size={11} />}>默认</Tag>}{config?.asr_model_id === model.id && <Tag color="cyan">默认 STT</Tag>}{config?.tts_model_id === model.id && <Tag color="cyan">默认 TTS</Tag>}{config?.decision_model_id === model.id && <Tag color="purple">决策绑定</Tag>}<Tag bordered={false}>{modelKindLabel(model.model_kind)}</Tag></div>
        <code>{model.model_id}</code>
        <small>{provider?.name || model.provider_name || "供应商不存在"}{["chat", "vision"].includes(model.model_kind) && model.context_window ? ` · ${new Intl.NumberFormat("zh-CN").format(model.context_window)} 上下文` : ""}{provider?.enabled === false ? " · 连接已停用" : !model.enabled ? " · 模型已停用" : ""}</small>
      </div>
      <div className="ms-model-actions">
        <Tooltip title={model.enabled ? "停用模型" : "启用模型"}><Switch size="small" checked={model.enabled} loading={working} disabled={Boolean(busy)} aria-label={`${model.enabled ? "停用" : "启用"}${model.name}`} onChange={(enabled) => updateModel(model, { enabled }, enabled ? "模型已启用。" : "模型已停用。")} /></Tooltip>
        <Button size="small" icon={<FlaskConical size={13} />} disabled={Boolean(busy)} onClick={() => setTesting(model)}>测试</Button>
        <Button size="small" icon={<Pencil size={13} />} onClick={() => setModelDraft({ model, kind: model.model_kind })}>编辑</Button>
        <Popconfirm title="删除这个模型配置？" description="不会删除供应商连接。相关默认绑定将由服务端清理。" okText="删除" cancelText="取消" onConfirm={() => run(`model:${model.id}`, async (signal) => { await modelsRequest(baseUrl, `/admin/models/${model.id}`, { method: "DELETE", signal }); setNotice("模型配置已删除。"); changed(); })}><Button size="small" danger icon={<Trash2 size={13} />} aria-label={`删除模型 ${model.name}`} disabled={Boolean(busy)} /></Popconfirm>
        {(model.model_kind === "chat" || model.model_kind === "vision") && !model.is_default && <Button type="text" size="small" disabled={disabled || Boolean(busy)} onClick={() => updateModel(model, { is_default: true }, "默认对话模型已更新。")}>设为默认</Button>}
        <Button type="text" size="small" icon={<RefreshCw size={12} className={working ? "ms-spin" : ""} />} loading={working} disabled={Boolean(busy)} onClick={() => void run(`model:${model.id}`, async (signal) => { await modelsRequest(baseUrl, `/admin/models/${model.id}/sync`, { method: "POST", signal }, 20_000); setNotice("模型元信息已同步，专用协议配置保持原值。"); changed(); })}>同步信息</Button>
      </div>
    </article>;
  })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有符合搜索条件的模型" : emptyText} />;

  return <main className="models-settings" aria-busy={loading}>
    <header className="ms-page-header"><div><div className="ms-eyebrow"><span className="ms-status-dot is-on" />统一模型接入</div><h1>模型配置</h1><p>一个模型池，连接你的对话、语音、图像与决策服务。</p></div><Space wrap><Button icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<Plus size={16} />} onClick={() => setModelDraft({ kind: category === "voice" ? "asr" : category === "image" ? "image_generation" : category === "decision" ? "decision" : "chat" })}>添加模型</Button></Space></header>
    {error && <Alert className="ms-page-alert" type="error" showIcon title="部分配置未能读取或保存" description={error} action={<Button size="small" onClick={() => void load()}>重试读取</Button>} closable onClose={() => setError("")} role="alert" />}
    {notice && <Alert className="ms-page-alert" type="success" showIcon title={notice} closable onClose={() => setNotice("")} />}
    <Tabs className="ms-category-tabs" activeKey={category} onChange={(value) => { setCategory(value as ModelsCategory); setQuery(""); setShowMore(false); }} items={[{ key: "chat", label: <span><MessageSquareText size={16} />对话模型</span> }, { key: "voice", label: <span><AudioLines size={16} />语音</span> }, { key: "image", label: <span><Image size={16} />图片生成</span> }, { key: "decision", label: <span><Scale size={16} />决策</span> }]} />
    {loading && !models.length && !providers.length ? <section className="ms-section"><Skeleton active paragraph={{ rows: 5 }} /></section> : <>
      <section className="ms-section ms-pool"><div className="ms-section-heading"><div><h2><Sparkles size={18} />{category === "voice" ? "语音模型池" : category === "image" ? "图片模型池" : category === "decision" ? "决策模型池" : "可用模型池"}<span className="ms-count">{visibleModels.length}</span></h2><p>{category === "chat" ? "已保存的模型可在对话输入框选择，默认模型用于新会话。" : category === "voice" ? "STT 识别人声，TTS 生成语音；两个默认绑定独立设置。" : category === "image" ? "图片生成使用 OpenAI Images 协议，由业务工具按权限调用。" : "用于候选工具和 Skill 评分，独立于对话模型。"}</p></div><Input prefix={<Search size={14} />} allowClear className="ms-model-search" placeholder="搜索模型或供应商" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索模型" /></div>
        {category === "voice" ? <><div className="ms-subsection-heading"><h3><Mic size={16} />STT · 语音识别</h3><Button size="small" icon={<Plus size={13} />} onClick={() => setModelDraft({ kind: "asr" })}>添加识别模型</Button></div>{pool(visibleModels.filter((model) => model.model_kind !== "tts"), "还没有语音识别模型")}<div className="ms-subsection-heading ms-subsection-divider"><h3><Volume2 size={16} />TTS · 语音合成</h3><Button size="small" icon={<Plus size={13} />} onClick={() => setModelDraft({ kind: "tts" })}>添加合成模型</Button></div>{pool(visibleModels.filter((model) => model.model_kind === "tts"), "还没有语音合成模型")}</> : pool(visibleModels, "还没有此类型的模型，添加供应商连接后即可配置")}
      </section>
      {category === "voice" && config && <VoiceBindings baseUrl={baseUrl} config={config} models={models} onSaved={(next) => { setConfig(next); setNotice("STT / TTS 默认模型已保存。"); onChangedRef.current?.(); }} />}
      {category === "decision" && config && <DecisionSettings baseUrl={baseUrl} config={config} models={models} onSaved={(next) => { setConfig(next); onChangedRef.current?.(); }} onAdd={addDecision} />}
      {category === "decision" && !config && <Alert type="warning" showIcon title="运行配置尚未读取，决策策略暂不可保存。请重试读取。" />}
      {category !== "decision" && <section className="ms-section"><div className="ms-section-heading"><div><h2>常用供应商</h2><p>选择模板填写连接，模型示例以实际账号权限为准。统一使用 OpenAI 兼容接入或明确的语音协议。</p></div><Tag bordered={false}>点击配置，不自动安装</Tag></div><div className="ms-presets-grid">{(showMore ? categoryPresets : categoryPresets.slice(0, 8)).map((preset) => { const matches = providers.filter((provider) => provider.base_url.replace(/\/$/, "") === preset.base_url.replace(/\/$/, "")); return <button type="button" className="ms-preset-card" key={preset.id} onClick={() => setProviderDraft({ preset, addModel: true })}><span className={`ms-brand ms-brand--${preset.id}`} aria-hidden="true">{preset.local ? <Server size={20} /> : <span>{preset.name.slice(0, 2)}</span>}</span><span className="ms-preset-copy"><strong>{preset.name}{preset.local && <Tag bordered={false}>本地</Tag>}</strong><small>{preset.description}</small><em>{matches.length ? `${matches.length} 个连接 · 添加另一个` : "配置连接"}{preset.models.length ? ` · ${preset.models.slice(0, 2).map((model) => model.id).join(" / ")}` : ""}</em></span><ArrowUpRight size={15} /></button>; })}<button type="button" className="ms-preset-card ms-preset-card--custom" onClick={() => setProviderDraft({ addModel: true })}><span className="ms-brand"><Plus size={22} /></span><span className="ms-preset-copy"><strong>自定义供应商</strong><small>你的模型网关、私有部署或其他兼容服务。</small><em>填写 Base URL 与凭据</em></span><ArrowUpRight size={15} /></button></div>{categoryPresets.length > 8 && <Button type="text" className="ms-more-presets" icon={<ChevronDown size={14} />} onClick={() => setShowMore((previous) => !previous)}>{showMore ? "收起供应商" : `更多供应商（${categoryPresets.length - 8}）`}</Button>}{!presets.length && !loading && <p className="ms-no-presets">供应商目录未返回内容，可直接添加自定义连接。</p>}</section>}
      <section className="ms-section">
        <div className="ms-section-heading"><div><h2><Server size={17} />供应商连接<span className="ms-count">{providers.length}</span></h2><p>地址和密钥集中维护，可为同一供应商创建不同账号或不同环境的连接。</p></div><Button icon={<Plus size={14} />} onClick={() => setProviderDraft({})}>添加连接</Button></div>
        {providers.length ? <div className="ms-provider-list">{providers.map((provider) => <article className="ms-provider-row" key={provider.id}>
          <span className={`ms-status-dot ${provider.enabled ? "is-on" : ""}`} />
          <div className="ms-provider-info"><strong>{provider.name}<Tag bordered={false}>共享连接</Tag></strong><code>{provider.base_url}</code><small><KeyRound size={12} />{provider.api_key_set ? provider.api_key_masked : provider.requires_key === false ? "本地服务，无需密钥" : "尚未配置密钥"} · {models.filter((model) => model.provider_id === provider.id).length} 个模型 · {provider.timeout_seconds}s 超时</small></div>
          <div className="ms-provider-actions">
            <Switch size="small" aria-label={`${provider.enabled ? "停用" : "启用"}连接 ${provider.name}`} checked={provider.enabled} disabled={Boolean(busy)} loading={busy === `provider:${provider.id}`} onChange={(enabled) => void run(`provider:${provider.id}`, async (signal) => { await modelsRequest(baseUrl, `/admin/providers/${provider.id}`, { method: "PUT", signal, body: JSON.stringify({ enabled }) }); changed(); })} />
            <Button size="small" onClick={() => setModelDraft({ kind: category === "voice" ? "asr" : category === "image" ? "image_generation" : category === "decision" ? "decision" : "chat", providerId: provider.id })} icon={<Plus size={13} />}>模型</Button>
            <Button size="small" icon={<FlaskConical size={13} />} onClick={() => void testProvider(provider)}>测试连接</Button>
            <Button size="small" icon={<Pencil size={13} />} onClick={() => setProviderDraft({ provider })}>编辑</Button>
            <Popconfirm title="删除这个供应商连接？" description="存在关联模型时，服务端会拒绝删除。" okText="删除" cancelText="取消" onConfirm={() => run(`provider:${provider.id}`, async (signal) => { await modelsRequest(baseUrl, `/admin/providers/${provider.id}`, { method: "DELETE", signal }); setNotice("供应商连接已删除。"); changed(); })}><Button size="small" danger icon={<Trash2 size={13} />} aria-label={`删除连接 ${provider.name}`} disabled={Boolean(busy)} /></Popconfirm>
          </div>
        </article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加供应商连接" />}
      </section>
      {category === "chat" && <section className="ms-section ms-auxiliary"><Collapse ghost items={[{ key: "retrieval", label: <span className="ms-label-icon"><BrainCircuit size={16} />Embedding / Rerank<span className="ms-count">{models.filter((model) => ["embedding", "rerank"].includes(model.model_kind)).length}</span></span>, children: <><p>保留知识库及检索扩展所需的模型配置。框架不会自动创建知识库或索引。</p>{pool(filteredModels.filter((model) => ["embedding", "rerank"].includes(model.model_kind)), "暂无检索模型")}<Space wrap><Button icon={<Plus size={13} />} onClick={() => setModelDraft({ kind: "embedding" })}>添加 Embedding</Button><Button icon={<Plus size={13} />} onClick={() => setModelDraft({ kind: "rerank" })}>添加 Rerank</Button></Space></> }]} /></section>}
    </>}
    {modelDraft && <ModelEditor key={modelDraft.model?.id || `${modelDraft.kind}:${modelDraft.decision?.id || "new"}`} baseUrl={baseUrl} model={modelDraft.model} initialKind={modelDraft.kind} initialProviderId={modelDraft.providerId} decisionPreset={modelDraft.decision} providers={providers} presets={presets} onClose={() => setModelDraft(null)} onSaved={() => { setModelDraft(null); setNotice("模型配置已保存。"); changed(); }} onEditProvider={(provider) => setProviderDraft({ provider })} />}
    {providerDraft && <ProviderEditor key={providerDraft.provider?.id || providerDraft.preset?.id || "new"} baseUrl={baseUrl} provider={providerDraft.provider} preset={providerDraft.preset} onClose={() => setProviderDraft(null)} onSaved={providerSaved} />}
    {testing && <ModelTestDialog baseUrl={baseUrl} model={testing} provider={providers.find((provider) => provider.id === testing.provider_id)} onClose={() => setTesting(null)} />}
    <Modal open={Boolean(connectionTest)} title="测试供应商连接" width={580} className="ms-modal" onCancel={() => { providerTestRef.current?.abort(); setConnectionTest(null); }} footer={<><Button onClick={() => { providerTestRef.current?.abort(); setConnectionTest(null); }}>关闭</Button>{connectionTest?.loading && <Button icon={<CircleStop size={14} />} onClick={() => { providerTestRef.current?.abort(); if (connectionTest) setConnectionTest({ ...connectionTest, loading: false, error: "已取消读取。可直接填写模型 ID。" }); }}>取消读取</Button>}</>}><p className="ms-dialog-intro">{connectionTest?.provider.name} · {connectionTest?.provider.base_url}</p><p className="ms-dialog-intro">主动请求 /models 检查连接；有些语音和决策服务不提供此列表，请使用具体模型测试。</p>{connectionTest?.loading && <Skeleton active paragraph={{ rows: 2 }} />}{connectionTest?.result && <Alert showIcon type={connectionTest.result.ok ? "success" : "error"} title={connectionTest.result.message} description={connectionTest.result.sample?.join("、")} />}{connectionTest?.error && <Alert showIcon type="warning" title={connectionTest.error} />}</Modal>
  </main>;
}

function VoiceBindings({ baseUrl, config, models, onSaved }: { baseUrl: string; config: ModelsRuntimeConfig; models: ConfiguredModel[]; onSaved: (config: ModelsRuntimeConfig) => void }) {
  const [asrId, setAsrId] = useState<number | undefined>(config.asr_model_id || undefined);
  const [ttsId, setTtsId] = useState<number | undefined>(config.tts_model_id || undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setAsrId(config.asr_model_id || undefined); setTtsId(config.tts_model_id || undefined); }, [config.asr_model_id, config.tts_model_id]);
  const options = (kind: ModelKind, selectedId?: number) => {
    const available = models.filter((model) => model.model_kind === kind);
    const result = available.map((model) => ({ value: model.id, label: `${model.name} · ${model.provider_name || "自定义连接"}${!model.enabled || model.provider_enabled === false ? "（已停用）" : ""}`, disabled: !model.enabled || model.provider_enabled === false }));
    if (selectedId && !available.some((model) => model.id === selectedId)) result.push({ value: selectedId, label: `原绑定模型 #${selectedId} 已不可用`, disabled: true });
    return result;
  };
  const unavailable = (id: number | undefined, kind: ModelKind) => Boolean(id && !models.some((model) => model.id === id && model.model_kind === kind && model.enabled && model.provider_enabled !== false));
  const save = async () => {
    setSaving(true); setError("");
    try { onSaved(await modelsRequest<ModelsRuntimeConfig>(baseUrl, "/config", { method: "PUT", body: JSON.stringify({ asr_model_id: asrId || 0, tts_model_id: ttsId || 0 }) })); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setSaving(false); }
  };
  return <section className="ms-section"><div className="ms-section-heading"><div><h2><AudioLines size={18} />语音默认绑定</h2><p>两个能力独立启用；清空后保存即关闭。实时 STT 暂不用于浏览器文件转写。</p></div></div><div className="ms-form-grid"><label className="ms-binding-field"><span><Mic size={15} />默认 STT 识别模型</span><Select aria-label="默认 STT 识别模型" allowClear placeholder="未配置，语音输入关闭" value={asrId} onChange={setAsrId} options={options("asr", asrId)} disabled={saving} /></label><label className="ms-binding-field"><span><Volume2 size={15} />默认 TTS 合成模型</span><Select aria-label="默认 TTS 合成模型" allowClear placeholder="未配置，语音合成关闭" value={ttsId} onChange={setTtsId} options={options("tts", ttsId)} disabled={saving} /></label></div>{(unavailable(asrId, "asr") || unavailable(ttsId, "tts")) && <Alert type="warning" showIcon title="当前绑定模型或供应商已不可用。请改选已启用模型，或清空绑定后保存。" />}{error && <Alert type="error" title={error} showIcon role="alert" />}<div className="ms-form-footer"><span>保存后对业务系统用户生效。</span><Button type="primary" icon={<Check size={15} />} loading={saving} onClick={() => void save()}>保存语音绑定</Button></div></section>;
}
