import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ArtifactData, ChatMessage } from "../../types";
import { ApprovalCard } from "../ApprovalCard/ApprovalCard";
import { QuestionCard } from "../QuestionCard/QuestionCard";
import { HtmlArtifactCard, type ArtifactAction } from "../HtmlArtifactCard/HtmlArtifactCard";
import { Markdown } from "../Markdown/Markdown";
import { ProcessLine } from "../ProcessLine/ProcessLine";
import { HtmlStreamCard } from "../HtmlStreamCard/HtmlStreamCard";
import { MessageActions } from "../MessageActions/MessageActions";
import { Icon } from "../ui/Icon";
import "./MessageList.css";

export interface MessageListProps {
  messages: ChatMessage[];
  onApprove?: (messageId: string, approvalId: string) => void;
  onReject?: (messageId: string, approvalId: string) => void;
  onAnswerQuestion?: (messageId: string, questionId: string, values: string[], freeText: string) => void;
  onCancelQuestion?: (messageId: string, questionId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onArtifactAction?: (action: ArtifactAction, artifact: ArtifactData) => void | Promise<void>;
  emptyState?: ReactNode;
  className?: string;
}

function AssistantAvatar() {
  return (
    <div className="message__avatar message__avatar--assistant" aria-hidden="true">
      <span>WA</span>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="message__avatar message__avatar--user" aria-hidden="true">
      <Icon name="user" size={15} />
    </div>
  );
}

export function MessageList({
  messages,
  onApprove,
  onReject,
  onAnswerQuestion,
  onCancelQuestion,
  onForkMessage,
  onEditMessage,
  onDeleteMessage,
  onArtifactAction,
  emptyState,
  className = "",
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 「跟随底部」只在用户真的向上滚动时解除，避免流式输出期间被误判为离开底部。
  const pinnedRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const userScrollRef = useRef(false);
  const userScrollTimer = useRef<number | null>(null);
  const emptyRef = useRef(messages.length === 0);
  const [showJump, setShowJump] = useState(false);
  emptyRef.current = messages.length === 0;

  const distanceToBottom = (element: HTMLDivElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight;

  const follow = useCallback((force = false) => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const element = scrollRef.current;
      if (!element) return;
      // 空态（快捷入口）不需要贴底，否则内容比视口高时会把标题滚出屏幕。
      if (emptyRef.current) { element.scrollTop = 0; return; }
      if (!force && !pinnedRef.current) return;
      element.scrollTop = element.scrollHeight;
      setShowJump(false);
    });
  }, []);

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    setShowJump(false);
  };

  const markUserScroll = () => {
    userScrollRef.current = true;
    if (userScrollTimer.current !== null) window.clearTimeout(userScrollTimer.current);
    userScrollTimer.current = window.setTimeout(() => {
      userScrollRef.current = false;
      userScrollTimer.current = null;
    }, 220);
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = distanceToBottom(element);
    // 程序触发的滚动不改变跟随状态，只有用户手势才可能解除跟随。
    if (userScrollRef.current) pinnedRef.current = distance < 36;
    if (pinnedRef.current) {
      if (distance < 36) setShowJump(false);
    } else if (distance > 160) setShowJump(true);
  };

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!messages.length) pinnedRef.current = true;
    // 用户发消息时总是回到最新回复
    if (last?.role === "user") pinnedRef.current = true;
    follow();
  }, [messages, follow]);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollRef.current;
    if (!content || !container) return;
    const resize = new ResizeObserver(() => follow());
    resize.observe(content);
    resize.observe(container);
    // 流式文本经常只改文本节点（高度不变也会增长），MutationObserver 兜住这种情况。
    const mutations = new MutationObserver(() => follow());
    mutations.observe(content, { childList: true, subtree: true, characterData: true });
    const viewport = () => follow();
    window.visualViewport?.addEventListener("resize", viewport);
    window.addEventListener("resize", viewport);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      window.visualViewport?.removeEventListener("resize", viewport);
      window.removeEventListener("resize", viewport);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (userScrollTimer.current !== null) window.clearTimeout(userScrollTimer.current);
    };
  }, [follow]);

  return (
    <div className={`message-list ${className}`.trim()}>
      <div
        className="message-list__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        onPointerDown={markUserScroll}
        onKeyDown={markUserScroll}
        role="log"
        aria-live="polite"
        aria-label="对话消息"
      >
        <div className="message-list__inner" ref={contentRef}>
          {messages.length === 0 && emptyState}
          {messages.map((message) =>
            message.role === "user" ? (
              <article className="message message--user" key={message.renderKey || message.id}>
                <div className="message__user-body">
                  <div className="message__meta message__meta--user">
                    <span>你</span>
                    {message.time && <em>{message.time}</em>}
                  </div>
                  <div className="message__bubble">
                    {Boolean(message.attachments?.length) && (
                      <div className="message__attachments">
                        {message.attachments!.map((attachment, index) => (
                          <a href={attachment.url} target="_blank" rel="noopener noreferrer" title={attachment.name} key={`${attachment.url}-${index}`}>
                            <img src={attachment.url} alt={attachment.name} loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                    {message.parts.map((part, index) =>
                      part.kind === "markdown" ? (
                        <Markdown content={part.content} key={index} />
                      ) : null
                    )}
                  </div>
                  {!message.streaming && !message.pendingRun && <MessageActions onFork={onForkMessage ? () => onForkMessage(message.id) : undefined} onEdit={onEditMessage ? () => onEditMessage(message.id) : undefined} onDelete={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined} />}
                </div>
                <UserAvatar />
              </article>
            ) : (
              <article className="message message--assistant" key={message.renderKey || message.id}>
                <AssistantAvatar />
                <div className="message__assistant-body">
                  <div className="message__meta">
                    <span>{message.name}</span>
                    <i className="message__role-tag">智能体</i>
                    {message.time && <em>{message.time}</em>}
                  </div>
                  <div className="message__stack">
                    {message.parts.map((part, index) => {
                      const last = index === message.parts.length - 1;
                      if (part.kind === "process") {
                        return (
                          <ProcessLine
                            data={part.process}
                            defaultOpen={false}
                            onOpenChange={(open) => {
                              if (!open) return;
                              pinnedRef.current = false;
                              setShowJump(true);
                            }}
                            persistKey={`webagent:${message.renderKey || message.id}:process:${index}`}
                            key={index}
                          />
                        );
                      }
                      if (part.kind === "artifact") {
                        return (
                          <HtmlArtifactCard
                            artifact={part.artifact}
                            onAction={onArtifactAction}
                            key={index}
                          />
                        );
                      }
                      if (part.kind === "html-stream") {
                        return <HtmlStreamCard title={part.title} characters={part.characters} html={part.html} key={index} />;
                      }
                      if (part.kind === "approval") {
                        return (
                          <ApprovalCard
                            approval={part.approval}
                            onApprove={() =>
                              onApprove?.(message.id, part.approval.id)
                            }
                            onReject={() =>
                              onReject?.(message.id, part.approval.id)
                            }
                            key={index}
                          />
                        );
                      }
                      if (part.kind === "question") {
                        return (
                          <QuestionCard
                            question={part.question}
                            onSubmit={(values, freeText) => onAnswerQuestion?.(message.id, part.question.id, values, freeText)}
                            onCancel={() => onCancelQuestion?.(message.id, part.question.id)}
                            key={index}
                          />
                        );
                      }
                        return (
                          <div className="message__markdown" key={index}>
                          <Markdown content={part.content} streaming={message.streaming} />
                          {message.streaming && last && (
                            <span className="stream-cursor" aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                    {!message.streaming && !message.pendingRun && <MessageActions
                      usage={message.usage}
                      onFork={onForkMessage ? () => onForkMessage(message.id) : undefined}
                      onDelete={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined}
                    />}
                  </div>
                </div>
              </article>
            )
          )}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          className="message-list__jump"
          onClick={scrollToBottom}
        >
          <Icon name="arrow-down" size={14} />
          回到底部
        </button>
      )}
    </div>
  );
}
