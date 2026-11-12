import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Form, InputNumber, Select, Slider, Switch, Tag } from "antd";
import { ArrowUpRight, BrainCircuit, Save, Scale, Search, Server } from "lucide-react";
import { apiErrorMessage } from "../../api/pagepilot";
import { modelsRequest, type ConfiguredModel, type ModelsRuntimeConfig } from "./modelsApi";
import type { DecisionPresetDraft } from "./ModelEditor";

export const DECISION_PRESETS: (DecisionPresetDraft & { description: string; local?: boolean })[] = [
  { id: "jev", name: "Jev", base_url: "https://openrouter.ai/api/v1", model_id: "typesafe/jev-1.13", protocol: "decisions", endpoint: "https://openrouter.ai/api/alpha/decisions", description: "TypeSafe 原生决策模型，通过 OpenRouter Decisions 对候选工具和 Skill 评分。" },
  { id: "microsoft", name: "Microsoft Decision", base_url: "https://openrouter.ai/api/v1", model_id: "microsoft/microsoft-decision-1", protocol: "decisions", endpoint: "https://openrouter.ai/api/alpha/decisions", description: "Microsoft Decision 原生评分服务，需在对应供应商开通模型权限。" },
  { id: "laya", name: "Laya", base_url: "http://127.0.0.1:8000", model_id: "auto", protocol: "decisions", endpoint: "http://127.0.0.1:8000/v1/systemone", description: "填写已部署的 Laya 完整 /v1/systemone 地址。8000 仅为示例，请改为实际服务地址。", local: true },
  { id: "openai_json", name: "OpenAI JSON 评分", base_url: "", model_id: "", protocol: "chat_completions", endpoint: "", description: "复用 OpenAI 兼容连接，使用普通对话模型输出结构化相关性评分。" },
  { id: "custom", name: "自定义决策服务", base_url: "", model_id: "", protocol: "decisions", endpoint: "", description: "自定义 Decisions 端点与模型 ID，也可切换为对话 JSON 评分协议。" },
];

interface DecisionSettingsProps {
  baseUrl: string;
  config: ModelsRuntimeConfig;
  models: ConfiguredModel[];
  onSaved: (config: ModelsRuntimeConfig) => void;
  onAdd: (preset: DecisionPresetDraft) => void;
}

