import { useEffect, useId, useState } from "react";
import "./Mermaid.css";

let initialized = false;
let mermaidModule: typeof import("mermaid") | null = null;

async function loadMermaid() {
  if (!mermaidModule) {
    mermaidModule = await import("mermaid");
  }
  if (!initialized) {
    mermaidModule.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
      fontFamily: "inherit",
      themeVariables: {
        darkMode: true,
        background: "#0c1117",
        primaryColor: "#151c24",
        primaryTextColor: "#b6c2d1",
        primaryBorderColor: "#2b3543",
        lineColor: "#3a4557",
        secondaryColor: "#121820",
        tertiaryColor: "#10151b",
        fontSize: "13px",
      },
    });
    initialized = true;
  }
  return mermaidModule.default;
}

/*
 * 说明：mermaid 体积较大，采用运行时动态 import，仅当消息中出现 Mermaid
 * 围栏时才加载，避免拖慢首屏与普通流式回复。
 */

export interface MermaidProps {
  code: string;
  className?: string;
  streaming?: boolean;
}

interface RenderState {
  status: "pending" | "ready" | "error";
  svg?: string;
  message?: string;
}

export function Mermaid({ code, className = "", streaming = false }: MermaidProps) {
  const id = useId().replace(/:/g, "");
  const renderId = `mermaid-${id}`;
  const [state, setState] = useState<RenderState>({ status: "pending" });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ status: "pending", svg: previous.svg }));

    const timer = window.setTimeout(() => {
      loadMermaid()
        .then(async (mermaid) => {
          if (cancelled) return null;
          if (streaming && !(await mermaid.parse(code, { suppressErrors: true }))) return null;
          return mermaid.render(renderId, code);
        })
        .then((result) => {
          if (!cancelled && result) setState({ status: "ready", svg: result.svg });
        })
        .catch((error: unknown) => {
          if (cancelled || streaming) return;
          setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        });
    }, streaming ? 160 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, renderId, streaming]);

  return (
    <div className={`mermaid-block ${className}`.trim()}>
      <div className="mermaid-block__head">
        <span className="mermaid-block__lang">Mermaid</span>
      </div>
      <div className="mermaid-block__body">
        {state.svg ? (
          <div
            className="mermaid-block__canvas"
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : state.status === "error" ? (
          <div className="mermaid-block__error">
            <strong>图表解析失败</strong>
            <pre>{state.message}</pre>
          </div>
        ) : (
          <div className="mermaid-block__loading">
            <span className="mermaid-block__spinner" aria-hidden="true" />
            正在渲染图表…
          </div>
        )}
      </div>
    </div>
  );
}
