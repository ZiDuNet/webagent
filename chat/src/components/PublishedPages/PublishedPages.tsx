import { useEffect, useState } from "react";
import {
  apiErrorMessage,
  pagePilotClient,
  type PagePilotClient,
  type Publication,
  type PublicationDetail,
  type PublicationStatus,
  type PublicationVersion,
  type PublishPageResult,
} from "../../api/pagepilot";
import { usePublishedPages } from "../../hooks/usePublishedPages";
import { copyText, downloadText, formatBytes } from "../../lib/file";
import { isolateHtmlPreview } from "../../lib/html";
import { CodeBox } from "../CodeBox/CodeBox";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PublishPageDialog, safeExternalUrl } from "./PublishPageDialog";
import "./PublishedPages.css";

export interface PublishedPagesProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: PagePilotClient;
  currentSessionId?: string;
  sessions?: { id: string; title: string }[];
  currentHtml?: string;
  onOpenSession?: (sessionId: string) => void;
  onPublished?: (result: PublishPageResult) => void;
}

const STATUS_LABEL: Record<PublicationStatus, string> = {
  published: "已发布",
  partial: "部分完成",
  failed: "发布失败",
  publishing: "发布中",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function StatusBadge({ status }: { status: PublicationStatus }) {
  return <span className={`publication-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function PublishedPages(props: PublishedPagesProps) {
  if (!props.open) return null;
  return <PublishedPagesPanel {...props} />;
}

function PublishedPagesPanel({
  open,
  onOpenChange,
  client = pagePilotClient,
  currentSessionId,
  sessions = [],
  currentHtml,
  onOpenSession,
  onPublished,
}: PublishedPagesProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PublicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [view, setView] = useState<"preview" | "code" | "history">("preview");
  const [version, setVersion] = useState<(PublicationVersion & { html: string }) | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionRevision, setVersionRevision] = useState(0);
  const [updateSource, setUpdateSource] = useState<"current" | "saved" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const pages = usePublishedPages({ client, enabled: open, query: debouncedQuery, sessionId });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setDetail((previous) => previous?.id === selectedId ? previous : null);
    setVersion(null);
    setVersionId(null);
    setView("preview");
    setDetailError(null);
    setFeedback(null);
    setDetailLoading(false);
    if (selectedId === null) return;
    const controller = new AbortController();
    setDetailLoading(true);
    client.get(selectedId, controller.signal)
      .then((result) => !controller.signal.aborted && setDetail(result))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setDetailError(apiErrorMessage(failure));
      })
      .finally(() => !controller.signal.aborted && setDetailLoading(false));
    return () => controller.abort();
  }, [client, selectedId, detailRevision]);

  useEffect(() => {
    setVersion(null);
    setVersionError(null);
    setVersionLoading(false);
    if (selectedId === null || versionId === null) return;
    const controller = new AbortController();
    setVersionLoading(true);
    client.getVersion(selectedId, versionId, controller.signal)
      .then((result) => !controller.signal.aborted && setVersion(result))
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setVersionError(apiErrorMessage(failure));
      })
      .finally(() => !controller.signal.aborted && setVersionLoading(false));
    return () => controller.abort();
  }, [client, selectedId, versionId, versionRevision]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const copyUrl = async (page: Publication) => {
    const url = safeExternalUrl(page.url);
    if (!url) return;
    setFeedback(await copyText(url) ? "链接已复制。" : "复制失败，请从页面详情中手动复制链接。");
  };

  const finishPublish = (result: PublishPageResult) => {
    pages.refresh();
    setUpdated(true);
    onPublished?.(result);
  };

  const shownHtml = versionId !== null ? version?.html : detail?.html;
  const sessionTitle = (id: string) => sessions.find((session) => session.id === id)?.title || `会话 ${id.slice(0, 8)}`;
  const contentBusy = detailLoading || versionLoading;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="我的已发布页面"
      description="只显示当前账号在本业务系统发布的内容。记录来自本地，不会读取共享 Token 下的其他用户页面。"
      className={`published-pages ${selectedId === null ? "" : "has-detail"}`}
    >
      {selectedId === null ? (
        <>
          <div className="published-pages__filters">
            <label className="published-search">
              <Icon name="search" size={16} />
              <input aria-label="搜索已发布页面" placeholder="搜索标题、说明或地址" value={query} onChange={(event) => setQuery(event.target.value)} />
              {query && <button type="button" className="wa-icon-button" onClick={() => setQuery("")} aria-label="清空搜索"><Icon name="x" size={14} /></button>}
            </label>
            <select aria-label="筛选来源会话" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              <option value="">全部会话</option>
              {currentSessionId && !sessions.some((session) => session.id === currentSessionId) && <option value={currentSessionId}>当前会话</option>}
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}{session.id === currentSessionId ? "（当前）" : ""}</option>)}
            </select>
            <button type="button" className="wa-icon-button" aria-label="刷新发布记录" title="刷新" disabled={pages.loading} onClick={pages.refresh}><Icon name={pages.loading ? "loader" : "refresh"} className={pages.loading ? "wa-spinner" : ""} size={17} /></button>
          </div>
          <div className="published-pages__list" aria-busy={pages.loading}>
            {pages.loading ? <PublicationLoading label="正在读取发布记录…" /> : (
              <>
                {pages.error && <div className="publication-error"><p className="wa-error" role="alert">{pages.error}</p><button type="button" className="wa-button" onClick={pages.refresh}>重试</button></div>}
                {!pages.error && pages.items.length === 0 && <div className="publication-empty"><Icon name="globe" size={30} /><strong>{debouncedQuery || sessionId ? "没有符合条件的页面" : "还没有发布页面"}</strong><p>{debouncedQuery || sessionId ? "试试其他关键词，或查看全部会话。" : "生成 HTML 后点击「发布」。内容、地址和版本会保存在这里。"}</p></div>}
                {pages.items.map((page) => (
                  <article className="publication-row" key={page.id}>
                    <button type="button" className="publication-row__main" onClick={() => setSelectedId(page.id)}>
                      <span className="publication-row__icon"><Icon name="file-code" size={19} /></span>
                      <span className="publication-row__text">
                        <strong>{page.title || "未命名页面"}</strong>
                        <span>{page.description || page.url || "发布地址尚未返回"}</span>
                        <small>{formatDate(page.updated_at)} · v{page.version} · {formatBytes(page.size)}{page.session_id ? ` · ${sessionTitle(page.session_id)}` : " · 手动发布"}</small>
                        <span className="publication-row__badges"><StatusBadge status={page.status} /><em>{page.password_set ? "有密码" : "无密码"}</em><em>{page.visibility === "public" ? "创作广场" : "链接可见"}</em></span>
                      </span>
                      <Icon name="chevron-right" size={16} />
                    </button>
                    <div className="publication-row__actions">
                      <button type="button" className="wa-button" onClick={() => void copyUrl(page)} disabled={!safeExternalUrl(page.url)}><Icon name="copy" size={13} />复制链接</button>
                      {safeExternalUrl(page.url) && <a className="wa-button" href={page.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} />打开</a>}
                    </div>
                  </article>
                ))}
                {pages.items.length < pages.total && <button type="button" className="wa-button published-pages__more" disabled={pages.loadingMore} onClick={() => void pages.loadMore()}>{pages.loadingMore ? "加载中…" : "加载更多"}</button>}
              </>
            )}
          </div>
          <footer className="published-pages__footer"><span>共 {pages.total} 个页面</span><span role="status">{feedback || "内容按账号隔离，来源会话仅用于筛选"}</span></footer>
        </>
      ) : (
        <>
          <div className="publication-detail__top">
            <button type="button" className="wa-button" onClick={() => setSelectedId(null)}><Icon name="chevron-right" className="publication-back" size={13} />返回列表</button>
            {detail && <><StatusBadge status={detail.status} /><span className="publication-detail__version">v{detail.version} · {formatDate(detail.updated_at)}</span></>}
          </div>
          <div className="publication-detail__scroll">
            {detailLoading ? <PublicationLoading label="正在读取页面详情…" /> : detailError ? <div className="publication-error"><p className="wa-error" role="alert">{detailError}</p><button type="button" className="wa-button" onClick={() => setDetailRevision((value) => value + 1)}>重试</button></div> : detail && (
              <>
                <div className="publication-detail__summary">
                  <h3>{detail.title || "未命名页面"}</h3>
                  {detail.description && <p>{detail.description}</p>}
                  <div className="publication-detail__metadata">
                    <span><Icon name="shield" size={13} />{detail.password_set ? "访问需要密码" : "无密码，持有链接即可访问"}</span>
                    <span><Icon name="globe" size={13} />{detail.visibility === "public" ? "展示在创作广场" : "不展示在创作广场"}</span>
                    {detail.session_id && <button type="button" disabled={!onOpenSession} onClick={() => { onOpenSession?.(detail.session_id!); onOpenChange(false); }}><Icon name="git-branch" size={13} />{sessionTitle(detail.session_id)}</button>}
                  </div>
                  {detail.last_error && <p className="wa-error" role="alert">{detail.last_error}</p>}
                  {safeExternalUrl(detail.url) && <div className="publication-detail__url"><a href={detail.url} target="_blank" rel="noopener noreferrer">{detail.url}</a><button type="button" className="wa-icon-button" aria-label="复制页面链接" onClick={() => void copyUrl(detail)}><Icon name="copy" size={15} /></button></div>}
                </div>
                <div className="publication-tabs" aria-label="页面内容显示方式">
                  {([ ["preview", "eye", "本地预览"], ["code", "code", "HTML 代码"], ["history", "clock", `版本历史 (${detail.versions.length})`] ] as const).map(([key, icon, label]) => (
                    <button type="button" className={view === key ? "is-active" : ""} aria-pressed={view === key} key={key} onClick={() => setView(key)}><Icon name={icon} size={14} />{label}</button>
                  ))}
                </div>
                {view === "history" ? (
                  <div className="publication-history">
                    {detail.versions.length === 0 && <p className="publication-history__empty">暂时没有版本记录。</p>}
                    {[...detail.versions].sort((first, second) => second.version - first.version).map((item) => (
                      <article key={item.id}>
                        <span className="publication-history__number">v{item.version}</span>
                        <div><strong>{item.title}</strong><small>{formatDate(item.created_at)} · {formatBytes(item.size)} · {item.password_set ? "有密码" : "无密码"}</small><StatusBadge status={item.status} /></div>
                        <button type="button" className="wa-button" onClick={() => { setVersionId(item.id); setView("preview"); }}>查看版本</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="publication-content">
                    {versionId !== null && <div className="publication-version-notice"><span>{version ? `正在查看历史版本 v${version.version}` : "正在读取历史版本"}</span><button type="button" onClick={() => { setVersionId(null); setVersion(null); }}>返回当前版本</button></div>}
                    {versionError ? <div className="publication-error"><p className="wa-error" role="alert">{versionError}</p><button type="button" className="wa-button" onClick={() => setVersionRevision((value) => value + 1)}>重试读取版本</button></div> : contentBusy ? <PublicationLoading label="正在读取版本内容…" /> : view === "code" ? <CodeBox code={shownHtml || ""} language="html" fileName={`page-${detail.code || detail.id}.html`} maxHeight="42dvh" /> : <iframe className="publication-preview" title={`${detail.title} 本地预览`} srcDoc={isolateHtmlPreview(shownHtml || "")} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
                    <p className="publication-preview-note">本地隔离预览：脚本和图表可运行，但不能读取业务页面登录态。联网数据请求与表单提交已禁用。</p>
                  </div>
                )}
              </>
            )}
          </div>
          {detail && <footer className="publication-detail__footer">
            <span className="publication-feedback" role="status">{feedback}</span>
            <div>
              <button type="button" className="wa-button" disabled={contentBusy || shownHtml === undefined} onClick={() => downloadText(`page-${detail.code || detail.id}${version ? `-v${version.version}` : ""}.html`, shownHtml || "", "text/html;charset=utf-8")}><Icon name="download" size={14} />下载 HTML</button>
              <button type="button" className="wa-button" disabled={!detail.code || detail.status === "publishing"} onClick={() => setUpdateSource("saved")}><Icon name="refresh" size={14} />重新发布当前存档</button>
              {currentHtml && <button type="button" className="wa-button wa-button--primary" disabled={!detail.code || detail.status === "publishing"} onClick={() => setUpdateSource("current")}><Icon name="upload" size={14} />用当前 HTML 更新</button>}
            </div>
          </footer>}
        </>
      )}
      {detail && updateSource && <PublishPageDialog open onOpenChange={(next) => { if (next) return; setUpdateSource(null); if (updated) { setUpdated(false); setDetailRevision((value) => value + 1); } }} html={updateSource === "current" ? currentHtml || "" : detail.html} title={detail.title} description={detail.description} sessionId={updateSource === "current" ? currentSessionId : detail.session_id ?? undefined} publication={detail} client={client} onPublished={finishPublish} />}
    </Dialog>
  );
}

function PublicationLoading({ label }: { label: string }) {
  return <div className="publication-loading" role="status"><Icon name="loader" className="wa-spinner" size={22} /><span>{label}</span></div>;
}

export { isolateHtmlPreview } from "../../lib/html";
