import { useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import { Copy, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";

const API = "/admin/access-tokens";

function isoOrNull(value?: string) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("过期时间格式无效");
  return date.toISOString();
}

function localDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AccessTokensPage() {
  const resource = useResource<{ items: Row[]; assistants: Row[] }>(API);
  const adminResource = useResource<{ items: Row[] }>("/admin/control-tokens");
  const [draft, setDraft] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<{ token: string; name: string } | null>(null);
  const [adminDraft, setAdminDraft] = useState<Row | null>(null);
  const [adminForm] = Form.useForm();
  const [adminError, setAdminError] = useState("");
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminIssued, setAdminIssued] = useState<{ token: string; name: string } | null>(null);
  const [copyState, setCopyState] = useState("");
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);

  const edit = (row: Row = {}) => {
    setDraft(row);
    setError("");
    form.resetFields();
    form.setFieldsValue({
      ...row,
      channel: row.channel || "chat",
      enabled: row.enabled ?? true,
      rate_limit_per_minute: row.rate_limit_per_minute ?? 60,
      daily_token_limit: row.daily_token_limit ?? 0,
      session_retention_days: row.session_retention_days ?? 0,
      allowed_origins_text: (row.allowed_origins || []).join("\n"),
      expires_local: localDate(row.expires_at),
    });
  };

  const save = async (values: Row) => {
    setSaving(true);
    setError("");
    try {
      const payload = {
      name: values.name,
      assistant_id: values.assistant_id,
      channel: values.channel || "chat",
      enabled: values.enabled,
        expires_at: isoOrNull(values.expires_local),
        allowed_origins: String(values.allowed_origins_text || "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean),
        rate_limit_per_minute: values.rate_limit_per_minute || 0,
        daily_token_limit: values.daily_token_limit || 0,
        session_retention_days: values.session_retention_days || 0,
      };
      if (draft?.id) {
        await controlRequest(`${API}/${draft.id}`, payload, "PUT");
        setNotice("接入 Token 配置已保存；原始 Token 不变。");
      } else {
        const result = await controlRequest<{ token: string; access_token: Row }>(API, payload);
        setIssued({ token: result.token, name: result.access_token.name });
        setNotice("接入 Token 已创建。原始值只显示一次。");
      }
      setDraft(null);
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async (row: Row) => {
    setError("");
    try {
      const result = await controlRequest<{ token: string }>(`${API}/${row.id}/rotate`, {});
      setIssued({ token: result.token, name: row.name });
      setNotice("Token 已轮换，旧会话已失效。");
      await resource.refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure));
    }
  };
  const copyToken = async (token: string | undefined, scope: "access" | "admin") => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyState(scope === "access" ? "access" : "admin");
    } catch {
      setCopyState("");
    }
  };
  const copyRowToken = async (token: string | undefined, key: string) => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyState(key);
      setNotice("Token 已复制到剪贴板。");
    } catch {
      setCopyState("");
      setError("复制失败，请点击「查看」后手动复制。");
    }
  };

  const editAdmin = (row: Row = {}) => {
    setAdminDraft(row);
    setAdminError("");
    adminForm.resetFields();
    adminForm.setFieldsValue({
      ...row,
      enabled: row.enabled ?? true,
      allowed_origins_text: (row.allowed_origins || []).join("\n"),
      expires_local: localDate(row.expires_at),
    });
  };

  const saveAdmin = async (values: Row) => {
    setAdminSaving(true);
    setAdminError("");
    try {
      const payload = {
        name: values.name,
        enabled: values.enabled,
        expires_at: isoOrNull(values.expires_local),
        allowed_origins: String(values.allowed_origins_text || "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean),
      };
      if (adminDraft?.id) {
        await controlRequest(`/admin/control-tokens/${adminDraft.id}`, payload, "PUT");
        setNotice("管理 Token 配置已保存；原始 Token 不变。");
      } else {
        const result = await controlRequest<{ token: string; control_token: Row }>("/admin/control-tokens", payload);
        setAdminIssued({ token: result.token, name: result.control_token.name });
        setNotice("管理 Token 已创建。原始值只显示一次。");
      }
      setAdminDraft(null);
      await adminResource.refresh();
    } catch (failure) {
      setAdminError(apiErrorMessage(failure));
    } finally {
      setAdminSaving(false);
    }
  };

  const rotateAdmin = async (row: Row) => {
    setAdminError("");
    try {
      const result = await controlRequest<{ token: string }>(`/admin/control-tokens/${row.id}/rotate`, {});
      setAdminIssued({ token: result.token, name: row.name });
      setNotice("管理 Token 已轮换，旧 Token 立即失效。");
      await adminResource.refresh();
    } catch (failure) {
      setAdminError(apiErrorMessage(failure));
    }
  };

  return (
    <>
      <PageHeading
        title="接入与安全"
        description="为 Chat、大屏或第三方前端签发；只访问 /api/agent/*。"
        actions={<ResourceActions refresh={resource.refresh} add={() => edit()} label="新增接入 Token" />}
      />
      {notice && <Alert title={notice} type="success" showIcon closable onClose={() => setNotice("")} style={{ marginBottom: 16 }} />}
      {error && draft === null && <Alert title={error} type="error" showIcon closable onClose={() => setError("")} style={{ marginBottom: 16 }} />}
      <p className="control-muted" style={{ marginBottom: 16 }}>接入 Token 只代表前端接入身份，不携带业务权限；PC4D 三端用 pid 换取 2 小时短期凭据。</p>
      <PageState {...resource}>
        <Table
          rowKey="id"
          dataSource={resource.data?.items}
          scroll={{ x: 1120 }}
          columns={[
            {
              title: "Token",
              width: 270,
              render: (_, row) => {
                const value = String(row.token || "");
                return (
                  <div>
                    <strong>{row.name}</strong>
                    <div className="control-muted">
                      <code>{value ? `${value.slice(0, 12)}…` : `${row.token_prefix}…`}</code>
                      {row.last_used_at ? ` · 最近使用 ${new Date(row.last_used_at).toLocaleString("zh-CN")}` : " · 尚未使用"}
                    </div>
                    <div className="control-muted">
                      {row.sessions_count || 0} 个匿名会话
                      {value ? (
                        <Button type="link" size="small" style={{ padding: "0 0 0 8px" }} onClick={() => setRevealed({ name: row.name, token: value })}>查看完整 Token</Button>
                      ) : (
                        <span> · 原文不可用，轮换后可查看</span>
                      )}
                    </div>
                  </div>
                );
              },
            },
            {
              title: "使用渠道",
              width: 130,
              render: (_, row) => {
                const labels: Record<string, string> = { chat: "独立 Chat", screen: "PC4D 大屏", web: "PC4D Web", miniprogram: "PC4D 小程序" };
                return <Tag color={row.channel && row.channel !== "chat" ? "blue" : "default"}>{labels[row.channel] || "独立 Chat"}</Tag>;
              },
            },
            { title: "绑定助手", dataIndex: "assistant_name", width: 160, render: (value) => value || "助手已删除" },
            {
              title: "状态",
              width: 130,
              render: (_, row) => {
                const expired = row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
                return <Space direction="vertical" size={3}><Tag color={!row.enabled ? "default" : expired ? "orange" : "green"}>{!row.enabled ? "已停用" : expired ? "已过期" : "有效"}</Tag>{row.expires_at && <small className="control-muted">{new Date(row.expires_at).toLocaleString("zh-CN")}</small>}</Space>;
              },
            },
            { title: "频率/日限额", width: 140, render: (_, row) => <div className="control-muted">{row.rate_limit_per_minute ? `${row.rate_limit_per_minute}/分钟` : "不限频率"}<br />{row.daily_token_limit ? `${row.daily_token_limit.toLocaleString()} Token/日` : "不限日额度"}</div> },
            { title: "会话保留", width: 105, render: (_, row) => row.session_retention_days ? `${row.session_retention_days} 天` : "跟随全局" },
            { title: "允许来源", width: 190, render: (_, row) => row.allowed_origins?.length ? <Tooltip title={row.allowed_origins.join("\n")}><span>{row.allowed_origins.length} 个 Origin</span></Tooltip> : <span className="control-muted">不限制 Origin</span> },
            {
              title: "操作",
              width: 300,
              fixed: "right",
              render: (_, row) => <Space>
                <Tooltip title={row.token ? "复制完整 Token" : "旧 Token 未保存原文，请先轮换"}>
                  <Button size="small" type="text" icon={<Copy size={14} />} disabled={!row.token} onClick={() => void copyRowToken(String(row.token || ""), `access-${row.id}`)}>{copyState === `access-${row.id}` ? "已复制" : "复制"}</Button>
                </Tooltip>
                <Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => edit(row)}>编辑</Button>
                <Popconfirm title="轮换后旧 Token 立即失效，确定继续？" onConfirm={() => void rotate(row)}><Button size="small" type="text" icon={<RefreshCw size={14} />}>轮换</Button></Popconfirm>
                <Popconfirm title="删除这个接入 Token？" description="匿名会话和接入会话记录会一起清理。" onConfirm={async () => { try { await controlRequest(`${API}/${row.id}`, undefined, "DELETE"); setNotice("接入 Token 已删除。"); await resource.refresh(); } catch (failure) { setError(apiErrorMessage(failure)); } }}><Button size="small" type="text" danger icon={<Trash2 size={14} />} aria-label="删除接入 Token" /></Popconfirm>
              </Space>,
            },
          ]}
        />
      </PageState>

      <section className="control-card" style={{ marginTop: 20 }}>
        <div className="control-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}><ShieldCheck size={17} /> 管理端 Token</h2>
            <p className="control-muted" style={{ margin: "6px 0 0" }}>用于管理端跨域或嵌入业务系统；拥有管理 API 权限，不能访问 Chat。</p>
          </div>
          <Space>
            <Button icon={<RefreshCw size={14} />} onClick={() => void adminResource.refresh()}>刷新</Button>
            <Button type="primary" icon={<Plus size={15} />} onClick={() => editAdmin()}>新增管理 Token</Button>
          </Space>
        </div>
        <Alert
          type="warning"
          showIcon
          title="管理 Token 等同管理员密码，只保存在调用方浏览器；泄露后立即轮换。"
          style={{ marginBottom: 16 }}
        />
        {adminError && <Alert title={adminError} type="error" showIcon closable onClose={() => setAdminError("")} style={{ marginBottom: 16 }} />}
        <PageState {...adminResource}>
          <Table
            rowKey="id"
            dataSource={adminResource.data?.items}
            pagination={false}
            scroll={{ x: 900 }}
            columns={[
              {
                title: "Token",
                width: 280,
                render: (_, row) => {
                  const value = String(row.token || "");
                  return (
                    <div>
                      <strong>{row.name}</strong>
                      <div className="control-muted">
                        <code>{value ? `${value.slice(0, 12)}…` : `${row.token_prefix}…`}</code>
                        {row.last_used_at ? ` · 最近使用 ${new Date(row.last_used_at).toLocaleString("zh-CN")}` : " · 尚未使用"}
                      </div>
                      {value ? (
                        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setRevealed({ name: row.name, token: value })}>查看完整 Token</Button>
                      ) : (
                        <span className="control-muted">原文不可用，轮换后可查看</span>
                      )}
                    </div>
                  );
                },
              },
              {
                title: "状态",
                width: 130,
                render: (_, row) => {
                  const expired = row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
                  return <Space direction="vertical" size={3}><Tag color={!row.enabled ? "default" : expired ? "orange" : "green"}>{!row.enabled ? "已停用" : expired ? "已过期" : "有效"}</Tag>{row.expires_at && <small className="control-muted">{new Date(row.expires_at).toLocaleString("zh-CN")}</small>}</Space>;
                },
              },
              { title: "允许来源", width: 240, render: (_, row) => row.allowed_origins?.length ? <Tooltip title={row.allowed_origins.join("\n")}><span>{row.allowed_origins.includes("*") ? "允许任意 Origin" : `${row.allowed_origins.length} 个 Origin`}</span></Tooltip> : <span className="control-muted">仅同源</span> },
              { title: "创建人", dataIndex: "created_by", width: 180, render: (value) => <span className="control-muted">{value || "—"}</span> },
              {
                title: "操作",
                width: 290,
                fixed: "right",
                render: (_, row) => <Space>
                  <Tooltip title={row.token ? "复制完整管理 Token" : "旧 Token 未保存原文，请先轮换"}>
                    <Button size="small" type="text" icon={<Copy size={14} />} disabled={!row.token} onClick={() => void copyRowToken(String(row.token || ""), `admin-${row.id}`)}>{copyState === `admin-${row.id}` ? "已复制" : "复制"}</Button>
                  </Tooltip>
                  <Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => editAdmin(row)}>编辑</Button>
                  <Popconfirm title="轮换后旧管理 Token 立即失效，确定继续？" onConfirm={() => void rotateAdmin(row)}><Button size="small" type="text" icon={<RefreshCw size={14} />}>轮换</Button></Popconfirm>
                  <Popconfirm title="删除这个管理 Token？" onConfirm={async () => { try { await controlRequest(`/admin/control-tokens/${row.id}`, undefined, "DELETE"); setNotice("管理 Token 已删除。"); await adminResource.refresh(); } catch (failure) { setAdminError(apiErrorMessage(failure)); } }}><Button size="small" type="text" danger icon={<Trash2 size={14} />} aria-label="删除管理 Token" /></Popconfirm>
                </Space>,
              },
            ]}
          />
        </PageState>
      </section>

      <Modal
        open={draft !== null}
        title={draft?.id ? "编辑接入 Token" : "新增接入 Token"}
        width={680}
        onCancel={() => setDraft(null)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={draft?.id ? "保存配置" : "创建 Token"}
        cancelText="取消"
      >
        {error && <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={save}>
          <div className="control-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如：大屏公开助手" /></Form.Item>
            <Form.Item name="channel" label="使用渠道" extra="PC4D 渠道由服务端选择对应 Token；同一渠道只启用一个 Token 最清晰。">
              <Select options={[
                { value: "chat", label: "独立 Chat / 第三方前端" },
                { value: "screen", label: "PC4D 大屏" },
                { value: "web", label: "PC4D Web" },
                { value: "miniprogram", label: "PC4D 小程序" },
              ]} />
            </Form.Item>
            <Form.Item name="assistant_id" label="绑定助手" rules={[{ required: true }]}>
              <Select options={(resource.data?.assistants || []).map((assistant) => ({ value: assistant.id, label: assistant.name }))} placeholder="选择唯一助手" />
            </Form.Item>
          </div>
          <div className="control-grid">
            <Form.Item name="expires_local" label="过期时间（可空）"><Input type="datetime-local" /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </div>
          <div className="control-grid">
            <Form.Item name="rate_limit_per_minute" label="每分钟请求上限" extra="0 表示不限制；按 Token + 浏览器访客限流。"><InputNumber min={0} max={100000} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="daily_token_limit" label="每日 Token 上限" extra="0 表示不限制；只约束该 Token 的会话。"><InputNumber min={0} max={1000000000} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="session_retention_days" label="会话保留天数" extra="0 跟随全局；只清理该 Token 的匿名会话。"><InputNumber min={0} max={3650} style={{ width: "100%" }} /></Form.Item>
          </div>
          <Form.Item name="allowed_origins_text" label="允许来源 Origin（每行一个）" extra="留空不限制。仅允许 http(s)://host 或 *；生产环境建议填写，防止 Token 被其他站点直接使用。" rules={[{ validator: (_, value) => Promise.all(String(value || "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean).map((item) => item === "*" || /^https?:\/\/[\w.-]+(:\d+)?\/?$/i.test(item) ? Promise.resolve() : Promise.reject(new Error(`来源格式无效：${item}`)))).then(() => Promise.resolve()) }]}>
            <Input.TextArea rows={4} placeholder="https://ops.example.com" spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(issued)}
        title="请立即保存接入 Token"
        onCancel={() => setIssued(null)}
        maskClosable={false}
        keyboard={false}
        footer={<Space><Button onClick={() => void copyToken(issued?.token, "access")} icon={<Copy size={14} />}>{copyState === "access" ? "已复制" : "复制"}</Button><Button type="primary" onClick={() => setIssued(null)}>我已保存</Button></Space>}
      >
        <Alert type="info" showIcon title="Token 已加密保存，可通过列表取回原文；泄露后请立即轮换。" style={{ marginBottom: 16 }} />
        <p className="control-muted">接入方式：打开 <code>/chat/?token=...</code>，或前端向 <code>/api/agent/auth/exchange</code> 发送 <code>Authorization: Bearer &lt;token&gt;</code> 换取浏览器会话 Cookie。</p>
        <Input.TextArea value={issued?.token || ""} readOnly rows={3} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      </Modal>

      <Modal
        open={adminDraft !== null}
        title={adminDraft?.id ? "编辑管理 Token" : "新增管理 Token"}
        width={640}
        onCancel={() => setAdminDraft(null)}
        onOk={() => adminForm.submit()}
        confirmLoading={adminSaving}
        okText={adminDraft?.id ? "保存配置" : "创建 Token"}
        cancelText="取消"
      >
        {adminError && <Alert title={adminError} type="error" showIcon style={{ marginBottom: 16 }} />}
        <Form form={adminForm} layout="vertical" onFinish={saveAdmin}>
          <div className="control-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如：业务系统管理端" /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </div>
          <Form.Item name="expires_local" label="过期时间（可空）" extra="建议生产环境设置有效期；留空表示长期有效。">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="allowed_origins_text" label="允许来源 Origin（每行一个）" extra="跨域部署时填写管理端所在 Origin，例如 https://ops.example.com；留空只允许同源。填写 * 允许任意来源，不推荐。" rules={[{ validator: (_, value) => Promise.all(String(value || "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean).map((item) => item === "*" || /^https?:\/\/[\w.-]+(:\d+)?\/?$/i.test(item) ? Promise.resolve() : Promise.reject(new Error(`来源格式无效：${item}`)))).then(() => Promise.resolve()) }]}>
            <Input.TextArea rows={4} placeholder="https://ops.example.com" spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(adminIssued)}
        title="请立即保存管理 Token"
        onCancel={() => setAdminIssued(null)}
        maskClosable={false}
        keyboard={false}
        footer={<Space><Button onClick={() => void copyToken(adminIssued?.token, "admin")} icon={<Copy size={14} />}>{copyState === "admin" ? "已复制" : "复制"}</Button><Button type="primary" onClick={() => setAdminIssued(null)}>我已保存</Button></Space>}
      >
        <Alert type="warning" showIcon title="管理 Token 等同管理员密码，勿放入前端源码或公开仓库。" style={{ marginBottom: 16 }} />
        <p className="control-muted">使用方式：打开管理端登录页，点击「使用管理 Token 连接」，填写 API 地址与 Token。同源部署地址留空；独立后端填写 <code>https://your-host/api/control</code>。</p>
        <Input.TextArea value={adminIssued?.token || ""} readOnly rows={3} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      </Modal>

      <Modal
        open={Boolean(revealed)}
        title={`Token：${revealed?.name || ""}`}
        onCancel={() => setRevealed(null)}
        footer={<Space><Button icon={<Copy size={14} />} onClick={() => void copyRowToken(revealed?.token, "revealed")}>{copyState === "revealed" ? "已复制" : "复制"}</Button><Button type="primary" onClick={() => setRevealed(null)}>关闭</Button></Space>}
      >
        <Alert type="warning" showIcon title="仅在受控渠道使用；泄露后立即轮换。" style={{ marginBottom: 16 }} />
        <Input.TextArea value={revealed?.token || ""} readOnly rows={3} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
      </Modal>
    </>
  );
}
