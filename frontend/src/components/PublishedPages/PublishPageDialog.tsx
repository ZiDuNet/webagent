import { useRef, useState, type FormEvent } from "react";
import {
  apiErrorMessage,
  pagePilotClient,
  type PagePilotClient,
  type PageVisibility,
  type Publication,
  type PublishPageResult,
} from "../../api/pagepilot";
import { formatBytes } from "../../lib/file";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import "./PublishedPages.css";

export interface PublishPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  html: string;
  title?: string;
  description?: string;
  sessionId?: string;
  publication?: Publication;
  client?: PagePilotClient;
  onPublished?: (result: PublishPageResult) => void;
}

export function PublishPageDialog(props: PublishPageDialogProps) {
  if (!props.open) return null;
  return <PublishPageForm {...props} />;
}

function PublishPageForm({
  open,
  onOpenChange,
  html,
  title = "",
  description = "",
  sessionId,
  publication,
  client = pagePilotClient,
  onPublished,
}: PublishPageDialogProps) {
  const [pageTitle, setPageTitle] = useState(title);
  const [pageDescription, setPageDescription] = useState(description);
  const [password, setPassword] = useState("");
  const [visibility, setVisibility] = useState<PageVisibility | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishPageResult | null>(null);
  const submittingRef = useRef(false);
  const size = new TextEncoder().encode(html).length;
  const isUpdate = Boolean(publication);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!pageTitle.trim() || !visibility || !html.trim()) {
      setError("请填写页面标题、选择可见范围，并确认 HTML 内容不为空。");
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await client.publish({
        html,
        title: pageTitle.trim(),
        description: pageDescription.trim(),
        access_password: password,
        visibility,
        session_id: sessionId,
        publication_id: publication?.id,
        code: publication?.code ?? "",
      });
      if (!response.ok && response.status !== "partial") {
        throw new Error(response.warning || "发布未完成，请检查服务配置后重试。");
      }
      setResult(response);
      setPassword("");
      onPublished?.(response);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={result ? (result.status === "partial" ? "发布仍需处理" : isUpdate ? "页面已更新" : "页面已发布") : isUpdate ? "更新已发布页面" : "发布到 PagePilot"}
      description={isUpdate ? "覆盖此页面内容并保留版本记录，页面地址保持不变。" : "发布内容和地址保存在当前业务账号下，之后可从「已发布」查看。"}
      className="publish-dialog"
      busy={busy}
    >
      {result ? (
        <>
          <div className="wa-dialog__body publish-result">
            <Icon name={result.status === "partial" ? "alert" : "check-circle"} size={32} />
            <p>{result.status === "partial" ? result.warning || "内容已上传，但部分发布设置未成功。请在发布记录中检查状态后重试。" : "内容和返回地址已保存到你的发布记录。"}</p>
            {safeExternalUrl(result.url) && (
              <a className="wa-button" href={result.url} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={14} />打开页面
              </a>
            )}
          </div>
          <footer className="wa-dialog__footer">
            <button type="button" className="wa-button wa-button--primary" onClick={() => onOpenChange(false)}>完成</button>
          </footer>
        </>
      ) : (
        <form onSubmit={submit} className="publish-form">
          <div className="wa-dialog__body publish-form__fields">
            <div className="publish-source">
              <Icon name="file-code" size={18} />
              <span>{isUpdate ? `现有页面 · v${publication?.version}` : "当前 HTML 内容"}</span>
              <small>{formatBytes(size)}</small>
            </div>
            <label className="wa-field">
              <span>页面标题 <span className="publish-required">必填</span></span>
              <input value={pageTitle} onChange={(event) => setPageTitle(event.target.value)} maxLength={120} required autoFocus disabled={busy} placeholder="例如：今日设备巡检报告" />
              <small>管理员配置了标题后缀时，发布时会自动拼接。</small>
            </label>
            <label className="wa-field">
              <span>说明 <small>可选</small></span>
              <textarea value={pageDescription} onChange={(event) => setPageDescription(event.target.value)} maxLength={240} rows={3} disabled={busy} placeholder="介绍页面内容，也可以留空" />
            </label>
            <label className="wa-field">
              <span>可见范围 <span className="publish-required">每次选择</span></span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as PageVisibility | "")} required disabled={busy}>
                <option value="" disabled>请选择本次发布的可见范围</option>
                <option value="unlisted">仅通过链接访问，不展示在创作广场</option>
                <option value="public">展示在创作广场</option>
              </select>
            </label>
            <label className="wa-field">
              <span>访问密码 <small>可选</small></span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" maxLength={200} disabled={busy} placeholder="留空允许任何持有链接的人访问" />
              <small>{isUpdate ? "更新时留空会清除原有访问密码；需要保留保护时，请重新填写密码。" : "不会自动生成密码。留空即公开访问，知道链接的人无需密码即可查看。"}</small>
            </label>
            <p className="publish-disclosure"><Icon name="shield" size={15} />{password ? "本次使用你填写的密码保护页面。" : "本次未设置密码，页面可通过链接公开访问。"}</p>
            {error && <p className="wa-error" role="alert">{error}</p>}
          </div>
          <footer className="wa-dialog__footer">
            <button type="button" className="wa-button" onClick={() => onOpenChange(false)} disabled={busy}>取消</button>
            <button type="submit" className="wa-button wa-button--primary" disabled={busy || !html.trim()}>
              <Icon name={busy ? "loader" : "upload"} className={busy ? "wa-spinner" : ""} size={15} />
              {busy ? "正在发布…" : isUpdate ? "确认更新" : "确认发布"}
            </button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}

export function safeExternalUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
