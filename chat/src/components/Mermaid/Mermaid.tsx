import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
      fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
      htmlLabels: false,
      flowchart: { htmlLabels: false, nodeSpacing: 32, rankSpacing: 40, diagramPadding: 12, useMaxWidth: true },
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
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const sequence = useRef(0);
  const canvas = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>({ status: "pending" });

  useLayoutEffect(() => {
    const svg = canvas.current?.querySelector("svg");
    if (!svg) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = svg.getBBox();
      if (!bounds.width || !bounds.height) return;
      const padding = 12;
      svg.setAttribute("viewBox", `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`);
      svg.style.maxWidth = `${bounds.width + padding * 2}px`;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.svg]);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${id}-${++sequence.current}`;
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
  }, [code, id, streaming]);

  return (
    <div className={`mermaid-block ${className}`.trim()}>
      <div className="mermaid-block__head">
        <span className="mermaid-block__lang">Mermaid</span>
      </div>
      <div className="mermaid-block__body">
        {state.svg ? (
          <div
            className="mermaid-block__canvas"
            ref={canvas}
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
