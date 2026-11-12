"""User-owned PagePilot publications and immutable content versions."""

from __future__ import annotations

import json
from typing import Any

from webagent.agent.db import connect, utc_now


class PublicationError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def recover_interrupted() -> None:
    message = "上次发布因服务重启中断；请核对远端状态，不要重复新建页面"
    with connect() as conn:
        conn.execute(
            "UPDATE publications SET status = 'failed', last_error = ?, updated_at = ?, latest_version_id = COALESCE(latest_version_id, (SELECT MAX(id) FROM publication_versions WHERE publication_id = publications.id)) WHERE status = 'publishing'",
            (message, utc_now()),
        )
        conn.execute(
            "UPDATE publication_versions SET status = 'failed', error = ? WHERE status = 'publishing'",
            (message,),
        )


def _public(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["password_set"] = bool(item.get("password_set"))
    return item


def list_publications(
    user_id: int,
    *,
    q: str = "",
    session_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    conditions = ["user_id = ?"]
    parameters: list[Any] = [user_id]
    if q.strip():
        conditions.append("(instr(lower(title), lower(?)) > 0 OR instr(lower(description), lower(?)) > 0)")
        parameters.extend([q.strip(), q.strip()])
    if session_id:
        conditions.append("session_id = ?")
        parameters.append(session_id)
    where = " AND ".join(conditions)
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    with connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM publications WHERE {where}", parameters
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM publications WHERE {where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
            [*parameters, limit, offset],
        ).fetchall()
    return {"items": [_public(row) for row in rows], "total": total, "limit": limit, "offset": offset}


def owned_publication(publication_id: int, user_id: int) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM publications WHERE id = ? AND user_id = ?",
            (publication_id, user_id),
        ).fetchone()
    if row is None:
        raise PublicationError("发布记录不存在或不属于当前账号", 404)
    return _public(row)


def owned_code(code: str, remote_base_url: str, user_id: int) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM publications WHERE code = ? AND remote_base_url = ? AND user_id = ?",
            (code, remote_base_url, user_id),
        ).fetchone()
    if row is None:
        raise PublicationError("只能更新当前账号在本系统中发布的页面，请从“已发布”选择页面", 404)
    return _public(row)


def detail(publication_id: int, user_id: int) -> dict[str, Any]:
    publication = owned_publication(publication_id, user_id)
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, version, title, description, url, detail_url, visibility, password_set, size, status, error, created_at FROM publication_versions WHERE publication_id = ? ORDER BY id DESC",
            (publication_id,),
        ).fetchall()
        latest = conn.execute(
            "SELECT html FROM publication_versions WHERE id = ? AND publication_id = ?",
            (publication.get("latest_version_id"), publication_id),
        ).fetchone()
    publication["html"] = latest["html"] if latest else ""
    publication["versions"] = [_public(row) for row in rows]
    return publication


def version_detail(publication_id: int, version_id: int, user_id: int) -> dict[str, Any]:
    owned_publication(publication_id, user_id)
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM publication_versions WHERE publication_id = ? AND id = ?",
            (publication_id, version_id),
        ).fetchone()
    if row is None:
        raise PublicationError("发布版本不存在", 404)
    item = _public(row)
    item.pop("response", None)
    return item


def begin_publish(
    *,
    user: dict[str, Any],
    remote_base_url: str,
    session_id: str | None,
    publication_id: int | None,
    title: str,
    description: str,
    html: str,
    filename: str,
    visibility: str,
    password_set: bool,
    source: str,
) -> tuple[int, int]:
    now = utc_now()
    size = len(html.encode("utf-8"))
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if publication_id:
            cursor = conn.execute(
                "UPDATE publications SET status = 'publishing', last_error = '', updated_at = ? WHERE id = ? AND user_id = ? AND status != 'publishing'",
                (now, publication_id, user["id"]),
            )
            if not cursor.rowcount:
                raise PublicationError("页面正在发布，请等待当前发布结束后重试", 409)
        else:
            cursor = conn.execute(
                """
                INSERT INTO publications
                    (user_id, username, session_id, remote_base_url, title, description, filename,
                     visibility, password_set, size, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'publishing', ?, ?)
                """,
                (user["id"], user["username"], session_id, remote_base_url, title, description,
                 filename, visibility, int(password_set), size, source, now, now),
            )
            publication_id = int(cursor.lastrowid)
        cursor = conn.execute(
            """
            INSERT INTO publication_versions
                (publication_id, html, title, description, filename, visibility, password_set,
                 size, source, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'publishing', ?)
            """,
            (publication_id, html, title, description, filename, visibility,
             int(password_set), size, source, now),
        )
        version_id = int(cursor.lastrowid)
    return publication_id, version_id


def finish_publish(
    publication_id: int,
    version_id: int,
    *,
    status: str,
    result: dict[str, Any],
    error: str = "",
    content_published: bool = False,
) -> None:
    now = utc_now()
    with connect() as conn:
        version = conn.execute(
            "SELECT * FROM publication_versions WHERE id = ? AND publication_id = ?",
            (version_id, publication_id),
        ).fetchone()
        conn.execute(
            """
            UPDATE publication_versions
            SET status = ?, error = ?, code = ?, url = ?, detail_url = ?, version = ?, response = ?,
                visibility = ?, password_set = ?
            WHERE id = ? AND publication_id = ?
            """,
            (status, error[:1000], result.get("code", ""), result.get("url", ""),
             result.get("detail_url", ""), result.get("version"),
             json.dumps(result, ensure_ascii=False), result.get("visibility", version["visibility"]),
             int(bool(result.get("password_set", version["password_set"]))), version_id, publication_id),
        )
        if content_published and version:
            conn.execute(
                """
                UPDATE publications
                SET status = ?, last_error = ?, code = ?, url = ?, detail_url = ?, version = ?,
                    title = ?, description = ?, filename = ?, visibility = ?, password_set = ?,
                    size = ?, source = ?, latest_version_id = ?,
                    publish_count = publish_count + CASE WHEN latest_version_id = ? THEN 0 ELSE 1 END,
                    updated_at = ?
                WHERE id = ?
                """,
                (status, error[:1000], result.get("code", ""), result.get("url", ""),
                 result.get("detail_url", ""), result.get("version"), version["title"],
                 version["description"], version["filename"], result.get("visibility", version["visibility"]),
                 int(bool(result.get("password_set", version["password_set"]))), version["size"],
                 version["source"], version_id, version_id, now, publication_id),
            )
        else:
            conn.execute(
                "UPDATE publications SET status = ?, last_error = ?, latest_version_id = COALESCE(latest_version_id, ?), updated_at = ? WHERE id = ?",
                (status, error[:1000], version_id, now, publication_id),
            )
