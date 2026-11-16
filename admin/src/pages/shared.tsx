import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Form, Input, Modal, Space, Spin } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { apiErrorMessage, controlRequest } from "../api/pagepilot";

export type Row = Record<string, any>;
export function useResource<Result>(path: string) {
  const [data, setData] = useState<Result>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const versionRef = useRef(0);
  const [version, setVersion] = useState(0);
  useEffect(() => { setVersion((current) => current + 1); }, [path]);
  useEffect(() => { versionRef.current = version; }, [version]);
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const request = ++versionRef.current;
    setVersion(request);
    if (options?.silent !== true) setReloading(true);
    if (!hasLoaded) setLoading(true);
    setError("");
    try {
      const result = await controlRequest<Result>(path);
      if (versionRef.current !== request) return;
      setData(result);
      setHasLoaded(true);
    } catch (failure) {
      if (versionRef.current !== request) return;
      setError(apiErrorMessage(failure));
    } finally {
      if (versionRef.current === request) { setLoading(false); setReloading(false); }
    }
  }, [path, hasLoaded]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, loading, reloading, refresh, setError };
}
export function PageHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) { return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="control-actions">{actions}</div>}</div>; }
export function PageState({ error, loading, children }: { error: string; loading: boolean; children: ReactNode }) {
  return <>{error && <Alert title={error} type="error" showIcon style={{ marginBottom: 20 }} />}{loading ? <div style={{ display: "grid", gap: 16, opacity: .55, pointerEvents: "none" }}><Spin /><div style={{ minHeight: 120 }} /></div> : children}</>;
}
export function ResourceActions({ refresh, add, label = "新增" }: { refresh: () => unknown; add?: () => void; label?: string }) { return <Space><Button icon={<RefreshCw size={14} />} onClick={() => void refresh()} aria-label="刷新数据">刷新</Button>{add && <Button type="primary" icon={<Plus size={15} />} onClick={add}>{label}</Button>}</Space>; }
export function JsonEditor({ title, description, value, onClose, onSave }: { title: string; description?: string; value: Row; onClose: () => void; onSave: (value: Row) => Promise<unknown> }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  return <Modal open title={title} width={820} onCancel={onClose} okText="保存配置" cancelText="取消" confirmLoading={saving} onOk={async () => { setError(""); try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("配置需要 JSON 对象"); setSaving(true); await onSave(parsed); onClose(); } catch (failure) { setError(apiErrorMessage(failure)); } finally { setSaving(false); } }}>{description && <p className="control-muted">{description}</p>}{error && <Alert title={error} type="error" showIcon style={{ marginBottom: 16 }} />}<Form layout="vertical"><Form.Item label="JSON 配置"><Input.TextArea value={text} onChange={(event) => setText(event.target.value)} rows={18} spellCheck={false} style={{ fontFamily: "ui-monospace,monospace", fontSize: 12 }} /></Form.Item></Form></Modal>;
}
