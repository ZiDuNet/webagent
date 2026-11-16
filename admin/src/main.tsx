import { StrictMode } from "react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[admin] 界面异常", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="control-login"><section className="control-login__card"><h1>管理端界面异常</h1><p>页面发生未处理的渲染错误，数据与服务未受影响。</p><pre className="control-json" style={{ maxHeight: 220, overflow: "auto" }}>{this.state.error.message}</pre><button type="button" className="ant-btn ant-btn-primary" onClick={() => location.reload()}>重新加载管理端</button></section></main>;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary><ConfigProvider locale={zhCN} theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#27c96a", colorBgBase: "#0b0d10", colorBgContainer: "#151920", colorBgElevated: "#191e27", colorBorder: "#303846", colorText: "#e8ecf3", colorTextSecondary: "#9aa4b5", borderRadius: 10, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif', controlHeight: 38 } }}><AntApp><App /></AntApp></ConfigProvider></ErrorBoundary></StrictMode>);
