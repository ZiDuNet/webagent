import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ArtifactData, ChatMessage } from "../../types";
import { ApprovalCard } from "../ApprovalCard/ApprovalCard";
import { HtmlArtifactCard, type ArtifactAction } from "../HtmlArtifactCard/HtmlArtifactCard";
import { Markdown } from "../Markdown/Markdown";
import { ProcessLine } from "../ProcessLine/ProcessLine";
import { MessageActions } from "../MessageActions/MessageActions";
import { Icon } from "../ui/Icon";
import "./MessageList.css";

export interface MessageListProps {
  messages: ChatMessage[];
  onApprove?: (messageId: string, approvalId: string) => void;
  onReject?: (messageId: string, approvalId: string) => void;
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
  onForkMessage,
  onEditMessage,
  onDeleteMessage,
  onArtifactAction,
  emptyState,
  className = "",
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    pinnedRef.current = true;
    setShowJump(false);
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const pinned = distance < 90;
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  };

  useEffect(() => {
    if (!pinnedRef.current) return;
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const container = scrollRef.current;
      if (container && pinnedRef.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`message-list ${className}`.trim()}>
      <div
        className="message-list__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
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
                    {message.parts.map((part, index) =>
                      part.kind === "markdown" ? (
                        <Markdown content={part.content} key={index} />
                      ) : null
                    )}
                  </div>
                  {!message.streaming && <MessageActions onFork={onForkMessage ? () => onForkMessage(message.id) : undefined} onEdit={onEditMessage ? () => onEditMessage(message.id) : undefined} onDelete={onDeleteMessage ? () => onDeleteMessage(message.id) : undefined} />}
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
                              if (open) {
                                pinnedRef.current = false;
                                setShowJump(true);
                              }
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
                        return (
                          <div className="message__markdown" key={index}>
                          <Markdown content={part.content} streaming={message.streaming} />
                          {message.streaming && last && (
                            <span className="stream-cursor" aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                    {!message.streaming && <MessageActions
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
          onClick={() => scrollToBottom("smooth")}
        >
          <Icon name="arrow-down" size={14} />
          回到底部
        </button>
      )}
    </div>
  );
}
