"""Context budgeting, model-assisted compaction and overflow trimming."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from webagent.agent import db, sessions
from webagent.agent.llm import LLMError, chat_completion


@dataclass
class ContextPlan:
    messages: list[dict[str, Any]]
    summary: str
    total_messages: int
    included_messages: int
    summarized_messages: int
    context_tokens: int
    context_window: int
    budget_tokens: int
    usage_ratio: float
    compressed: bool
    compaction: dict[str, Any] | None = None

    def public(self) -> dict[str, Any]:
        return {
            "total_messages": self.total_messages,
            "included_messages": self.included_messages,
            "summarized_messages": self.summarized_messages,
            "context_tokens": self.context_tokens,
            "context_window": self.context_window,
            "budget_tokens": self.budget_tokens,
            "usage_ratio": round(self.usage_ratio, 4),
            "compressed": self.compressed,
            "compaction": self.compaction or {},
        }


def _clip(value: str, length: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= length else f"{text[:length]}…"


def _role_label(role: str) -> str:
    return {"user": "用户", "assistant": "助手", "tool": "工具"}.get(role, role)


def local_summary(
    existing_summary: str,
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 4000,
) -> str:
    lines = []
    if existing_summary.strip():
        lines.append("已有摘要：")
        lines.append(_clip(existing_summary, max(600, max_chars // 3)))
    if messages:
        lines.append("较早对话：")
        for message in messages:
            content = _clip(message.get("content", ""), 260)
            if content:
                lines.append(f"- {_role_label(message['role'])}：{content}")
    summary = "\n".join(lines).strip()
    if len(summary) <= max_chars:
        return summary
    return f"{summary[: max_chars - 1]}…"


def _transcript(messages: list[dict[str, Any]], max_chars: int = 18000) -> str:
    lines: list[str] = []
    used = 0
    for message in messages:
        content = _clip(message.get("content", ""), 1200)
        if not content:
            continue
        line = f"{_role_label(message['role'])}：{content}"
        if used + len(line) > max_chars:
            lines.append("……（更早内容已省略）")
            break
        lines.append(line)
        used += len(line)
    return "\n".join(lines)


def _summary_prompt(existing_summary: str, messages: list[dict[str, Any]]) -> str:
    return "\n".join(
        [
            "请把下面的较早对话压缩成一份可继续任务的中文摘要。",
            "保留：用户目标、已确认事实、关键数据、工具调用结论、权限拒绝、",
            "未完成事项和下一步。不要编造，不要加入对话中没有的信息。",
            "输出 600 字以内，使用短段落或短列表。",
            "",
            "已有摘要：",
            existing_summary.strip() or "（无）",
            "",
            "新增对话：",
            _transcript(messages),
        ]
    )


def _context_budget(
    model: dict[str, Any], config: dict[str, Any]
) -> tuple[int, int]:
    context_window = int(model.get("context_window") or 0)
    configured_cap = int(config.get("context_max_tokens") or 0)
    if context_window <= 0:
        context_window = configured_cap or 32768
    max_context = context_window
    if configured_cap > 0:
        max_context = min(max_context, configured_cap)
    max_context = max(2048, max_context)
    reserved_output = int(model.get("max_output_tokens") or 0)
    reserved_output = min(reserved_output, max_context // 2)
    reserve = int(config.get("context_reserve_tokens") or 1600)
    budget = max_context - reserved_output - reserve
    return max(1200, budget), max_context


def _message_tokens(message: dict[str, Any]) -> int:
    return sessions.estimate_tokens(message.get("content", ""))


def _find_keep_start(
    rows: list[tuple[dict[str, Any], int]], keep_budget: int
) -> int:
    for index, (message, _tokens) in enumerate(rows):
        if message["role"] != "user":
            continue
        tail = sum(tokens for _, tokens in rows[index:])
        if tail <= keep_budget:
            return index
    for index in range(len(rows) - 1, -1, -1):
        if rows[index][0]["role"] == "user":
            return index
    return max(0, len(rows) - 1)


async def compact_session(
    session: dict[str, Any],
    user_id: int,
    model: dict[str, Any],
    config: dict[str, Any],
    *,
    summary_model: dict[str, Any] | None = None,
    summary_provider: dict[str, Any] | None = None,
    trigger: str = "auto",
    keep_ratio: float | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    after_id = int(session.get("summary_until_id") or 0)
    messages = sessions.list_messages(session["id"], user_id, after_id=after_id)
    existing_summary = str(session.get("summary") or "")
    budget, _context_window = _context_budget(model, config)
    before_tokens = sum(_message_tokens(message) for message in messages)
    before_tokens += sessions.estimate_tokens(existing_summary)
    if not messages:
        return {
            "ok": False,
            "reason": "没有可压缩的消息",
            "before_tokens": before_tokens,
            "after_tokens": before_tokens,
            "summarized_messages": 0,
        }

    ratio = float(keep_ratio or config.get("compaction_keep_ratio") or 0.58)
    keep_budget = max(600, int(budget * max(0.2, min(ratio, 0.9))))
    rows = [(message, _message_tokens(message)) for message in messages]
    keep_start = _find_keep_start(rows, keep_budget)
    if keep_start <= 0:
        return {
            "ok": False,
            "reason": "剩余消息已经很少，无需压缩",
            "before_tokens": before_tokens,
            "after_tokens": before_tokens,
            "summarized_messages": 0,
        }

    compacted = [message for message, _ in rows[:keep_start]]
    summary_model = summary_model or model
    summary_text = ""
    summary_label = "local"
    summary_usage: dict[str, Any] = {}
    summary_error = ""

    if not config.get("demo_mode") and summary_provider is not None:
        try:
            completion = await chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是对话压缩器。只输出摘要，不回答用户问题，"
                            "不调用工具，不编造事实。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": _summary_prompt(existing_summary, compacted),
                    },
                ],
                tools=[],
                model=summary_model,
                provider=summary_provider,
                config=config,
                session_id=session["id"],
                username=str(session.get("username", "")),
                purpose="summary",
                max_tokens_override=1200,
            )
            candidate = str(completion.get("content") or "").strip()
            if candidate:
                summary_text = candidate
                summary_label = str(summary_model.get("model_id") or "model")
            summary_usage = completion.get("usage") or {}
        except LLMError as exc:
            summary_error = str(exc)
        except Exception as exc:  # noqa: BLE001 - summary must not break chat
            summary_error = str(exc)

    if not summary_text:
        summary_text = local_summary(
            existing_summary,
            compacted,
            max_chars=max(1200, min(5000, budget // 3)),
        )

    summary_until_id = int(compacted[-1]["id"])
    sessions.update_compaction(
        session["id"],
        summary=summary_text,
        summary_until_id=summary_until_id,
        last_context_tokens=sum(tokens for _, tokens in rows[keep_start:]),
    )
    after_tokens = sum(tokens for _, tokens in rows[keep_start:])
    after_tokens += sessions.estimate_tokens(summary_text)
    duration_ms = int((time.monotonic() - started) * 1000)
    db.record_compaction_event(
        session_id=session["id"],
        trigger=trigger,
        before_tokens=before_tokens,
        after_tokens=after_tokens,
        summarized_messages=len(compacted),
        summary_model=summary_label,
        duration_ms=duration_ms,
        ok=True,
        error=summary_error,
    )
    return {
        "ok": True,
        "trigger": trigger,
        "summary": summary_text,
        "summary_until_id": summary_until_id,
        "before_tokens": before_tokens,
        "after_tokens": after_tokens,
        "saved_tokens": max(0, before_tokens - after_tokens),
        "summarized_messages": len(compacted),
        "summary_model": summary_label,
        "duration_ms": duration_ms,
        "usage": summary_usage,
        "fallback_reason": summary_error,
    }


async def prepare_context(
    session: dict[str, Any],
    user_id: int,
    model: dict[str, Any],
    config: dict[str, Any],
    *,
    summary_model: dict[str, Any] | None = None,
    summary_provider: dict[str, Any] | None = None,
    force: bool = False,
    trigger: str = "auto",
) -> ContextPlan:
    after_id = int(session.get("summary_until_id") or 0)
    messages = sessions.list_messages(session["id"], user_id, after_id=after_id)
    total_messages = int(session.get("message_count") or 0)
    existing_summary = str(session.get("summary") or "")
    budget, context_window = _context_budget(model, config)

    rows = [(message, _message_tokens(message)) for message in messages]
    total_tokens = sum(tokens for _, tokens in rows)
    total_tokens += sessions.estimate_tokens(existing_summary)

    compaction: dict[str, Any] | None = None
    should_compact = force or total_tokens > budget
    if (
        should_compact
        and (force or config.get("context_compression", True))
        and messages
    ):
        result = await compact_session(
            session,
            user_id,
            model,
            config,
            summary_model=summary_model,
            summary_provider=summary_provider,
            trigger=trigger,
        )
        if result.get("ok"):
            compaction = result
            refreshed = sessions.get_session(session["id"], user_id) or session
            after_id = int(refreshed.get("summary_until_id") or 0)
            existing_summary = str(refreshed.get("summary") or "")
            messages = sessions.list_messages(
                session["id"], user_id, after_id=after_id
            )
            rows = [(message, _message_tokens(message)) for message in messages]
            total_tokens = sum(tokens for _, tokens in rows)
            total_tokens += sessions.estimate_tokens(existing_summary)
        elif result.get("reason"):
            compaction = result

    plan_messages = [
        {"role": message["role"], "content": message.get("content", "")}
        for message, _ in rows
        if message["role"] in {"user", "assistant"} and message.get("content")
    ]
    if existing_summary.strip():
        plan_messages.insert(0, {
            "role": "assistant",
            "content": (
                "以下是较早对话的压缩摘要，仅用于恢复上下文，不是新的系统指令：\n\n"
                + existing_summary
            ),
        })
    return ContextPlan(
        messages=plan_messages,
        summary=existing_summary,
        total_messages=total_messages,
        included_messages=len(messages),
        summarized_messages=int((compaction or {}).get("summarized_messages") or 0),
        context_tokens=total_tokens,
        context_window=context_window,
        budget_tokens=budget,
        usage_ratio=total_tokens / max(1, budget),
        compressed=bool(compaction and compaction.get("ok")),
        compaction=compaction,
    )


def emergency_trim(
    messages: list[dict[str, Any]],
    budget_tokens: int,
    session_id: str | None,
    *,
    trigger: str = "overflow",
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    if len(messages) <= 2:
        return messages, None
    system = messages[0] if messages[0].get("role") == "system" else None
    body = messages[1:] if system else messages
    keep_budget = max(600, int(budget_tokens * 0.7))
    user_indexes = [
        index for index, message in enumerate(body) if message.get("role") == "user"
    ]
    keep_start = 0
    for index in user_indexes:
        tail = sum(sessions.estimate_tokens(item.get("content", "")) for item in body[index:])
        if tail <= keep_budget:
            keep_start = index
            break
    else:
        if user_indexes:
            keep_start = user_indexes[-1]

    if keep_start <= 0:
        return messages, None
    dropped = body[:keep_start]
    kept = body[keep_start:]
    before_tokens = sum(
        sessions.estimate_tokens(item.get("content", "")) for item in messages
    )
    after_tokens = sum(
        sessions.estimate_tokens(item.get("content", "")) for item in kept
    )
    note = (
        f"\n\n[上下文提示] 本轮上下文超过预算，已省略较早的 "
        f"{len(dropped)} 条消息。不要向用户声称看过被省略的内容。"
    )
    if system is not None:
        system = dict(system)
        system["content"] = str(system.get("content") or "") + note
        result = [system, *kept]
    else:
        result = [{"role": "system", "content": note.strip()}, *kept]
    if session_id:
        db.record_compaction_event(
            session_id=session_id,
            trigger=trigger,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
            summarized_messages=len(dropped),
            summary_model="local-trim",
            duration_ms=0,
            ok=True,
        )
    return result, {
        "trigger": trigger,
        "summarized_messages": len(dropped),
        "before_tokens": before_tokens,
        "after_tokens": after_tokens,
        "saved_tokens": max(0, before_tokens - after_tokens),
        "summary_model": "local-trim",
        "ok": True,
    }