export function DecisionSettings({ baseUrl, config, models, onSaved, onAdd }: DecisionSettingsProps) {
  const [form] = Form.useForm<ModelsRuntimeConfig>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const bm25 = Form.useWatch("bm25_enabled", form);
  const enabled = Form.useWatch("decision_enabled", form);
  const threshold = Form.useWatch("decision_threshold", form) ?? .6;
  const selectedModelId = Form.useWatch("decision_model_id", form);
  const selectedModel = models.find((model) => model.id === selectedModelId && model.model_kind === "decision");
  const unavailable = Boolean(selectedModelId && (!selectedModel || !selectedModel.enabled || selectedModel.provider_enabled === false));
  useEffect(() => {
    form.setFieldsValue({ ...config, decision_model_id: config.decision_model_id || undefined, decision_threshold: config.decision_threshold ?? .6, decision_min_count: config.decision_min_count ?? 8, decision_timeout_seconds: config.decision_timeout_seconds ?? 5, decision_tools: config.decision_tools ?? true, decision_skills: config.decision_skills ?? true });
  }, [config, form]);

  const save = async (values: ModelsRuntimeConfig) => {
    setError("");
    setSuccess(false);
    if (values.decision_enabled && !values.decision_model_id) { setError("请先添加并选择一个已启用的决策模型，再开启决策筛选。"); return; }
    if (values.decision_enabled && !values.decision_tools && !values.decision_skills) { setError("开启决策筛选时，至少选择工具或 Skill 中的一项。"); return; }
    setSaving(true);
    try {
      const result = await modelsRequest<ModelsRuntimeConfig>(baseUrl, "/config", { method: "PUT", body: JSON.stringify({ bm25_enabled: values.bm25_enabled, decision_enabled: values.decision_enabled, decision_model_id: values.decision_model_id || 0, decision_tools: values.decision_tools, decision_skills: values.decision_skills, decision_threshold: values.decision_threshold, decision_min_count: values.decision_min_count, decision_timeout_seconds: values.decision_timeout_seconds }) });
      onSaved(result);
      setSuccess(true);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally { setSaving(false); }
  };

  return <>
    <section className="ms-section ms-decision-config">
      <div className="ms-section-heading"><div><h2><Scale size={18} />候选项筛选策略</h2><p>先筛选，再交给主模型。仅处理用户已有权限的候选项；筛选失败时保留全部候选。</p></div><Tag color={enabled ? "green" : bm25 ? "blue" : undefined}>{enabled ? "决策模型" : bm25 ? "BM25" : "全部关闭"}</Tag></div>
      <Form form={form} layout="vertical" disabled={saving} onFinish={(values) => void save(values)}>
        <div className="ms-strategy-grid">
          <div className={`ms-strategy ${bm25 ? "is-active" : ""}`}><Search size={19} /><div><strong>BM25 关键词筛选</strong><p>本地匹配，无需调用模型；与决策模型互斥。</p></div><Form.Item name="bm25_enabled" valuePropName="checked" noStyle><Switch aria-label="启用 BM25" onChange={(checked) => { setSuccess(false); if (checked) form.setFieldValue("decision_enabled", false); }} /></Form.Item></div>
          <div className={`ms-strategy ${enabled ? "is-active" : ""}`}><BrainCircuit size={19} /><div><strong>决策模型筛选</strong><p>对工具与 Skill 的业务相关性评分。</p></div><Form.Item name="decision_enabled" valuePropName="checked" noStyle><Switch aria-label="启用决策模型" onChange={(checked) => { setSuccess(false); if (checked) form.setFieldValue("bm25_enabled", false); }} /></Form.Item></div>
        </div>
        <div className="ms-form-grid">
          <Form.Item name="decision_model_id" label="使用的决策模型" extra="开关关闭时也可以先配置。启用时仅可使用已启用的决策模型。"><Select allowClear placeholder="请选择决策模型" options={[...models.filter((model) => model.model_kind === "decision").map((model) => ({ value: model.id, label: `${model.name} · ${model.provider_name || "自定义连接"}${!model.enabled || model.provider_enabled === false ? "（已停用）" : ""}`, disabled: !model.enabled || model.provider_enabled === false })), ...(!selectedModel && selectedModelId ? [{ value: selectedModelId, label: `原绑定模型 #${selectedModelId} 已不可用`, disabled: true }] : [])]} /></Form.Item>
          <Form.Item label="决策范围"><div className="ms-scope-options"><Form.Item name="decision_tools" valuePropName="checked" noStyle><Checkbox>工具</Checkbox></Form.Item><Form.Item name="decision_skills" valuePropName="checked" noStyle><Checkbox>Skill</Checkbox></Form.Item></div></Form.Item>
        </div>
        {unavailable && <Alert type="warning" showIcon title="当前绑定的决策模型或供应商已不可用。请重新选择，或关闭决策筛选后清空绑定。" />}
        <Form.Item label="评分阈值" extra="评分达到阈值才进入主模型上下文。范围 0.01–0.99，默认 0.60。"><div className="ms-threshold"><Slider min={.01} max={.99} step={.01} value={threshold} onChange={(value) => form.setFieldValue("decision_threshold", value)} tooltip={{ formatter: (value) => value?.toFixed(2) }} /><Form.Item name="decision_threshold" noStyle rules={[{ required: true, type: "number", min: .01, max: .99 }]}><InputNumber aria-label="决策评分阈值" min={.01} max={.99} step={.01} precision={2} /></Form.Item></div></Form.Item>
        <div className="ms-form-grid"><Form.Item name="decision_min_count" label="触发的最少候选数" extra="候选不足时直接提供给主模型，减少额外等待。" rules={[{ required: true, type: "number", min: 1, max: 200 }]}><InputNumber min={1} max={200} precision={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="decision_timeout_seconds" label="决策超时（秒）" extra="超时后保留全部候选项，默认 5 秒。" rules={[{ required: true, type: "number", min: 1, max: 30 }]}><InputNumber min={1} max={30} step={1} style={{ width: "100%" }} /></Form.Item></div>
        {error && <Alert type="error" showIcon title={error} role="alert" />}
        {success && <Alert type="success" showIcon title="筛选策略已保存。" closable onClose={() => setSuccess(false)} />}
        <div className="ms-form-footer"><span>两个开关可全部关闭；配置项始终可编辑。</span><Button type="primary" htmlType="submit" icon={<Save size={15} />} loading={saving}>保存筛选设置</Button></div>
      </Form>
    </section>
    <section className="ms-section"><div className="ms-section-heading"><div><h2>决策服务</h2><p>卡片仅提供配置模板，不创建连接、不安装服务。配置后还需选为决策模型并保存策略。</p></div></div><div className="ms-presets-grid ms-decision-presets">{DECISION_PRESETS.map((preset) => <button type="button" key={preset.id} className="ms-preset-card" onClick={() => onAdd(preset)}><span className={`ms-brand ms-brand--${preset.id}`} aria-hidden="true">{preset.local ? <Server size={20} /> : preset.id === "custom" ? <SettingsIcon /> : <BrainCircuit size={21} />}</span><span className="ms-preset-copy"><strong>{preset.name}</strong><small>{preset.description}</small><em>{preset.model_id || (preset.protocol === "chat_completions" ? "/chat/completions" : "自定义端点")}</em></span><ArrowUpRight size={15} /></button>)}</div></section>
  </>;
}

function SettingsIcon() { return <Scale size={21} />; }
