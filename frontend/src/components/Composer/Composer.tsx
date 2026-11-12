import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ModelOption, ToolOption } from "../../types";
import { Icon } from "../ui/Icon";
import "./Composer.css";

export type AccessMode = "confirm" | "full_access";

export interface ComposerContextInfo {
  usedTokens: number;
  totalTokens: number;
  label?: string;
}

export interface ComposerProps {
  models: ModelOption[];
  selectedModelId: string;
  onModelChange: (id: string) => void;
  tools: ToolOption[];
  selectedToolIds: string[];
  onToolsChange: (ids: string[]) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;

  accessMode?: AccessMode;
  onAccessModeChange?: (mode: AccessMode) => void;
  allowFullAccess?: boolean;

  reasoningOptions?: string[];
  selectedReasoning?: string;
  onReasoningChange?: (value: string) => void;
  showReasoning?: boolean;

  voiceEnabled?: boolean;
  voiceDisabledReason?: string;
  voiceBusy?: boolean;
  recording?: boolean;
  onVoiceToggle?: () => void;
  onAttach?: (files: FileList | null) => void;

  contextInfo?: ComposerContextInfo | null;
  note?: string;
}

const ACCESS_MODE_LABEL: Record<AccessMode, string> = {
  confirm: "变更前确认",
  full_access: "完全访问",
};

