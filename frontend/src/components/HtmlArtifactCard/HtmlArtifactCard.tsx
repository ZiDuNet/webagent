import { useMemo, useState } from "react";
import type { ArtifactData } from "../../types";
import { CodeBox } from "../CodeBox/CodeBox";
import { Icon } from "../ui/Icon";
import { Dialog } from "../ui/Dialog";
import { isolateHtmlPreview } from "../../lib/html";
import { downloadText, formatBytes } from "../../lib/file";
import "./HtmlArtifactCard.css";

export type ArtifactAction = "save-image" | "publish" | "published";

export interface HtmlArtifactCardProps {
  artifact: ArtifactData;
  onAction?: (action: ArtifactAction, artifact: ArtifactData) => void | Promise<void>;
  className?: string;
}

export function HtmlArtifactCard({
  artifact,
  onAction,
  className = "",
}: HtmlArtifactCardProps) {
  const [view, setView] = useState<"preview" | "code" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ArtifactAction | null>(null);
  const fileName = artifact.fileName ?? "artifact.html";
  const size = useMemo(() => formatBytes(new TextEncoder().encode(artifact.html).length), [artifact.html]);
  const preview = useMemo(() => view === "preview" ? isolateHtmlPreview(artifact.html) : "", [view, artifact.html]);

  const handleAction = async (action: ArtifactAction) => {
    if (!onAction || busy) return;
    setNote("");
    setBusy(action);
    try {
      await onAction(action, artifact);
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : "操作失败，请重试。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`artifact ${className}`.trim()}>
      <header className="artifact__header">
        <div className="artifact__file-icon" aria-hidden="true">
          HTML
        </div>
        <div className="artifact__heading">
          <div className="artifact__title-line">
            <h3>{artifact.title}</h3>
          </div>
          <p className="artifact__description">可交互网页 · {size} · 隔离沙箱预览</p>
        </div>
        <div className="artifact__actions">
          <button
            type="button"
            className="artifact__button artifact__button--preview"
            onClick={() => setView("preview")}
          >
            打开预览
            <Icon name="chevron-right" size={13} />
          </button>
          <button
            type="button"
            className="artifact__button artifact__button--code"
            onClick={() => setView("code")}
          >
            查看代码
          </button>
        </div>
      </header>

      {note && (
        <div className="artifact__note" role="status">
          {note}
        </div>
      )}

      <Dialog open={view !== null} onOpenChange={(open) => !open && setView(null)} title={artifact.title} description="本地隔离预览，脚本和图表可运行，但不能读取业务页面登录态。" className="artifact-preview-dialog">
        <div className="artifact__view-tabs" role="group" aria-label="HTML 查看方式">
          <button type="button" className={`artifact__button ${view === "preview" ? "is-active" : ""}`} aria-pressed={view === "preview"} onClick={() => setView("preview")}><Icon name="eye" size={14} />预览</button>
          <button type="button" className={`artifact__button ${view === "code" ? "is-active" : ""}`} aria-pressed={view === "code"} onClick={() => setView("code")}><Icon name="code" size={14} />代码</button>
          <span>{fileName} · {size}</span>
        </div>
        <div className={`artifact-modal__body ${view === "code" ? "artifact-modal__body--code" : ""}`}>
          {view === "preview" ? (
            <iframe title={`${artifact.title} 全屏预览`} srcDoc={preview} sandbox="allow-scripts" referrerPolicy="no-referrer" />
          ) : view === "code" ? (
            <CodeBox code={artifact.html} language="html" fileName={fileName} maxHeight="100%" />
          ) : null}
        </div>
        {note && <p className="wa-error" role="status">{note}</p>}
        <footer className="wa-dialog__footer artifact__dialog-footer">
          <button type="button" className="wa-button" onClick={() => downloadText(fileName, artifact.html, "text/html;charset=utf-8")}><Icon name="download" size={14} />下载 HTML</button>
          <button type="button" className="wa-button" onClick={() => void handleAction("save-image")} disabled={!onAction || Boolean(busy)}><Icon name="image" size={14} />{busy === "save-image" ? "正在截图…" : "保存图片"}</button>
          <button type="button" className="wa-button" disabled={!onAction || Boolean(busy)} onClick={() => void handleAction("published")}><Icon name="globe" size={14} />已发布</button>
          <button type="button" className="wa-button wa-button--primary" onClick={() => void handleAction("publish")} disabled={!onAction || Boolean(busy)}><Icon name="upload" size={14} />发布产物</button>
        </footer>
      </Dialog>
    </article>
  );
}
