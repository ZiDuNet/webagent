import type { ApprovalData } from "../../types";
import { isStructuredValue, stringifyValue } from "../../lib/file";
import { CodeBox } from "../CodeBox/CodeBox";
import { Icon } from "../ui/Icon";
import "./ApprovalCard.css";

export interface ApprovalCardProps {
  approval: ApprovalData;
  onApprove?: () => void;
  onReject?: () => void;
  className?: string;
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  className = "",
}: ApprovalCardProps) {
  const pending = approval.status === "pending";
  const argumentsText = stringifyValue(approval.arguments);

  return (
    <section
      className={`approval approval--${approval.status} ${className}`.trim()}
      aria-label="工具审批"
    >
      <header className="approval__header">
        <div className="approval__icon">
          <Icon name="shield" size={18} />
        </div>
        <div className="approval__heading">
          <div className="approval__eyebrow">
            <span>需要你确认</span>
            <i>{approval.risk ?? "中风险"}</i>
          </div>
          <h3>{approval.title}</h3>
        </div>
        <span className="approval__status">
          {pending ? "待审批" : approval.status === "approved" ? "已批准" : "已拒绝"}
        </span>
      </header>

      {approval.description && (
        <p className="approval__description">{approval.description}</p>
      )}

      <div className="approval__meta-row">
        <span className="approval__tool">
          <Icon name="wrench" size={12} />
          {approval.tool}
        </span>
        {approval.expiresAt && (
          <span className="approval__expiry">
            <Icon name="clock" size={12} />
            {approval.expiresAt}
          </span>
        )}
      </div>

      {argumentsText && (
        <div className="approval__arguments">
          <div className="approval__arguments-label">调用参数</div>
          <CodeBox
            code={argumentsText}
            language={isStructuredValue(approval.arguments) ? "json" : "text"}
            lineNumbers={false}
            maxHeight="18vh"
            compact
          />
        </div>
      )}

      {pending ? (
        <footer className="approval__footer">
          <p>批准后继续执行，本次操作会写入审计日志。</p>
          <div className="approval__actions">
            <button
              type="button"
              className="approval__button approval__button--ghost"
              onClick={onReject}
            >
              拒绝
            </button>
            <button
              type="button"
              className="approval__button approval__button--primary"
              onClick={onApprove}
            >
              <Icon name="check" size={14} />
              批准并继续
            </button>
          </div>
        </footer>
      ) : (
        <footer className="approval__resolved">
          <Icon
            name={approval.status === "approved" ? "check-circle" : "x"}
            size={14}
          />
          {approval.status === "approved"
            ? "已批准，工具将继续执行"
            : "已拒绝，本次工具调用已取消"}
        </footer>
      )}
    </section>
  );
}
