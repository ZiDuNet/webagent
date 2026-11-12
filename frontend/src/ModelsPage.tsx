import { useEffect, useState } from "react";
import { ModelsSettings } from "./components/ModelsSettings/ModelsSettings";
import { agentRequest, type AgentUser } from "./api/agent";
import "./styles/theme.css";
import "./styles/models-page.css";

export default function ModelsPage() {
  const [user, setUser] = useState<AgentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const parameters = new URLSearchParams(window.location.search);
  const embedded = parameters.get("embed") === "1";
  const requested = parameters.get("category");
  const category = requested === "voice" || requested === "image" || requested === "decision" ? requested : "chat";

  useEffect(() => {
    const controller = new AbortController();
    agentRequest<{ user: AgentUser }>("/api/me", { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setUser(result.user); })
      .catch(() => { if (!controller.signal.aborted) setError("请先使用管理员账号登录业务系统。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const changed = () => {
    if (embedded && window.parent !== window) window.parent.postMessage({ type: "webagent.models.updated" }, window.location.origin);
  };

  return (
    <div className={`models-page ${embedded ? "models-page--embedded" : ""}`}>
      {!embedded && <nav className="models-page__nav" aria-label="页面导航"><a href="/react/">返回 AI 对话</a><a href="/admin/">业务后台</a></nav>}
      {loading ? <p className="models-page__message" role="status">正在检查管理员权限…</p> : !user?.is_admin ? <div className="models-page__message" role="alert"><h1>需要管理员权限</h1><p>{error || "当前账号无法维护供应商、模型或密钥。"}</p><a href="/admin/" target={embedded ? "_top" : "_self"}>前往业务后台</a></div> : <ModelsSettings initialCategory={category} onChanged={changed} />}
    </div>
  );
}
