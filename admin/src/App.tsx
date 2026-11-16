import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Form, Input, Layout, Menu, Space, Spin, Tag } from "antd";
import { AudioLines, BookOpen, Boxes, BrainCircuit, ChevronRight, Cpu, ExternalLink, KeyRound, LogOut, Menu as MenuIcon, MessageSquare, Settings2, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { apiErrorMessage, clearControlToken, controlRequest } from "./api/pagepilot";
import { ConnectionDialog } from "./components/ConnectionDialog";

const ModelsSettings = lazy(() => import("./components/ModelsSettings/ModelsSettings").then((module) => ({ default: module.ModelsSettings })));
const AssistantsPage = lazy(() => import("./pages/AssistantsPage"));
const ToolsPage = lazy(() => import("./pages/ToolsPage"));
const SkillsPage = lazy(() => import("./pages/SkillsPage"));
const AccessTokensPage = lazy(() => import("./pages/AccessTokensPage"));
const RuntimePage = lazy(() => import("./pages/RuntimePage"));
const SessionsPage = lazy(() => import("./pages/SessionsPage"));
const OperationsPage = lazy(() => import("./pages/OperationsPage"));
const CorePage = lazy(() => import("./pages/CorePage"));
const menu: { key: string; label: string; icon: ReactNode; description: string }[] = [
  { key: "models", label: "模型接入", icon: <BrainCircuit size={17} />, description: "供应商与各类模型" },
  { key: "assistants", label: "助手管理", icon: <Sparkles size={17} />, description: "提示词、默认助手与能力范围" },
  { key: "tools", label: "工具与连接器", icon: <Workflow size={17} />, description: "原生工具、HTTP 与 MCP" },
  { key: "skills", label: "Skills", icon: <BookOpen size={17} />, description: "渐进式知识加载" },
  { key: "runtime", label: "运行设置", icon: <Settings2 size={17} />, description: "上下文、记忆与运行治理" },
  { key: "sessions", label: "会话与诊断", icon: <MessageSquare size={17} />, description: "用户会话、模型与决策链路" },
  { key: "operations", label: "发布与审计", icon: <Boxes size={17} />, description: "PagePilot、审计与用量" },
  { key: "access", label: "接入与安全", icon: <KeyRound size={17} />, description: "接入 Token、匿名访客与前端边界" },
  { key: "core", label: "PI 核心", icon: <Cpu size={17} />, description: "版本与受控升级" },
];
export default function App() {
  const chatUrl = import.meta.env.VITE_CHAT_URL || "/chat/";
  const [user, setUser] = useState<{ username: string; via_token?: boolean } | null>(null);
  const [checking, setChecking] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const initial = new URLSearchParams(location.search).get("page") || "models";
  const [page, setPage] = useState(menu.some((item) => item.key === initial) ? initial : "models"); const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    controlRequest<{ user: { username: string } }>("/auth/me")
      .then((result) => { if (!controller.signal.aborted) setUser(result.user); })
      .catch(() => { /* 401 等未登录状态保持登录页；网络错误在登录时再次暴露 */ })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  const select = (key: string) => { setPage(key); setOpen(false); const url = new URL(location.href); url.search = `?page=${key}`; history.pushState({}, "", url); };
  useEffect(() => { const changed = () => { const requested = new URLSearchParams(location.search).get("page") || "models"; setPage(menu.some((item) => item.key === requested) ? requested : "models"); }; window.addEventListener("popstate", changed); return () => window.removeEventListener("popstate", changed); }, []);
  if (checking) return <main className="control-login"><Spin size="large" tip="检查管理端登录态…" /></main>;
  if (!user) return <main className="control-login"><section className="control-login__card"><span className="control-login__mark">WebAgent / PI</span><h1>管理控制台</h1><p>使用独立的框架管理员账号登录。<br />与业务系统、Chat 端的身份和权限完全分离。</p><Form layout="vertical" requiredMark={false} onFinish={async (values) => { setBusy(true); setError(""); clearControlToken(); try { const result = await controlRequest<{ user: { username: string; via_token?: boolean } }>("/auth/login", values); setUser(result.user); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setBusy(false); } }}><Form.Item name="username" label="管理账号" rules={[{ required: true }]}><Input prefix={<ShieldCheck size={15} />} autoComplete="username" autoFocus /></Form.Item><Form.Item name="password" label="管理密码" rules={[{ required: true }]}><Input.Password prefix={<KeyRound size={15} />} autoComplete="current-password" /></Form.Item>{error && <Alert type="error" showIcon title={error} style={{ marginBottom: 18 }} />}<Button type="primary" block size="large" htmlType="submit" loading={busy}>登录管理端</Button><Button block type="text" onClick={() => setConnectionOpen(true)} style={{ marginTop: 10 }}>使用管理 Token 连接</Button></Form><p style={{ marginBottom: 0 }}><a href={chatUrl}>前往 Chat 端 <ExternalLink size={12} /></a></p></section><ConnectionDialog open={connectionOpen} onClose={() => setConnectionOpen(false)} /></main>;
  const selected = menu.find((item) => item.key === page)!;
  return <Layout className="control-layout">{open && <button className="control-overlay" aria-label="关闭菜单" onClick={() => setOpen(false)} />}<Layout.Sider width={224} className={`control-sidebar ${open ? "is-open" : ""}`} theme="dark" style={{ background: "#0e1218" }}><div className="control-logo"><div className="control-logo__mark">W</div><div><strong>WebAgent</strong><small>CONTROL PLANE / PI</small></div></div><Menu mode="inline" selectedKeys={[page]} items={menu.map(({ key, label, icon }) => ({ key, label, icon }))} onClick={({ key }) => select(key)} /><div className="control-sidebar__footer"><span><ShieldCheck size={12} /> {user.username}</span><Button size="small" type="text" aria-label="退出管理端" icon={<LogOut size={15} />} onClick={async () => { await controlRequest("/auth/logout", {}); clearControlToken(); setUser(null); }} /></div></Layout.Sider><Layout className="control-main"><header className="control-topbar"><div className="control-topbar__title"><Button className="control-mobile-menu" type="text" icon={<MenuIcon size={19} />} aria-label="打开导航菜单" onClick={() => setOpen(true)} /><span className="control-muted">管理控制台</span><ChevronRight size={13} className="control-muted" /><strong>{selected.label}</strong></div><Space>{user.via_token && <Tag color="gold" bordered={false}>Token 接入</Tag>}<Tag color="green" bordered={false}>PI Runtime</Tag><a href={chatUrl} target="_blank" rel="noreferrer" aria-label="打开 Chat 端"><ExternalLink size={16} /></a></Space></header><Suspense fallback={<div className="control-content"><Spin /> 正在加载模块…</div>}>{page === "models" ? <ModelsSettings /> : <div className="control-content">{page === "assistants" ? <AssistantsPage /> : page === "tools" ? <ToolsPage /> : page === "skills" ? <SkillsPage /> : page === "runtime" ? <RuntimePage /> : page === "sessions" ? <SessionsPage /> : page === "operations" ? <OperationsPage /> : page === "access" ? <AccessTokensPage /> : <CorePage />}</div>}</Suspense></Layout></Layout>;
}
