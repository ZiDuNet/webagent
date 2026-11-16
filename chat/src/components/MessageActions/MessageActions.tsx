import { useState } from "react";
import type { UsageData } from "../../types";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import "./MessageActions.css";

export interface MessageActionsProps {
  usage?: UsageData;
  onFork?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  className?: string;
}

function formatTokens(value?: number): string {
  if (value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatCost(value?: number): string {
  if (value === undefined) return "—";
  if (value < 0.01 && value > 0) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatLatency(value?: number): string {
  if (value === undefined) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function MessageActions({
  usage,
  onFork,
  onEdit,
  onDelete,
  className = "",
}: MessageActionsProps) {
  const hasUsage = usage !== undefined;
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className={`message-actions ${className}`.trim()}>
      {hasUsage && (
        <div className="message-actions__usage" title="本次回答用量">
          <span className="message-usage">
            入 <b>{formatTokens(usage?.input_tokens ?? usage?.prompt_tokens)}</b>
          </span>
          <span className="message-usage">
            出 <b>{formatTokens(usage?.output_tokens ?? usage?.completion_tokens)}</b>
          </span>
          <span className="message-usage">
            费 <b>{formatCost(usage?.cost ?? usage?.cost_usd)}</b>
          </span>
          <span className="message-usage">
            时 <b>{formatLatency(usage?.latency_ms)}</b>
          </span>
        </div>
      )}
      <div className="message-actions__buttons">
        {onFork && (
          <button
            type="button"
            className="message-action"
            title="从此处分叉"
            aria-label="分叉"
            onClick={onFork}
          >
            <Icon name="git-branch" size={13} />
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className="message-action"
            title="编辑消息"
            aria-label="编辑消息"
            onClick={onEdit}
          >
            <Icon name="edit" size={13} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="message-action is-danger"
            title="删除消息"
            aria-label="删除消息"
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title="删除消息" description="此操作无法恢复。删除不会撤销已经执行的业务操作，待执行的旧审批将取消。">
        <footer className="wa-dialog__footer">
          <button type="button" className="wa-button" onClick={() => setConfirmDelete(false)}>取消</button>
          <button type="button" className="wa-button wa-button--primary" onClick={() => { setConfirmDelete(false); onDelete?.(); }}>确认删除</button>
        </footer>
      </Dialog>
    </div>
  );
}
