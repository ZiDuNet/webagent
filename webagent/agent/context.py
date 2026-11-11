"""Context budgeting and automatic conversation compaction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from webagent.agent import sessions


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

    def public(self) -> dict[str, Any]:
        return {
            "total_messages": self.total_messages,
            "included_messages": self.included_messages,
            "summarized_messages": self.summarized_messages,
            "context_tokens": self.context_tokens,
            "context_window": self.context_window,
            "budget_tokens": self.budget_tokens,
            "usage_ratio": round(self.usage_ratio, 3),
            "compressed": self.compressed,
        }


def _clip(value: str, length: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= length else f"{text[:length]}…"


def summarize_messages(
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
            role = "用户" if message["role"] == "user" else "Agent"
            content = _clip(message.get("content", ""), 260)
            if content:
                lines.append(f"- {role}：{content}")
    summary = "\n".join(lines).strip()
    if len(summary) <= max_chars:
        return summary
    return f"{summary[: max_chars - 1]}…"


def prepare_context(
    session: dict[str, Any],
    user_id: int,
    model: dict[str, Any],
    config: dict[str, Any],
) -> ContextPlan:
    after_id = int(session.get("summary_until_id") or 0)
    all_messages = sessions.list_messages(
        session["id"], user_id, after_id=after_id
    )
    total_messages = int(session.get("message_count") or 0)
    existing_summary = str(session.get("summary") or "")

    context_window = int(model.get("context_window") or 0)
    if context_window <= 0:
        context_window = int(config["context_max_tokens"])
    max_context = max(
        2048, min(context_window, int(config["context_max_tokens"]))
    )
    reserved_output = int(model.get("max_output_tokens") or 0)
    budget = max_context - min(reserved_output, max_context // 2) - 1600
    budget = max(1200, budget)

    token_rows = [
        (
            message,
            sessions.estimate_tokens(message.get("content", "")),
        )
        for message in all_messages
        if message["role"] in {"user", "assistant"}
    ]
    total_tokens = sum(tokens for _, tokens in token_rows) + sessions.estimate_tokens(
        existing_summary
    )

    if total_tokens <= budget:
        return ContextPlan(
            messages=[
                {"role": message["role"], "content": message.get("content", "")}
                for message in all_messages
                if message["role"] in {"user", "assistant"}
                and message.get("content")
            ],
            summary=existing_summary,
            total_messages=total_messages,
            included_messages=len(all_messages),
            summarized_messages=0,
            context_tokens=total_tokens,
            context_window=context_window,
            budget_tokens=budget,
            usage_ratio=total_tokens / max(1, budget),
            compressed=False,
        )

    keep_budget = max(800, int(budget * 0.58))
    recent: list[tuple[dict[str, Any], int]] = []
    used = 0
    for message, tokens in reversed(token_rows):
        if recent and used + tokens > keep_budget:
            break
        recent.append((message, tokens))
        used += tokens
    recent.reverse()

    if not recent and token_rows:
        recent = [token_rows[-1]]
        used = token_rows[-1][1]

    recent_ids = {message["id"] for message, _ in recent}
    compacted = [
        message
        for message, _ in token_rows
        if message["id"] not in recent_ids
    ]
    summary = existing_summary
    summary_until_id = after_id
    if config.get("context_compression", True) and compacted:
        summary = summarize_messages(
            existing_summary,
            compacted,
            max_chars=max(1200, min(5000, budget // 3)),
        )
        summary_until_id = int(compacted[-1]["id"])
        sessions.update_compaction(
            session["id"],
            summary=summary,
            summary_until_id=summary_until_id,
            last_context_tokens=used,
        )
    elif compacted:
        summary = existing_summary

    summary_tokens = sessions.estimate_tokens(summary)
    context_tokens = used + summary_tokens
    included_messages = len(recent) + (1 if summary else 0)
    return ContextPlan(
        messages=[
            {"role": message["role"], "content": message.get("content", "")}
            for message, _ in recent
            if message.get("content")
        ],
        summary=summary,
        total_messages=total_messages,
        included_messages=included_messages,
        summarized_messages=len(compacted),
        context_tokens=context_tokens,
        context_window=context_window,
        budget_tokens=budget,
        usage_ratio=context_tokens / max(1, budget),
        compressed=bool(compacted and config.get("context_compression", True)),
    )
