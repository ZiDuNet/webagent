import { useMemo, useState } from "react";
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import { FlaskConical, LockKeyhole, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";
import McpImportDialog from "./McpImportDialog";

const policyOptions = [
  { value: "optional", label: "用户可见 · 可选" },
  { value: "fixed", label: "用户可见 · 固定启用" },
  { value: "hidden", label: "用户不可见 · 默认启用" },
  { value: "disabled", label: "用户不可见 · 不启用" },
];
const sourceOptions = [
  { value: "all", label: "全部来源" },
  { value: "builtin", label: "框架内置" },
  { value: "pi", label: "PI 官方" },
  { value: "native", label: "业务原生 Tool" },
  { value: "http", label: "HTTP API" },
  { value: "mcp", label: "MCP" },
];
const sourceLabel = (source: string) => sourceOptions.find((item) => item.value === source)?.label || source;
const policy = (row: Row) => !row.visible ? row.default_selected ? "hidden" : "disabled" : row.selectable ? "optional" : "fixed";
const policyValue = (value: string) => value === "optional" ? { visible: true, selectable: true, default_selected: true } : value === "fixed" ? { visible: true, selectable: false, default_selected: true } : value === "hidden" ? { visible: false, selectable: false, default_selected: true } : { visible: false, selectable: false, default_selected: false };

export default function ToolsPage() {
  const resource = useResource<{ items: Row[] }>("/admin/tools");
  const dynamic = useResource<{ items: Row[] }>("/admin/dynamic-tools");
  const mcp = useResource<{ items: Row[] }>("/admin/mcp-servers");
  const [tab, setTab] = useState("catalog");
  const [draft, setDraft] = useState<{ type: "http" | "mcp"; row: Row } | null>(null);
  const [json, setJson] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [optimistic, setOptimistic] = useState<Row | null>(null);
  const [updating, setUpdating] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [tagFilter, setTagFilter] = useState("全部");
  const [tagDraft, setTagDraft] = useState<Row | null>(null);
  const [tagValues, setTagValues] = useState<string[]>([]);
  const transport = Form.useWatch("transport", form);
  const allTools = useMemo(() => resource.data?.items || [], [resource.data]);
  const allTags = useMemo(() => [...new Set(allTools.flatMap((item) => Array.isArray(item.tags) ? item.tags : []).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")), [allTools]);
  const items = useMemo(() => allTools
    .map((item) => optimistic && item.name === optimistic.name ? { ...item, ...optimistic } : item)
    .filter((item) => (source === "all" || item.source === source) && (tagFilter === "全部" || (item.tags || []).includes(tagFilter)) && `${item.title} ${item.name} ${item.description} ${(item.tags || []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [allTools, source, tagFilter, query, optimistic]);

  const refresh = async () => { await Promise.all([resource.refresh(), dynamic.refresh(), mcp.refresh()]); };
  const act = async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); } catch (failure) { setError(apiErrorMessage(failure)); }
  };
  const updatePolicy = async (row: Row, values: Row) => {
    setOptimistic({ ...row, ...values });
    setUpdating((previous) => [...previous, row.name]);
    try {
      await controlRequest(`/admin/tools/${encodeURIComponent(row.name)}`, values, "PUT");
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setOptimistic(null);
      setUpdating((previous) => previous.filter((name) => name !== row.name));
      await resource.refresh({ silent: true });
    }
  };
  const edit = (type: "http" | "mcp", row: Row = {}) => {
    setDraft({ type, row }); setError(""); form.resetFields();
    if (type === "http") form.setFieldsValue({ enabled: row.enabled ?? false, risk: "read", method: "GET", ...row, headers_json: JSON.stringify(row.headers || {}, null, 2), schema_json: JSON.stringify(row.input_schema || { type: "object", properties: {} }, null, 2) });
    else form.setFieldsValue({ enabled: row.enabled ?? false, transport: "http", ...row, ...row.config, headers_json: "", env_json: "", args_json: JSON.stringify(row.config?.args || []), policies_json: JSON.stringify(row.config?.tool_policies || {}, null, 2), credential_names: (row.config?.credential_names || []).join(", ") });
  };
  const save = async (values: Row) => {
    if (!draft) return;
    setSaving(true); setError("");
    try {
      const input = draft.type === "http" ? { ...values, headers: JSON.parse(values.headers_json || "{}"), input_schema: JSON.parse(values.schema_json || "{}") } : { name: values.name, enabled: values.enabled, transport: values.transport, config: { url: values.url, command: values.command, args: JSON.parse(values.args_json || "[]"), headers: values.headers_json?.trim() ? JSON.parse(values.headers_json) : {}, env: values.env_json?.trim() ? JSON.parse(values.env_json) : {}, forward_user_token: values.forward_user_token || false, tool_policies: JSON.parse(values.policies_json || "{}") } };
      await controlRequest(`/admin/${draft.type === "http" ? "dynamic-tools" : "mcp-servers"}${draft.row.id ? `/${draft.row.id}` : ""}`, input, draft.row.id ? "PUT" : "POST");
      setDraft(null); await refresh();
    } catch (failure) { setError(apiErrorMessage(failure)); } finally { setSaving(false); }
  };
  const saveTags = async () => {
    if (!tagDraft) return;
    setSaving(true); setError("");
    try {
      await controlRequest(`/admin/tools/${encodeURIComponent(tagDraft.name)}/tags`, { tags: tagValues }, "PUT");
      setTagDraft(null); await resource.refresh();
    } catch (failure) { setError(apiErrorMessage(failure)); } finally { setSaving(false); }
  };
  const localLocked = allTools.some((item) => item.source === "pi" && item.locked);

  return <>
    <PageHeading title="工具与连接器" description="统一维护框架内置、PI 官方工具及业务连接器。管理员开放、用户选择、相关性筛选，都不能扩大当前业务身份的权限。" actions={<ResourceActions refresh={refresh} />} />
    <Alert type="info" showIcon title={localLocked ? "本部署未开放本机执行" : "本机执行由部署者开放"} description={localLocked ? "PI Shell、文件读写和 CodeMode 在下方完整列出，但由 WEBAGENT_LOCAL_TOOLS=off 锁定关闭，不是沙箱执行。基础工具可随时停用；BM25 使用 PI 官方实现，和运行设置中的开关同步。" : "WEBAGENT_LOCAL_TOOLS=admin 已开放本机工具定义；仍需在目录中逐项启用，且没有沙箱，仅适合受信任单租户部署。"} style={{ marginBottom: 20 }} />
    {notice && <Alert title={notice} type="success" showIcon closable onClose={() => setNotice("")} style={{ marginBottom: 16 }} />}
    {error && draft === null && <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: "catalog", label: `工具目录 · ${resource.data?.items.length || 0}`, children: <PageState {...resource}>
        <div className="control-actions" style={{ marginBottom: 18, flexWrap: "wrap" }}>
          <Input prefix={<Search size={15} />} aria-label="搜索工具" placeholder="搜索名称、标识或说明" value={query} onChange={(event) => setQuery(event.target.value)} allowClear style={{ width: 290, maxWidth: "100%" }} />
          <Select aria-label="工具来源" value={source} onChange={setSource} options={sourceOptions} style={{ width: 170 }} />
          <span className="control-muted">未配置的内置工具仍列出，启用策略与实际可用状态分开显示。</span>
        </div>
        <div className="control-actions" style={{ margin: "-6px 0 18px", flexWrap: "wrap" }}>
          <span className="control-muted">标签</span>
          <Tag.CheckableTag checked={tagFilter === "全部"} onChange={() => setTagFilter("全部")}>全部</Tag.CheckableTag>
          {allTags.map((tag) => <Tag.CheckableTag key={tag} checked={tagFilter === tag} onChange={() => setTagFilter(tag)}>{tag}</Tag.CheckableTag>)}
        </div>
        <Table rowKey="name" dataSource={items} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1120 }} columns={[
          { title: "工具", dataIndex: "title", width: 285, render: (value, row) => <div><strong>{value || row.name}</strong><div className="control-muted">{row.name}</div><Tooltip title={row.description}><div className="control-muted" style={{ maxWidth: 265, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.description}</div></Tooltip><div style={{ marginTop: 5 }}>{(row.tags || []).map((tag: string) => <Tag key={tag} bordered={false}>{tag}</Tag>)}</div></div> },
          { title: "来源", dataIndex: "source", width: 140, render: (value, row) => <div><Tag color={value === "pi" ? "purple" : value === "mcp" ? "blue" : value === "http" ? "gold" : "green"}>{sourceLabel(value)}</Tag><div className="control-muted">{row.category}</div></div> },
          { title: "风险 / 权限", width: 155, render: (_, row) => <div><Tag color={row.risk === "read" ? "default" : "orange"}>{row.risk === "read" ? "只读" : row.risk === "delete" ? "删除" : "写入"}</Tag><div className="control-muted">{row.permission || "基础能力"}</div></div> },
          { title: "状态", width: 130, render: (_, row) => <Tooltip title={row.blocked_reason}><span>{row.locked ? <Tag icon={<LockKeyhole size={11} />}>部署禁用</Tag> : row.configured === false ? <Tag color="gold">待配置</Tag> : <Tag color={row.enabled ? "green" : "default"}>{row.enabled ? "已启用" : "已停用"}</Tag>}</span></Tooltip> },
          { title: "启用", dataIndex: "enabled", width: 95, render: (value, row) => <Tooltip title={row.locked ? row.blocked_reason : row.name === "tool_search" ? "与运行设置的 BM25 开关同步" : "停用后不再提供给模型，每次执行前也会重新检查"}><Switch aria-label={`启用 ${row.name}`} checked={Boolean(value)} disabled={row.locked} loading={updating.includes(row.name)} onChange={(enabled) => void updatePolicy(row, { enabled })} /></Tooltip> },
          { title: "用户使用策略", width: 220, render: (_, row) => row.policy_editable ? <Select aria-label={`${row.name} 用户策略`} style={{ width: 205 }} value={policy(row)} disabled={updating.includes(row.name)} options={policyOptions} onChange={(value) => void updatePolicy(row, policyValue(value))} /> : <span className="control-muted">{row.locked ? "不可开放" : "运行时内部能力"}</span> },
          { title: "标签", width: 90, render: (_, row) => <Button size="small" onClick={() => { setTagDraft(row); setTagValues(row.tags || []); }}>编辑</Button> },
          { title: "定义", width: 70, render: (_, row) => <Button size="small" onClick={() => setJson({ name: row.name, source: row.source, input_schema: row.input_schema, description: row.description, blocked_reason: row.blocked_reason })}>查看</Button> },
        ]} />
      </PageState> },
      { key: "http", label: "HTTP API", children: <>
        <div className="control-actions" style={{ marginBottom: 18 }}><Button type="primary" icon={<Plus size={15} />} onClick={() => edit("http")}>新增 HTTP 工具</Button><span className="control-muted">原生函数由开发者通过 SDK 注册，不能在后台上传可执行代码。</span></div>
        <PageState {...dynamic}><Table rowKey="id" dataSource={dynamic.data?.items} scroll={{ x: 700 }} columns={[
          { title: "名称", dataIndex: "display_name", render: (value, row) => value || row.name },
          { title: "方法", dataIndex: "method", render: (value) => <Tag>{value}</Tag> },
          { title: "业务接口", dataIndex: "url_template", ellipsis: true },
          { title: "状态", dataIndex: "enabled", render: (enabled) => <Tag color={enabled ? "green" : "default"}>{enabled ? "连接器启用" : "连接器停用"}</Tag> },
          { title: "操作", render: (_, row) => <Space><Button type="text" icon={<Pencil size={15} />} aria-label="编辑 HTTP 工具" onClick={() => edit("http", row)} /><Popconfirm title="删除 HTTP 工具？" onConfirm={() => act(async () => { await controlRequest(`/admin/dynamic-tools/${row.id}`, undefined, "DELETE"); await refresh(); })}><Button type="text" danger icon={<Trash2 size={15} />} aria-label="删除 HTTP 工具" /></Popconfirm></Space> },
        ]} /></PageState>
      </> },
      { key: "mcp", label: "MCP 连接器", children: <>
        <div className="control-actions" style={{ marginBottom: 18 }}><Button type="primary" icon={<Plus size={15} />} onClick={() => edit("mcp")}>新增 MCP</Button><Button onClick={() => setImporting(true)}>导入 JSON</Button><span className="control-muted">推荐远端 HTTP / SSE；stdio 默认禁止启动本机进程。</span></div>
        <Alert type="info" showIcon title="先测试并同步工具目录，再配置各工具的 permission 或 public。未映射权限的 MCP 工具不会开放给用户。stdio 只能由部署者显式允许，后台开关不能绕过。" style={{ marginBottom: 16 }} />
        <PageState {...mcp}><Table rowKey="id" dataSource={mcp.data?.items} scroll={{ x: 700 }} columns={[
          { title: "连接器", dataIndex: "name" },
          { title: "协议", dataIndex: "transport", render: (value) => <Tag>{value}</Tag> },
          { title: "已发现工具", render: (_, row) => row.config.cached_tools?.length || 0 },
          { title: "凭据", render: (_, row) => row.config.has_secrets ? <Tag color="green">已加密保存</Tag> : "未配置" },
          { title: "操作", render: (_, row) => <Space><Button size="small" icon={<FlaskConical size={14} />} onClick={() => void act(async () => { const result = await controlRequest<Row>(`/admin/mcp-servers/${row.id}/test`, {}); setNotice(result.message); await refresh(); })}>测试 / 同步</Button><Button type="text" icon={<Pencil size={15} />} aria-label="编辑 MCP" onClick={() => edit("mcp", row)} /><Popconfirm title="删除 MCP 连接器？" onConfirm={() => act(async () => { await controlRequest(`/admin/mcp-servers/${row.id}`, undefined, "DELETE"); await refresh(); })}><Button type="text" danger icon={<Trash2 size={15} />} aria-label="删除 MCP" /></Popconfirm></Space> },
        ]} /></PageState>
        {importing && <McpImportDialog onClose={() => setImporting(false)} onSaved={refresh} />}
      </> },
    ]} />
    <Modal open={draft !== null} title={`${draft?.row.id ? "编辑" : "新增"}${draft?.type === "http" ? " HTTP 工具" : " MCP 连接器"}`} width={820} onCancel={() => setDraft(null)} onOk={() => form.submit()} confirmLoading={saving} okText="保存" cancelText="取消">
      {error && <Alert title={error} type="error" showIcon style={{ marginBottom: 18 }} />}
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="name" label={draft?.type === "http" ? "工具标识（英文）" : "连接器名称"} rules={[{ required: true }]}><Input /></Form.Item>
        {draft?.type === "http" ? <>
          <Form.Item name="display_name" label="显示名称"><Input /></Form.Item>
          <Form.Item name="description" label="工具描述" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <div className="control-grid"><Form.Item name="method" label="HTTP 方法"><Select options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value }))} /></Form.Item><Form.Item name="risk" label="风险等级"><Select options={[{ value: "read", label: "只读" }, { value: "write", label: "写入（需确认）" }, { value: "delete", label: "删除（需确认）" }]} /></Form.Item></div>
          <Form.Item name="permission" label="业务权限码" extra="权限码由业务身份适配器返回；写入仍由目标 API 最终授权。"><Input placeholder="record:read" /></Form.Item>
          <Form.Item name="url_template" label="接口 URL 模板" rules={[{ required: true }]} extra="路径变量：{record_id}；当前用户 Bearer Token 由后端注入。"><Input placeholder="https://business.example/api/records/{record_id}" /></Form.Item>
          <Form.Item name="schema_json" label="输入 JSON Schema"><Input.TextArea rows={5} spellCheck={false} /></Form.Item>
        </> : <>
          <Form.Item name="transport" label="传输方式"><Select options={[{ value: "http", label: "Streamable HTTP" }, { value: "sse", label: "SSE（兼容旧服务）" }, { value: "stdio", label: "stdio（默认禁止，需部署者允许）" }]} /></Form.Item>
          {transport === "stdio" ? <><Form.Item name="command" label="可执行命令" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="args_json" label="参数数组 JSON"><Input.TextArea rows={2} /></Form.Item><Form.Item name="env_json" label="环境变量 JSON（加密保存）"><Input.TextArea rows={3} /></Form.Item></> : <Form.Item name="url" label="MCP 地址" rules={[{ required: true }]}><Input placeholder="https://example.com/mcp" /></Form.Item>}
          <Form.Item name="forward_user_token" label="转发当前业务 Token" valuePropName="checked" extra="仅向受信任的业务 MCP 开启，第三方 MCP 通常使用自己的服务密钥。"><Switch /></Form.Item>
          <Form.Item name="policies_json" label="工具权限映射 JSON" extra={'例如 {"search":{"public":true,"risk":"read"},"update":{"permission":"record:update","risk":"write"}}'}><Input.TextArea rows={5} spellCheck={false} /></Form.Item>
        </>}
          <Form.Item name="headers_json" label={draft?.type === "mcp" ? "请求头 JSON（加密保存，留空保留已存密钥）" : "附加请求头 JSON"} extra={draft?.type === "http" ? "支持 ${user.id}、${session.id}；不允许覆盖 Authorization。" : "填写后会与已存密钥合并覆盖；留空保留已存密钥。例如 Authorization: Bearer …"}><Input.TextArea rows={3} spellCheck={false} /></Form.Item>
        <Form.Item name="enabled" label="启用连接器" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
    <Modal open={json !== null} title="工具定义" footer={<Button onClick={() => setJson(null)}>关闭</Button>} onCancel={() => setJson(null)} width={800}><pre className="control-json">{JSON.stringify(json, null, 2)}</pre></Modal>
    <Modal open={tagDraft !== null} title={`编辑标签 · ${tagDraft?.title || tagDraft?.name || ""}`} onCancel={() => setTagDraft(null)} onOk={() => void saveTags()} confirmLoading={saving} okText="保存标签" cancelText="取消">
      <p className="control-muted">标签用于后台平铺筛选；不会改变工具权限，也不会自动注入模型上下文。来源标签会始终保留。</p>
      <Select mode="tags" value={tagValues} onChange={setTagValues} tokenSeparators={[",", "，"]} placeholder="输入标签后回车" options={allTags.map((tag) => ({ value: tag, label: tag }))} style={{ width: "100%" }} maxTagCount={12} />
    </Modal>
  </>;
}
