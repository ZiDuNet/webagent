import { useState } from "react";
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Switch, Tag } from "antd";
import { KeyRound, Save, Server } from "lucide-react";
import { apiErrorMessage } from "../../api/pagepilot";
import { jsonObject, modelsRequest, type ModelPreset, type ModelProvider } from "./modelsApi";

interface ProviderEditorProps {
  baseUrl: string;
  provider?: ModelProvider;
  preset?: ModelPreset;
  onClose: () => void;
  onSaved: (provider: ModelProvider) => void;
}

interface ProviderValues {
  name: string;
  base_url: string;
  api_key: string;
  clear_api_key: boolean;
  extra_headers: string;
  timeout_seconds: number;
  enabled: boolean;
}

export function ProviderEditor({ baseUrl, provider, preset, onClose, onSaved }: ProviderEditorProps) {
  const [form] = Form.useForm<ProviderValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const clearKey = Form.useWatch("clear_api_key", form);

  const save = async (values: ProviderValues) => {
    setError("");
    try {
      const headers = jsonObject(values.extra_headers, "自定义请求头");
      if (Object.values(headers).some((value) => typeof value !== "string")) throw new Error("自定义请求头的值必须都是字符串。");
      const body: Record<string, unknown> = {
        name: values.name.trim(),
        provider_type: "openai_compatible",
        base_url: values.base_url.trim(),
        extra_headers: headers,
        timeout_seconds: values.timeout_seconds,
        enabled: values.enabled,
      };
      if (!provider || values.api_key?.trim()) body.api_key = values.api_key?.trim() || "";
      if (provider && values.clear_api_key) body.clear_api_key = true;
      setSaving(true);
      const result = await modelsRequest<{ provider: ModelProvider }>(baseUrl, `/admin/providers${provider ? `/${provider.id}` : ""}`, { method: provider ? "PUT" : "POST", body: JSON.stringify(body) });
      onSaved(result.provider);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return <Modal open title={<span className="ms-modal-title"><Server size={19} />{provider ? "编辑供应商连接" : preset ? `连接 ${preset.name}` : "自定义供应商"}</span>} onCancel={onClose} maskClosable={!saving} keyboard={!saving} closable={!saving} width={620} className="ms-modal" footer={<><Button onClick={onClose} disabled={saving}>取消</Button><Button type="primary" icon={<Save size={15} />} loading={saving} onClick={() => form.submit()}>保存连接</Button></>}>
    <p className="ms-dialog-intro">一个连接保存一套地址和凭据，可以关联多个模型。只有点击保存才会创建配置。</p>
    <Form form={form} layout="vertical" onFinish={(values) => void save(values)} requiredMark="optional" scrollToFirstError disabled={saving} initialValues={{ name: provider?.name || preset?.name || "", base_url: provider?.base_url || preset?.base_url || "", api_key: "", clear_api_key: false, extra_headers: JSON.stringify(provider?.extra_headers || {}, null, 2), timeout_seconds: provider?.timeout_seconds || 45, enabled: provider?.enabled ?? true }}>
      <div className="ms-inline-note"><Tag color="green">共享连接</Tag><span>标准模型使用 OpenAI 兼容接口，专用语音和决策协议在模型中设置。</span></div>
      <Form.Item name="name" label="连接名称" rules={[{ required: true, whitespace: true, message: "请填写连接名称" }]}><Input maxLength={100} placeholder="例如：公司模型网关 / 阿里云生产账号" autoComplete="off" /></Form.Item>
      <Form.Item name="base_url" label="Base URL" rules={[{ required: true, message: "请填写供应商地址" }, { validator: (_, value: string) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? Promise.resolve() : Promise.reject(new Error("请使用 HTTP 或 HTTPS 地址")); } catch { return Promise.reject(new Error("请填写完整 URL，例如 https://api.example.com/v1")); } } }]} extra="填写接口根地址；不要填 API Key。决策与语音的特殊端点在模型中单独设置。"><Input placeholder="https://api.example.com/v1" autoComplete="url" maxLength={500} /></Form.Item>
      <Form.Item name="api_key" label={<span className="ms-label-icon"><KeyRound size={14} />API Key</span>} extra={provider?.api_key_set ? `已保存：${provider.api_key_masked}。留空保留原密钥，填写新值将替换。` : preset?.requires_key === false ? "本地或无需密钥的服务可以留空。" : "密钥仅保存在服务端，不会回传完整内容。"}><Input.Password placeholder={provider?.api_key_set ? "留空保留现有密钥" : "请输入供应商 API Key"} autoComplete="new-password" disabled={saving || clearKey} maxLength={800} /></Form.Item>
      {provider?.api_key_set && <Form.Item name="clear_api_key" valuePropName="checked"><Checkbox>清除已保存的 API Key</Checkbox></Form.Item>}
      <div className="ms-form-grid">
        <Form.Item name="timeout_seconds" label="请求超时（秒）" rules={[{ required: true }]}><InputNumber min={3} max={180} precision={0} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="enabled" label="启用连接" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
      </div>
      <Form.Item name="extra_headers" label="自定义请求头（JSON）" extra={'例如 {"X-Project":"operations"}。业务用户身份不应写死在全局请求头中。'}><Input.TextArea rows={4} className="ms-json-input" spellCheck={false} /></Form.Item>
      {preset?.local && <Alert type="info" showIcon title="这是本地服务的配置入口，不会自动安装或启动模型服务。请先完成服务部署。" />}
      {error && <Alert type="error" showIcon title={error} role="alert" />}
    </Form>
  </Modal>;
}
