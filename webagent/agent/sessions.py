"""Server-side sessions, messages and user-scoped long-term memories."""

from __future__ import annotations

import json
import re
import secrets
from typing import Any

from webagent.agent.db import connect, utc_now


def estimate_tokens(value: Any) -> int:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if not text:
        return 0
    cjk = len(re.findall(r"[\u3400-\u9fff\uf900-\ufaff]", text))
    words = len(re.findall(r"[A-Za-z0-9_]+", text))
    remaining = max(0, len(text) - cjk)
    return max(1, cjk + words + remaining // 4)


def _json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str) or not value.strip():
        return fallback
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return fallback
    return parsed


def _message_public(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "role": row["role"],
        "content": row["content"],
        "attachments": _json(row["attachments"], []),
        "tool_runs": _json(row["tool_runs"], []),
        "metadata": _json(row["metadata"], {}),
        "token_estimate": row["token_estimate"],
        "created_at": row["created_at"],
    }


def _session_public(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "assistant_id": row["assistant_id"] if "assistant_id" in row.keys() else None,
        "assistant_name": (
            row["assistant_name"] if "assistant_name" in row.keys() else None
        ),
        "assistant_icon": (
            row["assistant_icon"] if "assistant_icon" in row.keys() else None
        ),
        "title": row["title"],
        "summary": row["summary"],
        "summary_until_id": row["summary_until_id"],
        "last_context_tokens": row["last_context_tokens"],
        "last_compacted_at": row["last_compacted_at"],
        "message_count": row["message_count"] if "message_count" in row.keys() else 0,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_session(
    user: dict[str, Any],
    title: str = "新对话",
    assistant_id: int | None = None,
) -> dict[str, Any]:
    now = utc_now()
    session_id = f"s_{secrets.token_urlsafe(12)}"
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions
                (id, user_id, username, assistant_id, title, summary,
                 summary_until_id, last_context_tokens, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, '', 0, 0, ?, ?)
            """,
            (
                session_id,
                user["id"],
                user["username"],
                assistant_id,
                (title or "新对话").strip()[:120],
                now,
                now,
            ),
        )
    return get_session(session_id, user["id"]) or {}


def list_sessions(user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT s.*, COUNT(m.id) AS message_count,
                   a.name AS assistant_name, a.icon AS assistant_icon
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            LEFT JOIN assistants a ON a.id = s.assistant_id
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY s.updated_at DESC
            LIMIT ?
            """,
            (user_id, max(1, min(limit, 200))),
        ).fetchall()
    return [_session_public(row) for row in rows]


def get_session(session_id: str, user_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT s.*, COUNT(m.id) AS message_count,
                   a.name AS assistant_name, a.icon AS assistant_icon
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
            LEFT JOIN assistants a ON a.id = s.assistant_id
            WHERE s.id = ? AND s.user_id = ?
            GROUP BY s.id
            """,
            (session_id, user_id),
        ).fetchone()
    return _session_public(row) if row else None


def set_session_assistant(
    session_id: str, user_id: int, assistant_id: int | None
) -> dict[str, Any] | None:
    with connect() as conn:
        cursor = conn.execute(
            """
            UPDATE sessions SET assistant_id = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (assistant_id, utc_now(), session_id, user_id),
        )
    return get_session(session_id, user_id) if cursor.rowcount else None


def rename_session(session_id: str, user_id: int, title: str) -> dict[str, Any] | None:
    with connect() as conn:
        cursor = conn.execute(
            """
            UPDATE sessions SET title = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (title.strip()[:120] or "新对话", utc_now(), session_id, user_id),
        )
    return get_session(session_id, user_id) if cursor.rowcount else None


def delete_session(session_id: str, user_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id),
        )
    return cursor.rowcount > 0


def add_message(
    session_id: str,
    *,
    role: str,
    content: str,
    attachments: list[dict[str, Any]] | None = None,
    tool_runs: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    attachments = attachments or []
    tool_runs = tool_runs or []
    metadata = metadata or {}
    token_estimate = estimate_tokens(content) + estimate_tokens(tool_runs)
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO messages
                (session_id, role, content, attachments, tool_runs,
                 metadata, token_estimate, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                role,
                content,
                json.dumps(attachments, ensure_ascii=False),
                json.dumps(tool_runs, ensure_ascii=False),
                json.dumps(metadata, ensure_ascii=False),
                token_estimate,
                now,
            ),
        )
        message_id = int(cursor.lastrowid)
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
    return get_message(session_id, message_id) or {}


def get_message(session_id: str, message_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM messages WHERE id = ? AND session_id = ?",
            (message_id, session_id),
        ).fetchone()
    return _message_public(row) if row else None


def update_message(
    message_id: int,
    *,
    content: str | None = None,
    tool_runs: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    with connect() as conn:
        current = conn.execute(
            "SELECT * FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
    if not current:
        return None
    values: dict[str, Any] = {}
    if content is not None:
        values["content"] = content
    if tool_runs is not None:
        values["tool_runs"] = json.dumps(tool_runs, ensure_ascii=False)
    if metadata is not None:
        values["metadata"] = json.dumps(metadata, ensure_ascii=False)
    if attachments is not None:
        values["attachments"] = json.dumps(attachments, ensure_ascii=False)
    if not values:
        return _message_public(current)
    content_value = content if content is not None else current["content"]
    tool_value = (
        tool_runs
        if tool_runs is not None
        else _json(current["tool_runs"], [])
    )
    values["token_estimate"] = estimate_tokens(content_value) + estimate_tokens(tool_value)
    assignments = ", ".join(f"{key} = ?" for key in values)
    with connect() as conn:
        cursor = conn.execute(
            f"UPDATE messages SET {assignments} WHERE id = ?",
            [*values.values(), message_id],
        )
        if not cursor.rowcount:
            return None
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    return _message_public(row) if row else None


def find_message_by_approval(
    session_id: str, approval_id: str
) -> dict[str, Any] | None:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM messages
            WHERE session_id = ? AND role = 'assistant'
            ORDER BY id DESC LIMIT 40
            """,
            (session_id,),
        ).fetchall()
    for row in rows:
        metadata = _json(row["metadata"], {})
        approval = metadata.get("approval") if isinstance(metadata, dict) else None
        if isinstance(approval, dict) and approval.get("id") == approval_id:
            return _message_public(row)
    return None


