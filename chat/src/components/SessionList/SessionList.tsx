import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../ui/Icon";
import { Dialog } from "../ui/Dialog";
import "./SessionList.css";

export interface SessionListItem {
  id: string;
  title: string;
  meta?: string;
}

export interface SessionListProps {
  sessions: SessionListItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onFork?: (id: string) => void;
  className?: string;
}

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onFork,
  className = "",
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const startEdit = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };

  const commitEdit = () => {
    if (editingId) onRename?.(editingId, draft.trim() || "未命名会话");
    setEditingId(null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commitEdit();
    if (event.key === "Escape") setEditingId(null);
  };

  return (
    <div className={`session-list ${className}`.trim()}>
      {sessions.map((session) => {
        const active = session.id === activeId;
        return (
          <div
            className={`session-item ${active ? "is-active" : ""}`.trim()}
            key={session.id}
          >
            {editingId === session.id ? (
              <input
                className="session-item__input"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                aria-label="重命名会话"
              />
            ) : (
              <button
                type="button"
                className="session-item__main"
                onClick={() => onSelect?.(session.id)}
              >
                <span className="session-item__icon">
                  <Icon name="file-code" size={12} />
                </span>
                <span className="session-item__text">
                  <strong>{session.title}</strong>
                  {session.meta && <small>{session.meta}</small>}
                </span>
              </button>
            )}

            <div className="session-item__actions">
              {onFork && (
                <button
                  type="button"
                  className="session-item__action"
                  title="分叉"
                  aria-label="分叉会话"
                  onClick={() => onFork(session.id)}
                >
                  <Icon name="git-branch" size={11} />
                </button>
              )}
              {onRename && (
                <button
                  type="button"
                  className="session-item__action"
                  title="重命名"
                  aria-label="重命名会话"
                  onClick={() => startEdit(session.id, session.title)}
                >
                  <Icon name="edit" size={11} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  className="session-item__action is-danger"
                  title="删除"
                  aria-label="删除会话"
                  onClick={() => setDeleteId(session.id)}
                >
                  <Icon name="trash" size={11} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      <Dialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)} title="删除会话" description="会话和聊天记录将被删除，无法恢复。已发布页面仍然保留。">
        <footer className="wa-dialog__footer">
          <button type="button" className="wa-button" onClick={() => setDeleteId(null)}>取消</button>
          <button type="button" className="wa-button wa-button--primary" onClick={() => { if (deleteId) onDelete?.(deleteId); setDeleteId(null); }}>确认删除</button>
        </footer>
      </Dialog>
    </div>
  );
}
