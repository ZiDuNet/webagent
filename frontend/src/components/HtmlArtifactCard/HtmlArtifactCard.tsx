import { useState } from "react";
import type { ArtifactData } from "../../types";
import { CodeBox } from "../CodeBox/CodeBox";
import { Icon } from "../ui/Icon";
import { Dialog } from "../ui/Dialog";
import { isolateHtmlPreview } from "../../lib/html";
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
  const [showCode, setShowCode] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ArtifactAction | null>(null);
  const fileName = artifact.fileName ?? "artifact.html";

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
        <div className="artifact__file-icon">
          <Icon name="file-code" size={17} />
        </div>
        <div className="artifact__heading">
          <div className="artifact__title-line">
            <h3>{artifact.title}</h3>
            <span className="artifact__badge">HTML</span>
          </div>
          {artifact.description && (
            <p className="artifact__description">{artifact.description}</p>
          )}
        </div>
        <span className="artifact__time">{artifact.createdAt ?? "刚刚生成"}</span>
      </header>

      <div className="artifact__preview">
        <div className="artifact__chrome">
          <span />
          <span />
          <span />
          <em>{fileName}</em>
        </div>
        <div className="artifact__frame">
          <iframe
            title={`${artifact.title} 预览`}
            srcDoc={isolateHtmlPreview(artifact.html)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="lazy"
            tabIndex={-1}
          />
        </div>
      </div>

      {showCode && (
        <div className="artifact__code">
          <CodeBox
            code={artifact.html}
            language="html"
            fileName={fileName}
            maxHeight="36vh"
          />
        </div>
      )}

      <footer className="artifact__footer">
        <div className="artifact__actions">
          <button
            type="button"
            className="artifact__button"
            onClick={() => setPreviewOpen(true)}
          >
            <Icon name="eye" size={14} />
            预览
          </button>
          <button
            type="button"
            className={`artifact__button ${showCode ? "is-active" : ""}`}
            onClick={() => setShowCode((value) => !value)}
            aria-pressed={showCode}
          >
            <Icon name="code" size={14} />
            查看代码
          </button>
          <button
            type="button"
            className="artifact__button"
            onClick={() => void handleAction("save-image")}
            disabled={!onAction || Boolean(busy)}
          >
            <Icon name="image" size={14} />
            {busy === "save-image" ? "正在截图…" : "保存图片"}
          </button>
        </div>
        <button
          type="button"
          className="artifact__button artifact__button--primary"
          onClick={() => void handleAction("publish")}
          disabled={!onAction || Boolean(busy)}
        >
          <Icon name="upload" size={14} />
          发布
        </button>
      </footer>

      {note && (
        <div className="artifact__note" role="status">
          {note}
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen} title={artifact.title} description="本地隔离预览，脚本和图表可运行，但不能读取业务页面登录态。" className="artifact-preview-dialog">
              <div className="artifact-modal__body">
                <iframe
                  title={`${artifact.title} 全屏预览`}
                  srcDoc={isolateHtmlPreview(artifact.html)}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              </div>
              <footer className="wa-dialog__footer">
                <button type="button" className="wa-button" disabled={!onAction || Boolean(busy)} onClick={() => void handleAction("published")}><Icon name="globe" size={14} />已发布</button>
                <button
                  type="button"
                  className="artifact__button artifact__button--primary"
                  onClick={() => void handleAction("publish")}
                  disabled={!onAction || Boolean(busy)}
                >
                  <Icon name="upload" size={14} />
                  发布产物
                </button>
              </footer>
      </Dialog>
    </article>
  );
}