function formatTokens(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function Composer({
  models,
  selectedModelId,
  onModelChange,
  tools,
  selectedToolIds,
  onToolsChange,
  onSend,
  onStop,
  streaming = false,
  disabled = false,
  placeholder = "输入消息，Enter 发送，Shift + Enter 换行，可粘贴图片",
  className = "",
  accessMode = "confirm",
  onAccessModeChange,
  allowFullAccess = false,
  reasoningOptions,
  selectedReasoning = "",
  onReasoningChange,
  showReasoning = false,
  voiceEnabled = false,
  voiceDisabledReason = "管理员尚未配置语音识别模型",
  voiceBusy = false,
  recording = false,
  onVoiceToggle,
  onAttach,
  contextInfo,
  note = "工具调用继承当前账号权限",
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [menu, setMenu] = useState<"tools" | "access" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousModelIdRef = useRef(selectedModelId);

  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? models[0];
  const availableReasoning = selectedModel?.reasoningEfforts ?? reasoningOptions ?? [];
  const canChooseReasoning = showReasoning && selectedModel?.supportsReasoning !== false && availableReasoning.length > 0;
  const effectiveReasoning = availableReasoning.includes(selectedReasoning) ? selectedReasoning : "";
  const selectableTools = tools.filter((tool) => tool.selectable !== false);
  const fixedToolIds = tools.filter((tool) => tool.selectable === false && tool.defaultSelected !== false).map((tool) => tool.id);
  const effectiveToolIds = [...new Set([...selectedToolIds, ...fixedToolIds])];

  useEffect(() => {
    if (previousModelIdRef.current !== selectedModelId) {
      previousModelIdRef.current = selectedModelId;
      if (selectedReasoning) onReasoningChange?.("");
      return;
    }
    if (selectedReasoning && !availableReasoning.includes(selectedReasoning)) onReasoningChange?.("");
  }, [selectedModelId, selectedReasoning, availableReasoning, onReasoningChange]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
  }, [value]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const toggleTool = (id: string) => {
    if (selectedToolIds.includes(id)) {
      onToolsChange(selectedToolIds.filter((toolId) => toolId !== id));
    } else {
      onToolsChange([...selectedToolIds, id]);
    }
  };

  const contextPercent =
    contextInfo && contextInfo.totalTokens > 0
      ? Math.min(100, (contextInfo.usedTokens / contextInfo.totalTokens) * 100)
      : 0;

  return (
    <div className={`composer-wrap ${className}`.trim()} ref={rootRef}>
      {menu === "tools" && (
        <div
          className="composer-popover composer-popover--tools"
          role="listbox"
          aria-label="本轮可用工具"
        >
          <div className="composer-popover__head">
            <div>
              <strong>本轮可用工具</strong>
              <small>只列出你有权限且管理员已启用的工具</small>
            </div>
            <div className="composer-popover__actions">
              <button
                type="button"
                className="composer-text-btn"
                onClick={() => onToolsChange([...new Set([...selectableTools.map((tool) => tool.id), ...fixedToolIds])])}
              >
                全选
              </button>
              <button
                type="button"
                className="composer-text-btn"
                onClick={() => onToolsChange(fixedToolIds)}
              >
                清空
              </button>
            </div>
          </div>
          <div className="composer-popover__list">
            {tools.map((tool) => {
              const active = effectiveToolIds.includes(tool.id);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`composer-popover__option ${
                    active ? "is-active" : ""
                  }`}
                  key={tool.id}
                  disabled={tool.selectable === false}
                  onClick={() => toggleTool(tool.id)}
                >
                  <span
                    className={`composer-check ${active ? "is-checked" : ""}`}
                  >
                    {active && <Icon name="check" size={10} />}
                  </span>
                  <span className="composer-popover__option-main">
                    <strong>{tool.name}{tool.selectable === false ? " · 固定启用" : ""}</strong>
                    {tool.description && <small>{tool.description}</small>}
                  </span>
                </button>
              );
            })}
            {tools.length === 0 && (
              <div className="composer-popover__empty">当前没有可用工具</div>
            )}
          </div>
        </div>
      )}

      {menu === "access" && (
        <div
          className="composer-popover composer-popover--access"
          role="listbox"
          aria-label="执行方式"
        >
          <button
            type="button"
            className={`composer-access-option ${
              accessMode === "confirm" ? "is-active" : ""
            }`}
            onClick={() => {
              onAccessModeChange?.("confirm");
              setMenu(null);
            }}
          >
            <span className="composer-access-option__icon">
              <Icon name="shield" size={15} />
            </span>
            <span className="composer-access-option__main">
              <strong>变更前确认</strong>
              <small>改动类工具先列清单，等你点「执行」</small>
            </span>
            {accessMode === "confirm" && <Icon name="check" size={14} />}
          </button>
          <button
            type="button"
            className={`composer-access-option ${
              accessMode === "full_access" ? "is-active" : ""
            }`}
            disabled={!allowFullAccess}
            onClick={() => {
              onAccessModeChange?.("full_access");
              setMenu(null);
            }}
          >
            <span className="composer-access-option__icon is-warn">!</span>
            <span className="composer-access-option__main">
              <strong>完全访问</strong>
              <small>改动类工具直接执行，不扩大你的工具权限</small>
            </span>
            {accessMode === "full_access" && <Icon name="check" size={14} />}
          </button>
          {!allowFullAccess && (
            <p className="composer-popover__note">
              管理员未开启完全访问，当前保持不变前确认。
            </p>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => { onAttach?.(event.target.files); event.target.value = ""; }}
      />

      <div className="composer">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          maxLength={20000}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="消息输入框"
        />

        <div className="composer__bar">
          <div className="composer__left">
            <button
              type="button"
              className="pill-btn"
              title="添加图片"
              aria-label="添加图片"
              disabled={!onAttach || disabled || streaming}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="paperclip" size={16} />
            </button>

            <button
              type="button"
              className={`pill-btn ${recording ? "is-recording" : ""}`}
              title={voiceEnabled ? "录音结束后识别并直接发送" : voiceDisabledReason}
              aria-label="语音输入"
              disabled={!voiceEnabled || voiceBusy || disabled || streaming}
              onClick={onVoiceToggle}
            >
              <Icon name="mic" size={16} />
              <span>{recording ? "停止" : voiceBusy ? "识别中" : "语音"}</span>
            </button>

            <button
              type="button"
              className={`pill-btn ${menu === "tools" ? "is-open" : ""}`}
              onClick={() => setMenu((current) => (current === "tools" ? null : "tools"))}
              aria-haspopup="listbox"
              aria-expanded={menu === "tools"}
            >
              <Icon name="wrench" size={15} />
              工具{" "}
              <span className="pill-count">
                {effectiveToolIds.filter((id) => tools.some((tool) => tool.id === id)).length}/{tools.length}
              </span>
            </button>

            <button
              type="button"
              className={`pill-btn pill-btn--access ${
                accessMode === "full_access" ? "is-warn" : ""
              }`}
              onClick={() => setMenu((current) => (current === "access" ? null : "access"))}
              aria-haspopup="listbox"
              aria-expanded={menu === "access"}
              title="本次对话的执行方式"
            >
              <Icon name="shield" size={15} />
              <span>{ACCESS_MODE_LABEL[accessMode]}</span>
            </button>

            <label className="select-pill">
              <span>模型</span>
              <select
                value={selectedModelId}
                disabled={disabled || models.length === 0}
                onChange={(event) => onModelChange(event.target.value)}
                aria-label="选择模型"
              >
                {models.map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>

            {canChooseReasoning && (
              <label className="select-pill select-pill--reasoning" title="模型推理等级">
                <span>推理</span>
                <select
                  value={effectiveReasoning}
                  onChange={(event) => onReasoningChange?.(event.target.value)}
                  aria-label="推理等级"
                >
                  <option value="">跟随模型{selectedModel?.defaultReasoningEffort ? `（${reasoningLabel(selectedModel.defaultReasoningEffort)}）` : ""}</option>
                  {availableReasoning.filter(Boolean).map((option) => (
                    <option value={option} key={option}>
                      {reasoningLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="composer__right">
            <span className="send-hint">Enter 发送</span>
            <button
              type="button"
              className={`composer__send ${streaming ? "is-stop" : ""}`}
              onClick={() => {
                if (streaming) onStop?.();
                else submit();
              }}
              disabled={!streaming && (!value.trim() || disabled)}
              title={streaming ? "停止接收（后台任务继续）" : "发送"}
              aria-label={streaming ? "停止接收（后台任务继续）" : "发送消息"}
            >
              <Icon name={streaming ? "stop" : "send"} size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="composer-context">
        <div className="composer-context__line">
          <span>上下文</span>
          <span className="composer-context__value">
            {contextInfo
              ? `${contextInfo.label ?? ""}${formatTokens(contextInfo.usedTokens)} / ${formatTokens(contextInfo.totalTokens)} · ${contextPercent.toFixed(0)}%`
              : "尚未开始对话"}
          </span>
        </div>
        <div className="context-meter" aria-hidden="true">
          <span style={{ width: `${contextPercent}%` }} />
        </div>
      </div>

      <div className="composer-note">
        <span>
          <i />
          {note}
        </span>
        <span>{selectedModel?.name ?? "—"}</span>
      </div>
    </div>
  );
}

function reasoningLabel(value: string): string {
  return ({ off: "关闭思考", none: "无推理预算", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高" } as Record<string, string>)[value] ?? value;
}
