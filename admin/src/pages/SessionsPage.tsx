import { useEffect, useState } from "react";
import { Alert, Button, Collapse, Descriptions, Drawer, Input, InputNumber, Modal, Popconfirm, Space, Table, Tabs, Tag } from "antd";
import { Database, Download, Eraser, Search, Trash2 } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";
import { PageHeading, PageState, ResourceActions, useResource, type Row } from "./shared";

const elapsed = (value: number) => `${((value || 0) / 1000).toFixed(2)}s`;
interface SessionDetail extends Row { session: Row; runs: Row[]; messages: Row[]; llm_calls: Row[]; compactions: Row[] }
export default function SessionsPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const sessionsPath = `/admin/sessions?limit=${pageSize}&offset=${(page - 1) * pageSize}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const resource = useResource<{ items: Row[]; total: number; all_total: number }>(sessionsPath);
  const storage = useResource<Row>("/admin/storage");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [diagnostic, setDiagnostic] = useState<Row | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vacuuming, setVacuuming] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState<number>(30);
  const [cleanupPreview, setCleanupPreview] = useState<Row | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const inspect = async (id: string) => {
    setInspecting(true); setError("");
    try { setDetail(await controlRequest<SessionDetail>(`/admin/sessions/${encodeURIComponent(id)}`)); }
    catch (failure) { setError(apiErrorMessage(failure)); }
    finally { setInspecting(false); }
  };
  const calls = (rows: Row[]) => <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
    { title: "用途 / 模型", render: (_, row) => <><Tag>{row.purpose}</Tag>{row.model}</> },
    { title: "耗时", dataIndex: "latency_ms", render: elapsed },
    { title: "Token", dataIndex: "total_tokens" },
    { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "ok" ? "green" : "red"}>{value}</Tag> },
    { title: "错误", dataIndex: "error", ellipsis: true },
  ]} />;
  const refreshAll = () => Promise.all([resource.refresh(), storage.refresh()]);
  const previewCleanup = async () => { setCleaning(true); setError(""); try { setCleanupPreview(await controlRequest<Row>("/admin/sessions/cleanup-preview", { days: cleanupDays })); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setCleaning(false); } };
  const runCleanup = async () => { setCleaning(true); setError(""); try { await controlRequest("/admin/sessions/cleanup", { days: cleanupDays }); setCleanupOpen(false); setCleanupPreview(null); await refreshAll(); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setCleaning(false); } };
  const removeSession = async (id: string) => { try { await controlRequest(`/admin/sessions/${encodeURIComponent(id)}`, undefined, "DELETE"); if (detail?.session.id === id) setDetail(null); await refreshAll(); } catch (failure) { setError(apiErrorMessage(failure)); } };
  const vacuum = async () => { setVacuuming(true); setError(""); setNotice(""); try { await controlRequest("/admin/storage/vacuum", {}); await refreshAll(); setNotice("SQLite 已压缩，空闲页空间已回收。"); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setVacuuming(false); } };
  return <><PageHeading title="会话与诊断" description="按业务用户查看全部会话和真实模型调用。支持服务端搜索、分页、保留清理和 SQLite 压缩；决策发生在主模型请求之前，诊断中可看到候选、评分、筛选结果与额外耗时。" actions={<Space><Button icon={<Database size={15} />} onClick={() => { setCleanupOpen(true); setCleanupPreview(null); }}>清理旧会话</Button><ResourceActions refresh={refreshAll} /></Space>} />
    {error && <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />}
    {notice && <Alert title={notice} type="success" showIcon closable onClose={() => setNotice("")} style={{ marginBottom: 16 }} />}
    <section className="control-card" style={{ marginBottom: 20 }}><div className="control-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}><h2 style={{ margin: 0 }}><Database size={16} /> 存储与保留</h2><Space><Button size="small" onClick={() => void storage.refresh()}>刷新容量</Button><Popconfirm title="压缩 SQLite？" description="会回收已删除会话的空闲页；运行中的任务存在时服务端会拒绝执行。" onConfirm={() => void vacuum()}><Button size="small" icon={<Eraser size={14} />} loading={vacuuming}>压缩数据库</Button></Popconfirm></Space></div>{storage.loading ? <span className="control-muted">正在读取存储…</span> : storage.data && <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[{ key: "sessions", label: "会话", children: storage.data.sessions }, { key: "messages", label: "消息", children: storage.data.messages }, { key: "runs", label: "运行事件", children: storage.data.run_events }, { key: "db", label: "Agent DB", children: `${(storage.data.agent_db_bytes / 1024 / 1024).toFixed(2)} MB` }, { key: "wal", label: "WAL", children: `${(storage.data.agent_wal_bytes / 1024 / 1024).toFixed(2)} MB` }, { key: "calls", label: "模型调用", children: storage.data.llm_calls }, { key: "questions", label: "待回答", children: storage.data.questions }, { key: "oldest", label: "最早会话", children: storage.data.oldest_session ? new Date(storage.data.oldest_session).toLocaleDateString("zh-CN") : "无" }]} />}</section>
    <Input prefix={<Search size={15} />} placeholder="按用户、会话标题搜索" aria-label="搜索会话" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 380, marginBottom: 20 }} />
    <PageState {...resource}><Table rowKey="id" dataSource={resource.data?.items} pagination={{ current: page, pageSize, total: resource.data?.total || 0, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"], showTotal: (total, range) => `${range[0]}–${range[1]} / 共 ${total} 个会话（全部 ${resource.data?.all_total ?? total}）`, onChange: (next, size) => { if (size !== pageSize) { setPageSize(size); setPage(1); } else setPage(next); } }} scroll={{ x: 900 }} columns={[
      { title: "会话", dataIndex: "title", render: (title, row) => <Button type="link" loading={inspecting && detail?.session.id === row.id} onClick={() => void inspect(row.id)}>{title}</Button> },
      { title: "业务用户", dataIndex: "username" }, { title: "助手", dataIndex: "assistant_name" },
      { title: "消息", dataIndex: "message_count" }, { title: "Token", dataIndex: "total_tokens" },
      { title: "状态", dataIndex: "last_status", render: (value) => <Tag>{value || "未运行"}</Tag> },
      { title: "更新时间", dataIndex: "updated_at", render: (value) => new Date(value).toLocaleString("zh-CN") },
      { title: "操作", render: (_, row) => <Popconfirm title="删除这个会话？" description="聊天记录、运行与 PI 上下文将一并删除；已发布页面保留但解除会话关联。" onConfirm={() => void removeSession(row.id)}><Button type="text" danger icon={<Trash2 size={14} />} aria-label={`删除会话 ${row.title}`} /></Popconfirm> },
    ]} /></PageState>
    <Drawer loading={inspecting} open={Boolean(detail)} onClose={() => { setDetail(null); setDiagnostic(null); }} width="min(100vw, 1080px)" title={detail?.session.title || "会话详情"} extra={detail && <a href={`/api/control/admin/sessions/${encodeURIComponent(detail.session.id)}/export`} target="_blank" rel="noreferrer"><Download size={15} /> 导出</a>}>
      {detail && <><Descriptions column={2} size="small" items={[{ key: "user", label: "业务用户", children: detail.session.username }, { key: "model", label: "最近模型", children: detail.session.last_model_name }, { key: "tokens", label: "总 Token", children: detail.session.total_tokens }, { key: "cost", label: "估算费用", children: `$${Number(detail.session.total_cost_usd).toFixed(6)}` }]} /><Tabs items={[
        { key: "messages", label: "聊天记录", children: detail.messages.length ? <div className="control-messages">{detail.messages.map((message: Row) => <article className="control-message" key={message.id}><header><strong>{message.role === "user" ? "用户" : "助手"}</strong><span>{new Date(message.created_at).toLocaleString("zh-CN")}</span></header><div className="control-message__body">{message.content || "（无文字内容）"}</div>{(message.reasoning || message.tool_runs.length > 0) && <Collapse ghost items={[...(message.reasoning ? [{ key: "reasoning", label: "模型思考", children: <pre className="control-json">{message.reasoning}</pre> }] : []), ...(message.tool_runs.length ? [{ key: "tools", label: `${message.tool_runs.length} 次工具调用`, children: <pre className="control-json">{JSON.stringify(message.tool_runs, null, 2)}</pre> }] : [])]} />}</article>)}</div> : <Alert type="info" showIcon title="没有可显示的消息，或管理员查看内容已关闭。" /> },
        { key: "calls", label: "模型耗时", children: calls(detail.llm_calls) },
        { key: "runs", label: "执行与决策", children: <><Table rowKey="id" dataSource={detail.runs} pagination={false} scroll={{ x: 620 }} columns={[{ title: "开始时间", dataIndex: "started_at", render: (value) => new Date(value).toLocaleString("zh-CN") }, { title: "状态", dataIndex: "status" }, { title: "诊断", render: (_, row) => <Button size="small" onClick={async () => { try { setDiagnostic(await controlRequest<Row>(`/admin/runs/${row.id}`)); } catch (failure) { setError(apiErrorMessage(failure)); } }}>查看决策与步骤</Button> }]} />{diagnostic && <section className="control-card" style={{ marginTop: 20 }}><h2>执行诊断</h2><Alert type="info" showIcon title={diagnostic.content_available ? "原始决策输入输出仅在短期内存中展示，进程重启后不可恢复。" : "仅展示诊断元数据；内容查看已关闭或该运行已不在短期内存中。"} /><Collapse items={diagnostic.events.map((event: Row) => ({ key: event.id, label: event.name, children: <pre className="control-json">{JSON.stringify(event.payload, null, 2)}</pre> }))} /><div style={{ marginTop: 16 }}>{calls(diagnostic.calls)}</div></section>}</> },
        { key: "compactions", label: "上下文压缩", children: <pre className="control-json">{JSON.stringify(detail.compactions, null, 2)}</pre> },
      ]} /></>}
    </Drawer>
      <Modal open={cleanupOpen} title="清理旧会话" onCancel={() => { setCleanupOpen(false); setCleanupPreview(null); }} footer={<><Button onClick={() => { setCleanupOpen(false); setCleanupPreview(null); }}>取消</Button><Button loading={cleaning} onClick={() => void previewCleanup()}>预览范围</Button><Popconfirm title="确认执行清理？" description="删除预览列出的会话及其消息、运行事件与 PI 上下文，操作不可恢复。" okText="确认清理" cancelText="取消" onConfirm={() => void runCleanup()}><Button danger loading={cleaning} disabled={!cleanupPreview || cleanupPreview.count === 0}>执行清理</Button></Popconfirm></>}>
      <p className="control-muted">仅删除最后更新时间早于指定天数、且当前没有运行任务的会话。发布记录保留；原始消息、PI canonical entries、运行事件、审批和问答会一并删除。操作不可恢复。</p>
      <label className="control-muted">保留最近 <InputNumber min={1} max={3650} value={cleanupDays} onChange={(value) => setCleanupDays(Number(value) || 30)} style={{ margin: "0 8px", width: 110 }} /> 天</label>
      {cleanupPreview && <Alert style={{ marginTop: 16 }} type={cleanupPreview.count ? "warning" : "success"} showIcon title={cleanupPreview.count ? `将删除 ${cleanupPreview.count} 个会话、约 ${cleanupPreview.messages} 条消息` : "没有符合条件的会话"} description={cleanupPreview.count ? `截止时间 ${new Date(cleanupPreview.cutoff).toLocaleString("zh-CN")}` : undefined} />}
    </Modal>
  </>;
}
