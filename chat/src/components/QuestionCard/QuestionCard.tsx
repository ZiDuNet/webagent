import { useMemo, useState } from "react";
import type { QuestionData } from "../../types";
import { Icon } from "../ui/Icon";
import "./QuestionCard.css";

export interface QuestionCardProps {
  question: QuestionData;
  onSubmit?: (values: string[], freeText: string) => void;
  onCancel?: () => void;
  busy?: boolean;
}

export function QuestionCard({ question, onSubmit, onCancel, busy = false }: QuestionCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const pending = question.status === "pending";
  const answeredLabels = useMemo(() => {
    const values = question.values || [];
    return values.map((value) => question.options.find((option) => option.value === value)?.label || value);
  }, [question.options, question.values]);

  const toggle = (value: string) => {
    if (!pending) return;
    setError("");
    setSelected((current) => {
      if (question.selection === "single") return current.includes(value) ? [] : [value];
      return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    });
  };

  const submit = () => {
    if (!pending || busy) return;
    if (question.required && !selected.length && !freeText.trim()) {
      setError("请选择一个选项，或填写补充内容。");
      return;
    }
    setError("");
    onSubmit?.(selected, freeText);
  };

  return (
    <section className={`question-card question-card--${question.status}`} aria-label="助手需要你补充信息">
      <header className="question-card__header">
        <span className="question-card__icon"><Icon name={pending ? "bot" : question.status === "answered" ? "check-circle" : "clock"} size={17} /></span>
        <div className="question-card__heading">
          <span className="question-card__eyebrow">{pending ? "需要你确认一个信息" : question.status === "answered" ? "已补充信息" : "问题已结束"}</span>
          <h3>{question.question}</h3>
        </div>
        <span className="question-card__status">{pending ? "待回答" : question.status === "answered" ? "已回答" : question.status === "cancelled" ? "已取消" : "已过期"}</span>
      </header>
      {question.description && <p className="question-card__description">{question.description}</p>}
      {pending ? (
        <>
          <div className="question-card__options" role={question.selection === "single" ? "radiogroup" : "group"} aria-label="可选答案">
            {question.options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button type="button" key={option.value} className={`question-card__option ${checked ? "is-selected" : ""}`} disabled={busy} aria-pressed={checked} onClick={() => toggle(option.value)}>
                  <span className={`question-card__check ${question.selection === "single" ? "is-radio" : ""} ${checked ? "is-checked" : ""}`}>{checked && <Icon name="check" size={10} />}</span>
                  <span className="question-card__option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                </button>
              );
            })}
          </div>
          {question.allow_free_text && <label className="question-card__free"><span>补充说明 <em>可选</em></span><input value={freeText} disabled={busy} maxLength={4000} placeholder="如果以上选项不完整，可以在这里补充…" onChange={(event) => { setFreeText(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} /></label>}
          {error && <p className="question-card__error" role="alert">{error}</p>}
          <footer className="question-card__footer">
            <span>回答后会继续当前任务，不会重新执行已完成的工具。</span>
            <div className="question-card__actions">
              <button type="button" className="question-card__button question-card__button--ghost" disabled={busy} onClick={onCancel}>跳过</button>
              <button type="button" className="question-card__button question-card__button--primary" disabled={busy} onClick={submit}><Icon name="check" size={14} />提交回答</button>
            </div>
          </footer>
        </>
      ) : (
        <>
          <button type="button" className="question-card__resolved" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            <span>
              {answeredLabels.length > 0 && <>选择 <strong>{answeredLabels.join("、")}</strong></>}
              {question.free_text && <> · 补充 <strong>{question.free_text}</strong></>}
              {!answeredLabels.length && !question.free_text && (question.status === "cancelled" ? "你跳过了这次提问。" : "这次提问已过期。")}
            </span>
            <Icon name="chevron-down" size={12} />
          </button>
          {expanded && <div className="question-card__resolved-detail">
            {answeredLabels.length > 0 && <div><span>选择</span><strong>{answeredLabels.join("、")}</strong></div>}
            {question.free_text && <div><span>补充</span><strong>{question.free_text}</strong></div>}
          </div>}
        </>
      )}
    </section>
  );
}
