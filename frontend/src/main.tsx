import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

const App = lazy(() => import("./App"));
const ModelsPage = lazy(() => import("./ModelsPage"));
const modelsPage = new URLSearchParams(window.location.search).get("view") === "models";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">{modelsPage ? "正在加载模型配置…" : "正在加载 AI 对话…"}</p>}>
      {modelsPage ? <ModelsPage /> : <App />}
    </Suspense>
  </StrictMode>
);
