import { useState } from "react";
import { Alert, Button, Checkbox, Divider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { Pencil, Star, Trash2 } from "lucide-react";
import { controlRequest, apiErrorMessage } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";

const REASONING_OPTIONS = ["off", "none", "minimal", "low", "medium", "high", "xhigh"].map((value) => ({
  value,
  label: ({ off: "关闭思考", none: "无推理预算", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高" } as Record<string, string>)[value],
}));

const nullable = <T,>(value: T | null | undefined): T | undefined => value == null ? undefined : value;

export default function AssistantsPage() {
  const resource = useResource<{ items: Row[] }>("/admin/assistants");
  const models = useResource<{ items: Row[] }>("/admin/models");
  const tools = useResource<{ items: Row[] }>("/admin/tools");
  const skills = useResource<{ items: Row[] }>("/admin/skills");
  const [draft, setDraft] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const modelOptions = (kinds: string[]) => (models.data?.items || [])
    .filter((model) => model.enabled && model.provider_enabled !== false && kinds.includes(model.model_kind))
    .map((model) => ({ value: model.id, label: `${model.name} · ${model.provider_name || model.model_id}` }));

  const edit = (value: Row = {}) => {
    form.resetFields();
    form.setFieldsValue({
      name: "",
      enabled: true,
      allow_model_switch: true,
      is_default: false,
      allowed_roles: ["*"],
      memory_enabled: true,
      tool_names: [],
      skill_slugs: [],
      max_steps: 0,
      max_tool_calls: 0,
      max_run_seconds: 0,
      context_max_tokens: 0,
      ...value,
      model_row_id: nullable(value.model_row_id),
      asr_model_id: nullable(value.asr_model_id),
      asr_realtime_model_id: nullable(value.asr_realtime_model_id),
      tts_model_id: nullable(value.tts_model_id),
      voice_asr_model_id: nullable(value.voice_asr_model_id),
      voice_tts_model_id: nullable(value.voice_tts_model_id),
      voice_input_mode: nullable(value.voice_input_mode),
      voice_auto_send: nullable(value.voice_auto_send),
      tts_auto_read: nullable(value.tts_auto_read),
      tts_max_read_chars: nullable(value.tts_max_read_chars),
      default_reasoning_effort: nullable(value.default_reasoning_effort),
      default_approval_mode: nullable(value.default_approval_mode),
    });
    setDraft(value);
    setError("");
  };

  const save = async (values: Row) => {
    setSaving(true);
    setError("");
    const id = values.id || draft?.id;
    try {
      await controlRequest(`/admin/assistants${id ? `/${id}` : ""}`, values, id ? "PUT" : "POST");
      setDraft(null);
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const inherited = (name: string, label: string, extra: string) => (
    <Form.Item name={name} label={label} extra={extra}>
      <Select
        allowClear
        placeholder="继承全局运行设置"
        options={[
          { value: true, label: "开启" },
          { value: false, label: "关闭" },
        ]}
      />
    </Form.Item>
  );

  const voiceModel = (name: string, label: string, kinds: string[], extra: string) => (
    <Form.Item name={name} label={label} extra={extra}>
      <Select allowClear placeholder="继承全局运行设置" options={modelOptions(kinds)} />
    </Form.Item>
  );

  return (
    <>
      <PageHeading
        title="助手管理"
        description="助手是提示词、默认模型、工具、技能和运行策略的配置。这里的值优先于运行设置，留空则继承全局。"
        actions={<ResourceActions refresh={async () => { await Promise.all([resource.refresh(), models.refresh(), tools.refresh(), skills.refresh()]); }} add={() => edit()} label="新增助手" />}
      />
      <PageState {...resource}>
        {(models.error || tools.error || skills.error) && <Alert type="warning" showIcon title="辅助数据加载失败" description={`${models.error || tools.error || skills.error}。可点击右上角刷新重试。`} style={{ marginBottom: 16 }} />}
        <Table
          rowKey="id"
          dataSource={resource.data?.items}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: "助手",
              dataIndex: "name",
              render: (value, row) => (
                <Space>
                  <strong>{value}</strong>
                  {row.is_default && <Tag color="green">默认助手</Tag>}
                </Space>
              ),
            },
            { title: "说明", dataIndex: "description", width: "30%" },
            {
              title: "运行配置",
              width: 210,
              render: (_, row) => (
                <Space size={[4, 4]} wrap>
                  {row.model_row_id && <Tag color="blue">默认模型</Tag>}
                  {row.asr_model_id && <Tag>文件 STT</Tag>}
                  {row.asr_realtime_model_id && <Tag>实时 STT</Tag>}
                  {row.tts_model_id && <Tag>TTS</Tag>}
                  {(row.voice_asr_model_id || row.voice_tts_model_id) && <Tag>通话语音</Tag>}
                  {row.default_approval_mode && <Tag>执行模式</Tag>}
                  {!row.model_row_id && !row.asr_model_id && !row.asr_realtime_model_id && !row.tts_model_id && !row.voice_asr_model_id && !row.voice_tts_model_id && <span className="control-muted">全部继承全局</span>}
                </Space>
              ),
            },
            { title: "状态", dataIndex: "enabled", width: 90, render: (value) => <Tag color={value ? "green" : "default"}>{value ? "已启用" : "已停用"}</Tag> },
            {
              title: "操作",
              width: 230,
              render: (_, row) => (
                <Space>
                  <Button type="text" aria-label={`编辑${row.name}`} icon={<Pencil size={15} />} onClick={() => edit(row)} />
                  <Button type="text" disabled={row.is_default || !row.enabled} icon={<Star size={14} />} onClick={() => void save({ ...row, is_default: true })}>设为默认</Button>
                  <Popconfirm title="删除该助手？历史会话仍保留。" onConfirm={async () => { await controlRequest(`/admin/assistants/${row.id}`, undefined, "DELETE"); await resource.refresh(); }}>
                    <Button type="text" danger aria-label={`删除${row.name}`} icon={<Trash2 size={15} />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </PageState>
      <Modal
        open={draft !== null}
        title={draft?.id ? "编辑助手" : "新增助手"}
        width={860}
        onCancel={() => setDraft(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        {error && <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={save}>
          <div className="control-grid">
            <Form.Item name="name" label="助手名称" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
            <Form.Item name="allowed_roles" label="可用业务角色" extra="* 表示所有当前业务账号；仍受用户自身权限约束。">
              <Select mode="tags" options={["*", "admin", "viewer", "operator", "device_admin"].map((value) => ({ value }))} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="说明"><Input maxLength={500} /></Form.Item>
          <Form.Item name="system_prompt" label="系统提示词"><Input.TextArea rows={5} maxLength={20000} /></Form.Item>
          <div className="control-grid">
            <Form.Item name="model_row_id" label="默认对话模型" extra="留空继承全局默认模型。">
              <Select allowClear placeholder="继承全局默认模型" options={modelOptions(["chat", "vision"])} />
            </Form.Item>
            <Form.Item name="skill_slugs" label="技能范围" extra={`留空继承全局已启用 Skill；当前 Skill 库：${skills.data?.items.length || 0} 个`}>
              <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={skills.data?.items.map((skill) => ({ value: skill.slug, label: `${skill.name} (${skill.slug})`, disabled: !skill.enabled }))} />
            </Form.Item>
          </div>
          <Form.Item name="tool_names" label="工具白名单" extra="留空继承管理员开放范围；仍受当前业务用户权限约束。">
            <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={tools.data?.items.map((tool) => ({ value: tool.name, label: tool.title || tool.name }))} />
          </Form.Item>

          <Divider>运行策略覆盖</Divider>
          <div className="control-grid">
            <Form.Item name="default_reasoning_effort" label="默认推理强度" extra="留空继承全局；模型不支持时会自动忽略。">
              <Select allowClear placeholder="继承全局" options={REASONING_OPTIONS} />
            </Form.Item>
            <Form.Item name="default_approval_mode" label="默认执行模式" extra="留空继承全局；仍不能绕过业务权限。">
              <Select allowClear placeholder="继承全局" options={[{ value: "confirm", label: "变更前确认" }, { value: "full_access", label: "完全访问" }]} />
            </Form.Item>
            <Form.Item name="max_steps" label="最大推理轮次" extra="0 继承全局；全局为 0 表示不限。"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="max_tool_calls" label="最大工具调用" extra="0 继承全局；全局为 0 表示不限。"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="max_run_seconds" label="单次最长秒数" extra="0 继承全局；避免异常任务长期占用资源。"><InputNumber min={0} max={3600} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="context_max_tokens" label="上下文上限（Token）" extra="0 继承全局；实际仍不能超过模型窗口。"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
          </div>

          <Divider>语音与朗读覆盖</Divider>
          <p className="control-muted">所有槽位留空都继承「运行设置 → 语音与朗读」。语音输入是普通 STT，右上角语音通话才使用实时 STT/TTS。</p>
          <div className="control-grid">
            {voiceModel("asr_model_id", "文件 STT", ["asr"], "停止录音后识别并填入输入框。")}
            {voiceModel("asr_realtime_model_id", "实时 STT（输入框）", ["asr_realtime"], "录音时逐步回填输入框，不自动发送。")}
            <Form.Item name="voice_input_mode" label="输入框识别策略" extra="留空继承全局；自动模式优先实时，失败回退文件。">
              <Select allowClear placeholder="继承全局" options={[{ value: "auto", label: "自动" }, { value: "realtime", label: "仅实时" }, { value: "file", label: "仅文件" }]} />
            </Form.Item>
            {inherited("voice_auto_send", "识别后自动发送", "留空继承全局；默认关闭，识别结果只回填输入框。")}
            {voiceModel("tts_model_id", "非实时 TTS", ["tts"], "只朗读最终正文，过滤代码、HTML 和链接。")}
            {inherited("tts_auto_read", "默认自动朗读", "留空继承全局；用户仍可在 Chat 右上角随时开关。")}
            <Form.Item name="tts_max_read_chars" label="最长朗读字符" extra="留空继承全局；服务端硬上限 4000。">
              <InputNumber min={1} max={4000} placeholder="继承全局" style={{ width: "100%" }} />
            </Form.Item>
            {voiceModel("voice_asr_model_id", "通话实时 STT", ["asr_realtime"], "仅语音通话使用；留空继承全局。")}
            {voiceModel("voice_tts_model_id", "通话实时 TTS", ["tts_realtime"], "仅语音通话使用；留空继承全局。")}
          </div>

          <Divider>启用与访问</Divider>
          <Space size="large" wrap>
            <Form.Item name="enabled" valuePropName="checked"><Checkbox>启用</Checkbox></Form.Item>
            <Form.Item name="is_default" valuePropName="checked"><Checkbox>默认助手</Checkbox></Form.Item>
            <Form.Item name="allow_model_switch" valuePropName="checked"><Checkbox>允许切换模型</Checkbox></Form.Item>
            <Form.Item name="memory_enabled" valuePropName="checked"><Checkbox>使用长期记忆</Checkbox></Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
