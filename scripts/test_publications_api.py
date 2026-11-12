#!/usr/bin/env python3
"""HTTP 层验收：publications API + PagePilot SDK，复用 test_publications 的临时 SQLite 夹具。

本文件只新增、不改后端：
- 复用 scripts/test_publications.py 的临时 DB / FakeHttp2 / deploy_handler 夹具；
- 用 httpx2.ASGITransport 直接驱动 FastAPI app（不跑 lifespan，不触真实 DB）；
- patch runtime.identity_from_token 返回可信身份，请求带 INTERNAL_SECRET；
- 对 SDK PagePilotClient 四个方法做 httpx2 GET/POST 请求格式检查。

运行：.venv/bin/python scripts/test_publications_api.py
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

import httpx2

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SCRIPTS))

from webagent import sdk
from webagent.agent import app as agent_app
from webagent.agent import db as db_module
from webagent.agent import pagepilot
from webagent.agent import runtime
from webagent.config import INTERNAL_SECRET

import test_publications as fixtures


USERS: dict[str, dict[str, object]] = {
    "token-alice": {"id": 1, "username": "alice", "is_admin": False, "permissions": []},
    "token-bob": {"id": 2, "username": "bob", "is_admin": False, "permissions": []},
    "token-admin": {"id": 999, "username": "admin", "is_admin": True, "permissions": []},
}

_ORIGINAL_IDENTITY = runtime.identity_from_token
_ORIGINAL_TOOL_SETTING = db_module.get_tool_setting


def db_backed_tool_setting(name: str, source: str = "mcp") -> dict[str, object]:
    with fixtures.temp_connect() as conn:
        row = conn.execute(
            "SELECT * FROM tool_settings WHERE name = ?", (name,)
        ).fetchone()
    if row is None:
        return db_module.default_tool_setting(name, source)
    item = dict(row)
    for key in ("enabled", "visible", "selectable", "default_selected"):
        item[key] = bool(item.get(key, 1))
    item["definition"] = json.loads(item.get("definition") or "{}")
    return item


async def fake_identity(token: str) -> dict[str, object]:
    user = USERS.get(token)
    if user is None:
        raise runtime.AgentError("登录已失效，请重新登录", 401)
    return user


def setUpModule() -> None:
    fixtures.setUpModule()
    db_module.get_tool_setting = db_backed_tool_setting
    runtime.identity_from_token = fake_identity


def tearDownModule() -> None:
    runtime.identity_from_token = _ORIGINAL_IDENTITY
    db_module.get_tool_setting = _ORIGINAL_TOOL_SETTING
    fixtures.tearDownModule()


def bearer(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Internal-Token": INTERNAL_SECRET,
    }


def html_body(text: str = "hello") -> str:
    return f"<!doctype html><html><body>{text}</body></html>"


class FakeSDKResponse:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class PagePilotHttpApiTest(unittest.IsolatedAsyncioTestCase):
    async def test_agent_must_explicitly_choose_password_and_visibility(self) -> None:
        context = runtime.AgentContext(
            token="token-alice", user={"id": 1, "username": "alice"}, model={},
            provider={}, config={}, skills=[], all_tools=[], tools=[],
            global_tool_settings={}, requested_tools=None,
        )
        spec = pagepilot.spec_if_available()
        execution, run = await runtime._execute(
            context, spec, {"id": "missing-publication-choices", "arguments": {"html": html_body()}}, [],
        )
        self.assertFalse(execution.ok)
        self.assertIn("不得自动生成密码", execution.text)
        self.assertEqual(run["status"], "error")
        self.assertEqual(fixtures.FakeHttp2.calls, [])

    async def asyncSetUp(self) -> None:
        with fixtures.temp_connect() as conn:
            conn.executescript(
                """
                DELETE FROM audit_log;
                DELETE FROM publication_versions;
                DELETE FROM publications;
                DELETE FROM settings;
                DELETE FROM sessions;
                DELETE FROM tool_settings;
                """
            )
        fixtures.enable_pagepilot()
        fixtures.FakeHttp2.reset(fixtures.deploy_handler())
        pagepilot.sessions.get_session = lambda session_id, uid: {
            "id": session_id,
            "user_id": uid,
            "title": "会话",
        }
        self.transport = httpx2.ASGITransport(app=agent_app.app)
        self.client = httpx2.AsyncClient(
            transport=self.transport, base_url="http://test"
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    async def _publish(
        self,
        token: str,
        *,
        code: str = "",
        publication_id: int | None = None,
        session_id: str | None = None,
        **extra: object,
    ) -> httpx2.Response:
        return await self.client.post(
            "/api/pagepilot/publish",
            headers=bearer(token),
            json={
                "html": html_body(),
                "title": "页面",
                "code": code,
                "publication_id": publication_id,
                "session_id": session_id,
                **extra,
            },
        )

    async def test_list_isolation_including_admin(self) -> None:
        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="alice-code", url="https://pp.test/x/alice-code"))
        r1 = await self._publish("token-alice", title="alice页面")
        self.assertEqual(r1.status_code, 200)

        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="bob-code", url="https://pp.test/x/bob-code"))
        r2 = await self._publish("token-bob", title="bob页面")
        self.assertEqual(r2.status_code, 200)
        bob_pub_id = r2.json()["publication_id"]

        listed = await self.client.get(
            "/api/pagepilot/publications", headers=bearer("token-alice")
        )
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(
            all(item["user_id"] == 1 for item in listed.json()["items"])
        )
        self.assertEqual(listed.json()["total"], 1)

        admin_list = await self.client.get(
            "/api/pagepilot/publications", headers=bearer("token-admin")
        )
        self.assertEqual(admin_list.status_code, 200)
        self.assertEqual(admin_list.json()["total"], 0)

        cross = await self.client.get(
            f"/api/pagepilot/publications/{bob_pub_id}", headers=bearer("token-alice")
        )
        self.assertEqual(cross.status_code, 404)

        admin_cross = await self.client.get(
            f"/api/pagepilot/publications/{bob_pub_id}", headers=bearer("token-admin")
        )
        self.assertEqual(admin_cross.status_code, 404)

    async def test_payload_spoofed_user_id_is_ignored(self) -> None:
        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="spoof", url="https://pp.test/x/spoof"))
        r = await self._publish("token-alice", user_id=2)
        self.assertEqual(r.status_code, 200)
        pub_id = r.json()["publication_id"]

        detail = await self.client.get(
            f"/api/pagepilot/publications/{pub_id}", headers=bearer("token-alice")
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["publication"]["user_id"], 1)

        bob_list = await self.client.get(
            "/api/pagepilot/publications", headers=bearer("token-bob")
        )
        self.assertEqual(bob_list.json()["total"], 0)

    async def test_session_validation(self) -> None:
        fixtures.FakeHttp2.reset(fixtures.deploy_handler())

        pagepilot.sessions.get_session = lambda session_id, uid: None
        missing = await self._publish("token-alice", session_id="missing")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(fixtures.FakeHttp2.calls, [])

        pagepilot.sessions.get_session = lambda session_id, uid: {
            "id": session_id,
            "user_id": uid,
            "title": "会话",
        }
        ok = await self._publish("token-alice", session_id="sess-ok")
        self.assertEqual(ok.status_code, 200)
        self.assertNotEqual(fixtures.FakeHttp2.calls, [])

    async def test_unknown_code_rejected_without_remote(self) -> None:
        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="owned", url="https://pp.test/x/owned"))
        first = await self._publish("token-alice")
        self.assertEqual(first.status_code, 200)

        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="owned", url="https://pp.test/x/owned"))
        stolen = await self._publish("token-bob", code="owned")
        self.assertEqual(stolen.status_code, 404)
        self.assertEqual(fixtures.FakeHttp2.calls, [])

    async def test_disabled_reads_history_but_cannot_publish(self) -> None:
        fixtures.FakeHttp2.reset(fixtures.deploy_handler(code="h", url="https://pp.test/x/h"))
        created = await self._publish("token-alice")
        self.assertEqual(created.status_code, 200)

        with fixtures.temp_connect() as conn:
            conn.execute(
                "INSERT INTO tool_settings (name, enabled, visible, selectable, default_selected, source, definition, updated_at) "
                "VALUES ('publish_to_pagepilot', 0, 1, 1, 1, 'pagepilot', '{}', '2026-01-01T00:00:00')"
            )

        listed = await self.client.get(
            "/api/pagepilot/publications", headers=bearer("token-alice")
        )
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 1)

        blocked = await self._publish("token-alice")
        self.assertEqual(blocked.status_code, 403)

    async def test_partial_http_200_preserves_url_and_status(self) -> None:
        fixtures.FakeHttp2.reset(
            fixtures.deploy_handler(
                code="partial-code",
                url="https://pp.test/x/partial-code",
                fail_access=True,
            )
        )
        r = await self._publish("token-alice", access_password="pw")
        self.assertEqual(r.status_code, 200)
        payload = r.json()
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["url"], "https://pp.test/x/partial-code")

        detail = await self.client.get(
            f"/api/pagepilot/publications/{payload['publication_id']}",
            headers=bearer("token-alice"),
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["publication"]["status"], "partial")
        self.assertEqual(detail.json()["publication"]["url"], "https://pp.test/x/partial-code")


class PagePilotClientSdkTest(unittest.TestCase):
    def test_sdk_request_shapes(self) -> None:
        client = sdk.PagePilotClient(agent_url="http://agent", internal_secret="sec")

        with mock.patch.object(
            sdk.httpx2, "get", return_value=FakeSDKResponse({"items": []})
        ) as get_mock, mock.patch.object(
            sdk.httpx2, "post", return_value=FakeSDKResponse({"ok": True})
        ) as post_mock:
            client.list_publications(
                "tok", q="x", session_id="s", limit=10, offset=2
            )
            get_mock.assert_called_once()
            _, kwargs = get_mock.call_args
            self.assertEqual(kwargs["params"], {"q": "x", "limit": 10, "offset": 2, "session_id": "s"})
            self.assertEqual(
                kwargs["headers"],
                {"Authorization": "Bearer tok", "X-Internal-Token": "sec"},
            )
            self.assertEqual(kwargs["timeout"], 30)

        with mock.patch.object(
            sdk.httpx2, "get", return_value=FakeSDKResponse({"publication": {"id": 5}})
        ) as get_mock:
            client.get_publication("tok", 5)
            get_mock.assert_called_once()
            url = get_mock.call_args[0][0]
            self.assertEqual(url, "http://agent/api/pagepilot/publications/5")

        with mock.patch.object(
            sdk.httpx2, "get", return_value=FakeSDKResponse({"version": {"id": 7}})
        ) as get_mock:
            client.get_version("tok", 5, 7)
            url = get_mock.call_args[0][0]
            self.assertEqual(url, "http://agent/api/pagepilot/publications/5/versions/7")

        with mock.patch.object(
            sdk.httpx2, "post", return_value=FakeSDKResponse({"ok": True})
        ) as post_mock:
            client.publish_html(
                "tok",
                html=html_body(),
                access_password="pw",
                visibility="public",
                title="t",
                description="d",
                publication_id=9,
                session_id="sess",
            )
            post_mock.assert_called_once()
            url = post_mock.call_args[0][0]
            self.assertEqual(url, "http://agent/api/pagepilot/publish")
            body = post_mock.call_args[1]["json"]
            self.assertEqual(
                body,
                {
                    "html": html_body(),
                    "title": "t",
                    "description": "d",
                    "access_password": "pw",
                    "visibility": "public",
                    "publication_id": 9,
                    "session_id": "sess",
                },
            )
            self.assertEqual(post_mock.call_args[1]["timeout"], 300)


def main() -> int:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(PagePilotHttpApiTest))
    suite.addTests(loader.loadTestsFromTestCase(PagePilotClientSdkTest))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
