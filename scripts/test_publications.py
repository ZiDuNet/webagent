#!/usr/bin/env python3
"""独立回归：publications.py + pagepilot.py 在临时 SQLite 与 mock transport 上的行为。

该脚本不访问真实数据库，也不请求远端发布服务：
- 用临时 SQLite 重建 publications / publication_versions / settings / sessions /
  audit_log / tool_settings 等表；
- 用 fake httpx2 transport 记录并回放远端调用；
- mock sessions.get_session、db.get_settings/set_settings/log_audit/get_tool_setting
  与 pagepilot.decrypt_secret。

运行：.venv/bin/python scripts/test_publications.py
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from webagent.agent import db as db_module
from webagent.agent import pagepilot
from webagent.agent import publications


_TEMP_DB_PATH: Path | None = None
_ORIGINALS: dict[str, object] = {}


def temp_connect() -> sqlite3.Connection:
    assert _TEMP_DB_PATH is not None
    conn = sqlite3.connect(_TEMP_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def temp_get_settings() -> dict[str, str]:
    with temp_connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    values = dict(db_module.DEFAULT_SETTINGS)
    values.update({row["key"]: row["value"] for row in rows})
    return values


def temp_set_settings(values: dict[str, str]) -> None:
    with temp_connect() as conn:
        for key, value in values.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )


def temp_get_tool_setting(name: str, source: str = "mcp") -> dict[str, object]:
    return db_module.default_tool_setting(name, source)


def temp_log_audit(
    *,
    username: str,
    action: str,
    resource: str,
    detail: str | dict[str, object] = "",
    source: str = "agent",
) -> None:
    if not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)
    with temp_connect() as conn:
        conn.execute(
            "INSERT INTO audit_log (ts, username, action, resource, detail, source) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (db_module.utc_now(), username, action, resource, detail, source),
        )


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: object = None) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self) -> object:
        return self._payload


class FakeAsyncClient:
    def __init__(self, **kwargs: object) -> None:
        self.timeout = kwargs.get("timeout")
        self.headers = kwargs.get("headers") or {}

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def request(
        self,
        method: str,
        url: str,
        json: object = None,
        headers: object = None,
    ) -> FakeResponse:
        return await FakeHttp2.run(method, url, json, headers)

    async def get(self, url: str, headers: object = None) -> FakeResponse:
        return await FakeHttp2.run("GET", url, None, headers)


class FakeHttp2:
    RequestError = type("RequestError", (Exception,), {})
    TimeoutException = type("TimeoutException", (Exception,), {})
    Response = FakeResponse
    Timeout = type("Timeout", (object,), {})

    calls: list[dict[str, object]] = []
    handler: object = None

    @classmethod
    def reset(cls, handler: object) -> None:
        cls.calls = []
        cls.handler = handler

    @classmethod
    async def run(
        cls,
        method: str,
        url: str,
        body: object,
        headers: object,
    ) -> FakeResponse:
        cls.calls.append(
            {"method": method, "url": url, "json": body, "headers": headers}
        )
        if cls.handler is None:
            return FakeResponse(200, {"success": True})
        return await cls.handler(method, url, body, headers)

    @classmethod
    def AsyncClient(cls, *args: object, **kwargs: object) -> FakeAsyncClient:
        return FakeAsyncClient(**kwargs)


def path_of(url: str) -> str:
    return "/" + url.split("://", 1)[1].split("/", 1)[1]


def deploy_handler(
    *,
    code: str = "abc123",
    url: str = "https://pp.test/x/abc123",
    detail_url: str = "https://pp.test/x/abc123/detail",
    version: int = 3,
    fail_deploy: bool = False,
    fail_access: bool = False,
    fail_visibility: bool = False,
):
    async def handler(
        method: str, url_full: str, body: object, headers: object
    ) -> FakeResponse:
        path = path_of(url_full)
        if method == "POST" and path == "/api/deploy":
            if fail_deploy:
                return FakeResponse(500, {"success": False, "detail": "deploy failed"})
            return FakeResponse(
                200,
                {
                    "success": True,
                    "code": code,
                    "url": url,
                    "detailUrl": detail_url,
                    "versionNumber": version,
                },
            )
        if method == "PATCH" and path == "/api/deploy/content":
            if fail_deploy:
                return FakeResponse(500, {"success": False, "detail": "deploy failed"})
            return FakeResponse(
                200,
                {
                    "success": True,
                    "code": code,
                    "url": url,
                    "detailUrl": detail_url,
                    "versionNumber": version,
                },
            )
        if method == "PATCH" and path == f"/api/deploys/{code}/access":
            if fail_access:
                raise FakeHttp2.RequestError("access boom")
            return FakeResponse(200, {"success": True})
        if method == "PATCH" and path == f"/api/deploys/{code}/visibility":
            if fail_visibility:
                raise FakeHttp2.RequestError("visibility boom")
            return FakeResponse(200, {"success": True})
        return FakeResponse(404, {"success": False, "detail": "not found"})

    return handler


def user(id: int, username: str) -> dict[str, object]:
    return {"id": id, "username": username}


def enable_pagepilot(base_url: str = "https://pp.test", token: str = "tok-secret") -> None:
    temp_set_settings(
        {
            "pagepilot_base_url": base_url,
            "pagepilot_token": token,
            "pagepilot_enabled": "1",
            "pagepilot_default_visibility": "unlisted",
        }
    )


def publication_row(pub_id: int) -> dict[str, object]:
    with temp_connect() as conn:
        row = conn.execute(
            "SELECT * FROM publications WHERE id = ?", (pub_id,)
        ).fetchone()
    assert row is not None
    return dict(row)


def version_row(version_id: int) -> dict[str, object]:
    with temp_connect() as conn:
        row = conn.execute(
            "SELECT * FROM publication_versions WHERE id = ?", (version_id,)
        ).fetchone()
    assert row is not None
    return dict(row)


def audit_rows() -> list[dict[str, object]]:
    with temp_connect() as conn:
        rows = conn.execute("SELECT * FROM audit_log ORDER BY id ASC").fetchall()
    return [dict(row) for row in rows]


def setUpModule() -> None:
    global _TEMP_DB_PATH
    fd, path = tempfile.mkstemp(suffix=".db", prefix="webagent-publications-")
    _TEMP_DB_PATH = Path(path)

    _ORIGINALS["db_connect"] = db_module.connect
    _ORIGINALS["db_get_settings"] = db_module.get_settings
    _ORIGINALS["db_set_settings"] = db_module.set_settings
    _ORIGINALS["db_get_tool_setting"] = db_module.get_tool_setting
    _ORIGINALS["db_log_audit"] = db_module.log_audit
    _ORIGINALS["pub_connect"] = publications.connect
    _ORIGINALS["pp_decrypt"] = pagepilot.decrypt_secret
    _ORIGINALS["pp_httpx2"] = pagepilot.httpx2
    _ORIGINALS["sessions_get_session"] = pagepilot.sessions.get_session

    db_module.connect = temp_connect
    db_module.init_db()
    db_module.get_settings = temp_get_settings
    db_module.set_settings = temp_set_settings
    db_module.get_tool_setting = temp_get_tool_setting
    db_module.log_audit = temp_log_audit

    publications.connect = temp_connect
    pagepilot.decrypt_secret = lambda value: value
    pagepilot.httpx2 = FakeHttp2


def tearDownModule() -> None:
    db_module.connect = _ORIGINALS["db_connect"]
    db_module.get_settings = _ORIGINALS["db_get_settings"]
    db_module.set_settings = _ORIGINALS["db_set_settings"]
    db_module.get_tool_setting = _ORIGINALS["db_get_tool_setting"]
    db_module.log_audit = _ORIGINALS["db_log_audit"]
    publications.connect = _ORIGINALS["pub_connect"]
    pagepilot.decrypt_secret = _ORIGINALS["pp_decrypt"]
    pagepilot.httpx2 = _ORIGINALS["pp_httpx2"]
    pagepilot.sessions.get_session = _ORIGINALS["sessions_get_session"]
    if _TEMP_DB_PATH is not None:
        _TEMP_DB_PATH.unlink(missing_ok=True)


class PublicationsRegressionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        with temp_connect() as conn:
            conn.executescript(
                """
                DELETE FROM audit_log;
                DELETE FROM publication_versions;
                DELETE FROM publications;
                DELETE FROM settings;
                DELETE FROM sessions;
                """
            )
        FakeHttp2.reset(None)
        pagepilot.sessions.get_session = lambda session_id, uid: {
            "id": session_id,
            "user_id": uid,
            "title": "会话",
        }

    async def test_owner_isolation_and_admin_no_override(self) -> None:
        enable_pagepilot()
        handler = deploy_handler(code="a1", url="https://pp.test/x/a1")
        FakeHttp2.reset(handler)

        r1 = await pagepilot.publish_html(
            html="<!doctype html><html><body>one</body></html>",
            title="用户一的页面",
            user=user(1, "alice"),
        )
        pub1 = r1["publication_id"]
        self.assertEqual(publication_row(int(pub1))["user_id"], 1)

        FakeHttp2.reset(deploy_handler(code="a2", url="https://pp.test/x/a2"))
        r2 = await pagepilot.publish_html(
            html="<!doctype html><html><body>two</body></html>",
            title="用户二的页面",
            user=user(2, "bob"),
        )
        pub2 = r2["publication_id"]
        self.assertEqual(publication_row(int(pub2))["user_id"], 2)

        listed = publications.list_publications(1)
        self.assertTrue(all(item["user_id"] == 1 for item in listed["items"]))
        self.assertEqual(listed["total"], 1)

        with self.assertRaises(publications.PublicationError) as ctx:
            publications.owned_publication(int(pub2), 1)
        self.assertEqual(ctx.exception.status_code, 404)

        with self.assertRaises(publications.PublicationError) as ctx:
            publications.owned_publication(int(pub1), 999)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(publications.list_publications(999)["total"], 0)

    async def test_list_search_pagination_and_session_filter(self) -> None:
        with temp_connect() as conn:
            for index in range(5):
                conn.execute(
                    """
                    INSERT INTO publications
                        (user_id, username, session_id, remote_base_url, title,
                         description, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'published', '2026-01-01T00:00:00',
                            '2026-01-01T00:00:00')
                    """,
                    (
                        7,
                        "carol",
                        "sess-a" if index < 3 else "sess-b",
                        "https://pp.test",
                        f"标题{index}",
                        "说明" + ("摄像头" if index % 2 == 0 else ""),
                    ),
                )

        matched = publications.list_publications(7, q="摄像头")
        self.assertEqual(matched["total"], 3)

        sess = publications.list_publications(7, session_id="sess-b")
        self.assertEqual(sess["total"], 2)
        self.assertTrue(all(item["session_id"] == "sess-b" for item in sess["items"]))

        page = publications.list_publications(7, limit=2, offset=1)
        self.assertEqual(page["limit"], 2)
        self.assertEqual(page["offset"], 1)
        self.assertEqual(page["total"], 5)
        self.assertEqual(len(page["items"]), 2)

        huge = publications.list_publications(7, limit=9999)
        self.assertEqual(huge["limit"], 100)

    async def test_detail_and_version(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="d1", url="https://pp.test/x/d1"))

        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>detail</body></html>",
            title="详情页",
            user=user(3, "dave"),
        )
        pub_id = int(result["publication_id"])

        detail = publications.detail(pub_id, 3)
        self.assertIn("html", detail)
        self.assertIn("<!doctype html>", detail["html"])
        self.assertGreaterEqual(len(detail["versions"]), 1)

        version_id = detail["versions"][0]["id"]
        version = publications.version_detail(pub_id, int(version_id), 3)
        self.assertNotIn("response", version)
        self.assertIn("html", version)

        with self.assertRaises(publications.PublicationError) as ctx:
            publications.detail(pub_id, 4)
        self.assertEqual(ctx.exception.status_code, 404)

        with self.assertRaises(publications.PublicationError) as ctx:
            publications.version_detail(pub_id, 123456, 3)
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_unowned_code_rejected_without_remote_call(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="owned-code", url="https://pp.test/x/owned-code"))
        await pagepilot.publish_html(
            html="<!doctype html><html><body>owner</body></html>",
            title="归属页",
            user=user(1, "alice"),
        )

        FakeHttp2.reset(deploy_handler(code="owned-code"))
        with self.assertRaises(pagepilot.PagePilotError) as ctx:
            await pagepilot.publish_html(
                html="<!doctype html><html><body>steal</body></html>",
                code="owned-code",
                user=user(2, "bob"),
            )
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(FakeHttp2.calls, [])

    async def test_base_change_rejected_without_remote_call(self) -> None:
        enable_pagepilot(base_url="https://pp-old.test")
        FakeHttp2.reset(deploy_handler(code="old-code", url="https://pp-old.test/x/old-code"))
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>old</body></html>",
            title="旧服务页",
            user=user(1, "alice"),
        )
        pub_id = int(result["publication_id"])

        enable_pagepilot(base_url="https://pp-new.test")
        FakeHttp2.reset(deploy_handler())
        with self.assertRaises(pagepilot.PagePilotError) as ctx:
            await pagepilot.publish_html(
                html="<!doctype html><html><body>new</body></html>",
                publication_id=pub_id,
                user=user(1, "alice"),
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(FakeHttp2.calls, [])

    def test_concurrent_publish_conflict_409(self) -> None:
        enable_pagepilot()
        pub_id, version_id = publications.begin_publish(
            user=user(1, "alice"),
            remote_base_url="https://pp.test",
            session_id=None,
            publication_id=None,
            title="并发页",
            description="",
            html="<!doctype html><html><body>x</body></html>",
            filename="index.html",
            visibility="unlisted",
            password_set=False,
            source="tool",
        )
        with self.assertRaises(publications.PublicationError) as ctx:
            publications.begin_publish(
                user=user(1, "alice"),
                remote_base_url="https://pp.test",
                session_id=None,
                publication_id=pub_id,
                title="并发页",
                description="",
                html="<!doctype html><html><body>y</body></html>",
                filename="index.html",
                visibility="unlisted",
                password_set=False,
                source="tool",
            )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIsNotNone(pub_id)
        self.assertIsNotNone(version_id)

    async def test_failed_preserves_url_html_version(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="stable", url="https://pp.test/x/stable", version=7))
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>stable</body></html>",
            title="稳定页",
            user=user(1, "alice"),
        )
        pub_id = int(result["publication_id"])
        before = publication_row(pub_id)
        self.assertEqual(before["url"], "https://pp.test/x/stable")
        self.assertEqual(before["version"], 7)

        new_html = "<!doctype html><html><body>v2</body></html>"
        FakeHttp2.reset(deploy_handler(code="stable", url="https://pp.test/x/stable", version=7, fail_deploy=True))
        with self.assertRaises(pagepilot.PagePilotError):
            await pagepilot.publish_html(
                html=new_html,
                title="稳定页",
                publication_id=pub_id,
                user=user(1, "alice"),
            )

        after = publication_row(pub_id)
        self.assertEqual(after["status"], "failed")
        self.assertEqual(after["url"], "https://pp.test/x/stable")

        versions = publications.detail(pub_id, 1)["versions"]
        latest = versions[0]
        self.assertEqual(latest["status"], "failed")
        self.assertEqual(latest["url"], "https://pp.test/x/stable")
        self.assertEqual(latest["version"], 7)
        version = publications.version_detail(pub_id, int(latest["id"]), 1)
        self.assertIn("<!doctype html>", version["html"])

    async def test_partial_preserves_content_and_url(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="partial-code", url="https://pp.test/x/partial-code", fail_access=True))
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>partial</body></html>",
            title="部分成功页",
            access_password="pw",
            user=user(1, "alice"),
        )
        pub_id = int(result["publication_id"])
        self.assertEqual(result["status"], "partial")

        row = publication_row(pub_id)
        self.assertEqual(row["status"], "partial")
        self.assertEqual(row["url"], "https://pp.test/x/partial-code")
        self.assertIsNotNone(row["version"])

        version_id = publications.detail(pub_id, 1)["versions"][0]["id"]
        version = publications.version_detail(pub_id, int(version_id), 1)
        self.assertIn("<!doctype html>", version["html"])
        self.assertEqual(version["status"], "partial")

    async def test_secrets_not_persisted_in_response_or_audit(self) -> None:
        secret_token = "tok-abc-123"
        secret_password = "sekret-pw-456"
        enable_pagepilot(token=secret_token)
        FakeHttp2.reset(deploy_handler(code="safe", url="https://pp.test/x/safe"))

        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>safe</body></html>",
            title="安全页",
            access_password=secret_password,
            user=user(1, "alice"),
        )
        pub_id = int(result["publication_id"])

        with temp_connect() as conn:
            raw_response = conn.execute(
                "SELECT response FROM publication_versions WHERE publication_id = ?",
                (pub_id,),
            ).fetchone()["response"]
        self.assertNotIn(secret_password, raw_response)
        self.assertNotIn(secret_token, raw_response)

        for audit in audit_rows():
            self.assertNotIn(secret_password, audit["detail"])
            self.assertNotIn(secret_token, audit["detail"])

        self.assertNotIn("access_password", result)
        self.assertNotIn("token", result)
        for version in publications.detail(pub_id, 1)["versions"]:
            self.assertNotIn(secret_password, json.dumps(version, ensure_ascii=False))
            self.assertNotIn(secret_token, json.dumps(version, ensure_ascii=False))

    async def test_local_reads_do_not_touch_remote(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="local", url="https://pp.test/x/local"))

        publications.list_publications(1)
        specs = pagepilot.local_read_specs()
        self.assertEqual([spec.name for spec in specs], [
            "list_published_pages",
            "get_published_page",
        ])
        pagepilot.status_for_user()
        pagepilot.spec_if_available()
        pagepilot.public_config()

        self.assertEqual(FakeHttp2.calls, [])

    async def test_publish_success_and_session_validation(self) -> None:
        enable_pagepilot()
        FakeHttp2.reset(deploy_handler(code="ok", url="https://pp.test/x/ok", version=1))

        pagepilot.sessions.get_session = lambda session_id, uid: None
        with self.assertRaises(pagepilot.PagePilotError) as ctx:
            await pagepilot.publish_html(
                html="<!doctype html><html><body>s</body></html>",
                session_id="missing",
                user=user(1, "alice"),
            )
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(FakeHttp2.calls, [])

        pagepilot.sessions.get_session = lambda session_id, uid: {
            "id": session_id,
            "user_id": uid,
            "title": "会话",
        }
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>new</body></html>",
            title="新建页",
            session_id="sess-ok",
            access_password="pw",
            visibility="public",
            user=user(1, "alice"),
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["code"], "ok")
        self.assertEqual(result["url"], "https://pp.test/x/ok")
        self.assertEqual(publication_row(int(result["publication_id"]))["publish_count"], 1)
        methods = [call["method"] for call in FakeHttp2.calls]
        self.assertIn("POST", methods)
        self.assertIn("PATCH", methods)

        pub_id = int(result["publication_id"])
        FakeHttp2.reset(deploy_handler(code="ok", url="https://pp.test/x/ok", version=2))
        updated = await pagepilot.publish_html(
            html="<!doctype html><html><body>update</body></html>",
            title="更新页",
            publication_id=pub_id,
            user=user(1, "alice"),
        )
        self.assertTrue(updated["updated"])
        self.assertEqual(updated["version"], 2)
        self.assertEqual(publication_row(pub_id)["publish_count"], 2)
        update_call = FakeHttp2.calls[0]
        self.assertEqual(update_call["method"], "POST")
        self.assertEqual(path_of(str(update_call["url"])), "/api/deploy")
        self.assertEqual(update_call["json"]["customCode"], "ok")
        self.assertTrue(update_call["json"]["enableCustomCode"])
        self.assertTrue(update_call["json"]["createVersion"])
        self.assertNotIn("code", update_call["json"])


    async def test_settings_fallback_only_to_documented_post_aliases(self) -> None:
        enable_pagepilot()
        deploy = deploy_handler(code="compat", url="https://pp.test/x/compat")

        async def handler(method: str, url: str, body: object, headers: object) -> FakeResponse:
            if method == "PATCH":
                return FakeResponse(404, {"detail": "method not routed"})
            if path_of(url) in {"/api/deploys/compat/access/set", "/api/deploys/compat/visibility"}:
                return FakeResponse(200, {"success": True})
            return await deploy(method, url, body, headers)

        FakeHttp2.reset(handler)
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>compat</body></html>",
            access_password="", visibility="unlisted", user=user(1, "alice"),
        )
        self.assertTrue(result["ok"])
        post_paths = [path_of(call["url"]) for call in FakeHttp2.calls if call["method"] == "POST"]
        self.assertEqual(post_paths, ["/api/deploy", "/api/deploys/compat/access/set", "/api/deploys/compat/visibility"])

    async def test_no_settings_fallback_on_server_error(self) -> None:
        enable_pagepilot()
        deploy = deploy_handler(code="no-retry")

        async def handler(method: str, url: str, body: object, headers: object) -> FakeResponse:
            if path_of(url).endswith("/access"):
                return FakeResponse(500, {"detail": "settings unavailable"})
            return await deploy(method, url, body, headers)

        FakeHttp2.reset(handler)
        result = await pagepilot.publish_html(
            html="<!doctype html><html><body>saved</body></html>",
            access_password="", user=user(1, "alice"),
        )
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len([call for call in FakeHttp2.calls if call["method"] == "POST"]), 1)

    async def test_update_rejects_mismatched_remote_code(self) -> None:
        enable_pagepilot()
        html = "<!doctype html><html><body>original</body></html>"
        FakeHttp2.reset(deploy_handler(code="original"))
        result = await pagepilot.publish_html(html=html, user=user(1, "alice"))
        publication_id = result["publication_id"]
        FakeHttp2.reset(deploy_handler(code="other"))
        with self.assertRaises(pagepilot.PagePilotError):
            await pagepilot.publish_html(
                html="<!doctype html><html><body>do not replace</body></html>",
                publication_id=publication_id, user=user(1, "alice"),
            )
        self.assertEqual(len(FakeHttp2.calls), 1)
        detail = publications.detail(publication_id, 1)
        self.assertEqual(detail["code"], "original")
        self.assertEqual(detail["html"], html)

    def test_recovery_keeps_interrupted_new_content(self) -> None:
        html = "<!doctype html><html><body>interrupted</body></html>"
        publication_id, version_id = publications.begin_publish(
            user=user(1, "alice"), remote_base_url="https://pp.test",
            session_id=None, publication_id=None, title="中断内容", description="",
            html=html, filename="index.html", visibility="unlisted",
            password_set=False, source="preview",
        )
        publications.finish_publish(
            publication_id, version_id, status="publishing",
            result={"code": "interrupted", "url": "https://pp.test/x/interrupted", "version": 1},
            content_published=True,
        )
        publications.recover_interrupted()
        detail = publications.detail(publication_id, 1)
        self.assertEqual(detail["status"], "failed")
        self.assertEqual(detail["html"], html)
        self.assertEqual(detail["versions"][0]["id"], version_id)
        self.assertEqual(detail["versions"][0]["status"], "failed")
        self.assertEqual(detail["url"], "https://pp.test/x/interrupted")
        self.assertEqual(detail["code"], "interrupted")
        self.assertEqual(detail["publish_count"], 1)

    def test_remote_urls_allow_only_http_without_credentials(self) -> None:
        self.assertEqual(pagepilot._safe_url("javascript:alert(1)", "https://pp.test"), "")
        self.assertEqual(pagepilot._safe_url("https://name:password@pp.test", "https://pp.test"), "")
        self.assertEqual(pagepilot._safe_url("/s/page", "https://pp.test"), "https://pp.test/s/page")


def main() -> int:
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(
        unittest.defaultTestLoader.loadTestsFromTestCase(PublicationsRegressionTest)
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
