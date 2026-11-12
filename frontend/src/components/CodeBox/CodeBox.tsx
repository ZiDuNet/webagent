import { useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { copyText, downloadText } from "../../lib/file";
import { normalizeCodeLanguage, tokenizeLine } from "../../lib/highlight";
import "./CodeBox.css";

export interface CodeBoxProps {
  code: string;
  language?: string;
  fileName?: string;
  /** 初始是否显示行号，默认显示 */
  lineNumbers?: boolean;
  /** 初始是否自动换行 */
  wrap?: boolean;
  /** 代码区最大高度，默认 45vh */
  maxHeight?: string;
  className?: string;
  /** 隐藏工具栏（Markdown 内部使用紧凑模式时可关闭） */
  compact?: boolean;
}

const LANGUAGE_LABEL: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  sql: "SQL",
  bash: "Bash",
  shell: "Shell",
  text: "Text",
  markdown: "Markdown",
  yaml: "YAML",
  toml: "TOML",
  go: "Go",
  rust: "Rust",
  java: "Java",
  csharp: "C#",
  cpp: "C++",
};

const EXTENSION: Record<string, string> = {
  python: "py",
  javascript: "js",
  typescript: "ts",
  html: "html",
  css: "css",
  json: "json",
  sql: "sql",
  bash: "sh",
  markdown: "md",
  yaml: "yml",
  go: "go",
  rust: "rs",
  java: "java",
  csharp: "cs",
  cpp: "cpp",
};

export function CodeBox({
  code,
  language = "text",
  fileName,
  lineNumbers = true,
  wrap = false,
  maxHeight = "45vh",
  className = "",
  compact = false,
}: CodeBoxProps) {
  const [showLineNumbers, setShowLineNumbers] = useState(lineNumbers);
  const [wrapEnabled, setWrapEnabled] = useState(wrap);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<number | null>(null);

  const normalizedLanguage = normalizeCodeLanguage(language);
  const lines = useMemo(() => code.split("\n"), [code]);
  const label =
    LANGUAGE_LABEL[normalizedLanguage] ??
    (normalizedLanguage === "text" ? "代码" : normalizedLanguage);
  const extension = EXTENSION[normalizedLanguage] ?? "txt";
  const downloadName = fileName ?? `snippet.${extension}`;

  const handleCopy = async () => {
    const ok = await copyText(code);
    setCopyState(ok ? "copied" : "failed");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const classes = [
    "codebox",
    compact ? "codebox--compact" : "",
    wrapEnabled ? "is-wrap" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {!compact && (
        <div className="codebox__toolbar">
          <div className="codebox__identity">
            <span className="codebox__lang">{label}</span>
            {fileName && <span className="codebox__filename">{fileName}</span>}
          </div>
          <div className="codebox__actions">
            <button
              type="button"
              className={`codebox__icon-btn ${showLineNumbers ? "is-active" : ""}`}
              onClick={() => setShowLineNumbers((value) => !value)}
              title={showLineNumbers ? "隐藏行号" : "显示行号"}
              aria-label={showLineNumbers ? "隐藏行号" : "显示行号"}
              aria-pressed={showLineNumbers}
            >
              <Icon name="hash" size={15} />
            </button>
            <button
              type="button"
              className={`codebox__icon-btn ${wrapEnabled ? "is-active" : ""}`}
              onClick={() => setWrapEnabled((value) => !value)}
              title={wrapEnabled ? "关闭自动换行" : "开启自动换行"}
              aria-label={wrapEnabled ? "关闭自动换行" : "开启自动换行"}
              aria-pressed={wrapEnabled}
            >
              <Icon name="wrap" size={15} />
            </button>
            <button
              type="button"
              className={`codebox__icon-btn ${
                copyState === "copied" ? "is-success" : ""
              }`}
              onClick={handleCopy}
              title={copyState === "copied" ? "已复制" : "复制代码"}
              aria-label="复制代码"
            >
              <Icon name={copyState === "copied" ? "check" : "copy"} size={15} />
            </button>
            <button
              type="button"
              className="codebox__icon-btn"
              onClick={() =>
                downloadText(downloadName, code, "text/plain;charset=utf-8")
              }
              title="下载代码"
              aria-label="下载代码"
            >
              <Icon name="download" size={15} />
            </button>
          </div>
        </div>
      )}

      <div className="codebox__scroll" style={{ maxHeight }}>
        <pre className="codebox__pre" aria-label={`${label} 代码`}>
          <code>
            {lines.map((line, lineIndex) => (
              <span className="codebox__line" key={`${lineIndex}-${line}`}>
                {showLineNumbers && (
                  <span className="codebox__line-no" aria-hidden="true">
                    {lineIndex + 1}
                  </span>
                )}
                <span className="codebox__line-code">
                  {line
                    ? tokenizeLine(line, normalizedLanguage).map((token, tokenIndex) => (
                        <span
                          className={`tok tok--${token.type}`}
                          key={`${lineIndex}-${tokenIndex}`}
                        >
                          {token.text}
                        </span>
                      ))
                    : " "}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>

      {copyState !== "idle" && (
        <span className={`codebox__copy-note is-${copyState}`} role="status">
          {copyState === "copied" ? "已复制到剪贴板" : "复制失败，请手动选择"}
        </span>
      )}
    </div>
  );
}
