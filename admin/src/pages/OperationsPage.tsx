import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, Select, Space, Table, Tabs, Tag } from "antd";
import { Save } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";

export default function OperationsPage() {
  const pagepilot = useResource<Row>("/admin/pagepilot");
  const audit = useResource<{ items: Row[] }>("/admin/audit");
  const usage = useResource<Row>("/admin/usage/summary");
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(""); const [result, setResult] = useState<{ ok: boolean; message: string }>();
  useEffect(() => { if (pagepilot.data) form.setFieldsValue({ ...pagepilot.data, token: "" }); }, [pagepilot.data, form]);
  const act = async (mode: "save" | "test") => {
    setBusy(mode); setResult(undefined);
    try {
      if (mode === "test") setResult(await controlRequest("/admin/pagepilot/test", {}));
      else { await controlRequest("/admin/pagepilot", await form.validateFields(), "PUT"); setResult({ ok: true, message: "发布连接器已保存" }); await pagepilot.refresh(); }
    } catch (failure) { setResult({ ok: false, message: apiErrorMessage(failure) }); }
    finally { setBusy(""); }
  };
  return <><PageHeading title="发布与审计" description="框架的发布连接器、真实用量与操作追溯。PagePilot 使用全局连接凭据，但发布内容和 URL 按本地业务 user_id 隔离，不拉取共享账号下的远端全量页面。" actions={<ResourceActions refresh={() => Promise.all([pagepilot.refresh(), audit.refresh(), usage.refresh()])} />} /><Tabs items={[
    { key: "pagepilot", label: "PagePilot", children: <PageState {...pagepilot}><section className="control-card"><h2>发布连接器</h2>{result && <Alert type={result.ok ? "success" : "error"} title={result.message} showIcon style={{ marginBottom: 20 }} />}<Form form={form} layout="vertical" onFinish={() => void act("save")}><Form.Item name="base_url" label="服务地址" rules={[{ type: "url", message: "请填写完整的 HTTP(S) 地址" }]}><Input placeholder="https://your-pagepilot.example" /></Form.Item><Form.Item name="token" label="API Token" extra={pagepilot.data?.token_set ? `已保存 ${pagepilot.data.token_masked}；留空保留原密钥。` : "未配置，不会开放发布工具。"}><Input.Password autoComplete="new-password" /></Form.Item><Space size="large"><Form.Item name="enabled" valuePropName="checked"><Checkbox>启用连接器</Checkbox></Form.Item><Form.Item name="clear_token" valuePropName="checked"><Checkbox>清除已存 Token</Checkbox></Form.Item></Space><div className="control-grid"><Form.Item name="default_title" label="标题附加内容" extra="可留空。设置 AAA 时，发布标题拼接为 用户标题（AAA）。"><Input maxLength={100} /></Form.Item><Form.Item name="default_visibility" label="默认可见范围" extra="用户发布时仍可选择；不会替用户设置密码。"><Select options={[{ value: "unlisted", label: "不在广场列出" }, { value: "public", label: "公开到创作广场" }]} /></Form.Item></div><Form.Item name="default_description" label="默认说明" extra="可留空。优先使用用户或模型提供的说明。"><Input.TextArea rows={2} maxLength={240} /></Form.Item><Alert type="info" showIcon title="密码只在每次发布或更新时由用户填写，留空即无密码；系统不自动生成密码。Agent 发布属于写入操作，默认需要用户审批。" style={{ marginBottom: 20 }} /><Space><Button type="primary" htmlType="submit" loading={busy === "save"} icon={<Save size={15} />}>保存连接器</Button><Button loading={busy === "test"} onClick={() => void act("test")}>测试已保存连接</Button></Space></Form></section></PageState> },
    { key: "usage", label: "用量与耗时", children: <PageState {...usage}><div className="control-grid control-grid--3">{[["模型请求", usage.data?.totals.calls || 0], ["总 Token", Number(usage.data?.totals.total_tokens || 0).toLocaleString()], ["平均耗时", `${((usage.data?.totals.avg_latency_ms || 0) / 1000).toFixed(2)}s`]].map(([label, value]) => <section className="control-card" key={String(label)}><span className="control-muted">{label}</span><div className="control-metric">{value}</div></section>)}</div><Table rowKey="id" dataSource={usage.data?.calls} scroll={{ x: 820 }} pagination={{ pageSize: 15 }} columns={[{ title: "业务用户", dataIndex: "username" }, { title: "模型", dataIndex: "model" }, { title: "用途", dataIndex: "purpose", render: (value) => <Tag>{value}</Tag> }, { title: "Token", dataIndex: "total_tokens" }, { title: "耗时", dataIndex: "latency_ms", render: (value) => `${(value / 1000).toFixed(2)}s` }, { title: "状态", dataIndex: "status" }]} /></PageState> },
    { key: "audit", label: "操作审计", children: <PageState {...audit}><Table rowKey="id" dataSource={audit.data?.items} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} expandable={{ expandedRowRender: (row) => <pre className="control-json">{row.detail}</pre> }} columns={[{ title: "时间", dataIndex: "ts", render: (value) => new Date(value).toLocaleString("zh-CN") }, { title: "账号", dataIndex: "username" }, { title: "动作", dataIndex: "action" }, { title: "资源", dataIndex: "resource", ellipsis: true }]} /></PageState> },
  ]} /></>;
}
