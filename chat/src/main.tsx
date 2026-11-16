import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";

const App = lazy(() => import("./App"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<p role="status">正在加载 AI 对话…</p>}>
      <App />
    </Suspense>
  </StrictMode>
);