def list_messages(
    session_id: str,
    user_id: int,
    *,
    after_id: int = 0,
) -> list[dict[str, Any]]:
    with connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id),
        ).fetchone()
        if not exists:
            return []
        rows = conn.execute(
            """
            SELECT * FROM messages
            WHERE session_id = ? AND id > ?
            ORDER BY id ASC
            """,
            (session_id, after_id),
        ).fetchall()
    return [_message_public(row) for row in rows]


def clear_messages(session_id: str, user_id: int) -> bool:
    with connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id),
        ).fetchone()
        if not exists:
            return False
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute(
            """
            UPDATE sessions
            SET summary = '', summary_until_id = 0, last_context_tokens = 0,
                last_compacted_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (utc_now(), session_id),
        )
    return True


def update_compaction(
    session_id: str,
    *,
    summary: str,
    summary_until_id: int,
    last_context_tokens: int,
) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE sessions
            SET summary = ?, summary_until_id = ?, last_context_tokens = ?,
                last_compacted_at = ?
            WHERE id = ?
            """,
            (
                summary,
                summary_until_id,
                last_context_tokens,
                utc_now(),
                session_id,
            ),
        )


def maybe_title_session(
    session_id: str, user_id: int, first_user_message: str
) -> None:
    title = re.sub(r"\s+", " ", first_user_message).strip()[:28] or "新对话"
    with connect() as conn:
        conn.execute(
            """
            UPDATE sessions SET title = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
              AND (title = '新对话' OR title = '')
            """,
            (title, utc_now(), session_id, user_id),
        )


def list_memories(user_id: int, include_disabled: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM memories WHERE user_id = ?"
    if not include_disabled:
        sql += " AND enabled = 1"
    sql += " ORDER BY updated_at DESC, id DESC"
    with connect() as conn:
        rows = conn.execute(sql, (user_id,)).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        items.append(item)
    return items


def create_memory(
    user: dict[str, Any], content: str, kind: str = "fact"
) -> dict[str, Any]:
    now = utc_now()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO memories
                (user_id, username, content, kind, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (
                user["id"],
                user["username"],
                content.strip()[:2000],
                kind,
                now,
                now,
            ),
        )
        memory_id = int(cursor.lastrowid)
    return get_memory(memory_id, user["id"]) or {}


def get_memory(memory_id: int, user_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM memories WHERE id = ? AND user_id = ?",
            (memory_id, user_id),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["enabled"] = bool(item["enabled"])
    return item


def update_memory(
    memory_id: int,
    user_id: int,
    values: dict[str, Any],
) -> dict[str, Any] | None:
    allowed = {"content", "kind", "enabled"}
    updates = {key: value for key, value in values.items() if key in allowed}
    if not updates:
        return get_memory(memory_id, user_id)
    if "enabled" in updates:
        updates["enabled"] = int(bool(updates["enabled"]))
    if "content" in updates:
        updates["content"] = str(updates["content"]).strip()[:2000]
    updates["updated_at"] = utc_now()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        cursor = conn.execute(
            f"UPDATE memories SET {assignments} WHERE id = ? AND user_id = ?",
            [*updates.values(), memory_id, user_id],
        )
    return get_memory(memory_id, user_id) if cursor.rowcount else None


def delete_memory(memory_id: int, user_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "DELETE FROM memories WHERE id = ? AND user_id = ?",
            (memory_id, user_id),
        )
    return cursor.rowcount > 0
