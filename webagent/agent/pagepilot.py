"""PagePilot publishing connector.

PagePilot ships a local stdio MCP server.  This framework intentionally keeps
its tool layer remote, so PagePilot is exposed through the official REST
deploy API instead of pretending the stdio server is a streamable HTTP MCP.
The bearer token is encrypted at rest and never leaves the Agent service.
"""

from __future__ import annotations

import asyncio
import html as html_lib
import re
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx2

from webagent.agent import db, publications, sessions
from webagent.agent.crypto import decrypt_secret, encrypt_secret
from webagent.agent.mcp_client import ToolSpec


DEFAULT_BASE_URL = "https://pagepilot.dell.4dbim.cc:1143"
TOOL_NAME = "publish_to_pagepilot"
LIST_TOOL_NAME = "list_published_pages"
GET_TOOL_NAME = "get_published_page"
MAX_HTML_BYTES = 3 * 1024 * 1024
TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
H1_RE = re.compile(r"<h1[^>]*>([\s\S]*?)</h1>", re.IGNORECASE)


class PagePilotError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502, remote_status: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.remote_status = remote_status


def _clean_base_url(value: str) -> str:
    text = str(value or "").strip().rstrip("/")
    parsed = urlparse(text)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise PagePilotError("PagePilot 地址必须是完整的 http:// 或 https:// URL")
    return text


def _config() -> dict[str, Any]:
    settings = db.get_settings()
    token = decrypt_secret(settings.get("pagepilot_token", ""))
    return {
        "base_url": settings.get("pagepilot_base_url") or DEFAULT_BASE_URL,
        "token": token,
        "enabled": settings.get("pagepilot_enabled", "0") == "1",
        "default_title": settings.get("pagepilot_default_title", ""),
        "default_description": settings.get("pagepilot_default_description", ""),
        "default_visibility": settings.get("pagepilot_default_visibility", "unlisted"),
    }


def public_config() -> dict[str, Any]:
    config = _config()
    token = config["token"]
    return {
        "base_url": config["base_url"],
        "enabled": config["enabled"],
        "configured": bool(token),
        "token_set": bool(token),
        "token_masked": f"••••{token[-4:]}" if token else "",
        "default_title": config["default_title"],
        "default_description": config["default_description"],
        "default_visibility": config["default_visibility"],
        "transport": "rest",
        "api": "POST /api/deploy",
    }


def save_config(
    *,
    base_url: str,
    token: str | None = None,
    clear_token: bool = False,
    enabled: bool | None = None,
    default_title: str | None = None,
    default_description: str | None = None,
    default_visibility: str | None = None,
) -> dict[str, Any]:
    values = {"pagepilot_base_url": _clean_base_url(base_url)}
    if clear_token:
        values["pagepilot_token"] = ""
    elif token is not None and token.strip():
        values["pagepilot_token"] = encrypt_secret(token.strip())
    if enabled is not None:
        values["pagepilot_enabled"] = "1" if enabled else "0"
    if default_title is not None:
        values["pagepilot_default_title"] = default_title.strip()[:120]
    if default_description is not None:
        values["pagepilot_default_description"] = default_description.strip()[:240]
    if default_visibility is not None:
        values["pagepilot_default_visibility"] = (
            default_visibility
            if default_visibility in {"public", "unlisted"}
            else "unlisted"
        )
    db.set_settings(values)
    return public_config()


def status_for_user() -> dict[str, Any]:
    public = public_config()
    setting = db.get_tool_setting(TOOL_NAME, source="pagepilot")
    public["publish_allowed"] = bool(
        public["enabled"] and public["configured"] and setting.get("enabled", True)
    )
    return public


def spec_if_available() -> ToolSpec | None:
    public = public_config()
    if not public["enabled"] or not public["configured"]:
        return None
    return ToolSpec(
        name=TOOL_NAME,
        description=(
            "把一段完整的 HTML 页面发布到 PagePilot，返回可访问 URL。"
            "适合发布运维报告、数据看板、可交互网页。"
            "发布到外部服务前必须得到用户确认。"
            "发布前应询问用户是否设置访问密码；不设置则任何人拿到链接都能访问。"
            "传 code 表示更新已有页面。"
            "只能更新当前用户在本系统发布的页面，可先用 list_published_pages 查找 publication_id。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "站点标题"},
                "description": {"type": "string", "description": "本次发布说明"},
                "html": {
                    "type": "string",
                    "description": "完整 HTML 文档，包含 doctype/html/head/body",
                },
                "filename": {
                    "type": "string",
                    "description": "可选入口文件名，默认 index.html",
                },
                "code": {
                    "type": "string",
                    "description": "可选：要更新的已有 PagePilot 页面 code 或 URL；留空则新建页面",
                },
                "publication_id": {
                    "type": "integer",
                    "description": "可选：当前用户本地已发布记录的 ID；更新时优先使用此 ID",
                },
                "access_password": {
                    "type": "string",
                    "description": "可选访问密码；留空表示公开访问。发布前应询问用户是否设置。",
                },
                "visibility": {
                    "type": "string",
                    "enum": ["public", "unlisted"],
                    "description": "本次由用户选择的可见范围；public 为创作广场可见，unlisted 为仅链接可见",
                },
            },
            "required": ["html", "access_password", "visibility"],
        },
        permission="",
        risk="write",
        category="发布",
        annotations={"source": "pagepilot", "read_only_hint": False},
        source="pagepilot",
    )


def spec_if_enabled() -> ToolSpec | None:
    spec = spec_if_available()
    if spec is None:
        return None
    setting = db.get_tool_setting(TOOL_NAME, source="pagepilot")
    return spec if setting.get("enabled", True) else None


def local_read_specs() -> list[ToolSpec]:
    return [
        ToolSpec(
            name=LIST_TOOL_NAME,
            description="查询当前登录用户在本系统发布到 PagePilot 的页面、URL 和状态。仅查本地记录，不读取共享 Token 下其他用户的站点。",
            input_schema={
                "type": "object",
                "properties": {
                    "q": {"type": "string", "description": "可选标题或说明关键字"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                    "offset": {"type": "integer", "minimum": 0},
                },
            },
            permission="",
            risk="read",
            category="发布",
            annotations={"source": "pagepilot", "read_only_hint": True},
            source="pagepilot",
        ),
        ToolSpec(
            name=GET_TOOL_NAME,
            description="读取当前用户已发布页面的标题、链接、状态与版本历史。不会访问其他用户的页面。",
            input_schema={
                "type": "object",
                "properties": {"publication_id": {"type": "integer"}},
                "required": ["publication_id"],
            },
            permission="",
            risk="read",
            category="发布",
            annotations={"source": "pagepilot", "read_only_hint": True},
            source="pagepilot",
        ),
    ]


def _validate_html(value: str, title: str) -> tuple[str, str]:
    html = str(value or "").strip()
    if len(html) < 20:
        raise PagePilotError("HTML 内容为空或过短")
    size = len(html.encode("utf-8"))
    if size > MAX_HTML_BYTES:
        raise PagePilotError(
            f"HTML 超过 PagePilot 单文件上限（{size / 1024 / 1024:.1f} MB / 3 MB）"
        )
    lowered = html.lower()
    if "<html" not in lowered and "<!doctype" not in lowered:
        raise PagePilotError("请提交完整 HTML 文档（包含 <!doctype> 或 <html>）")
    final_title = str(title or "").strip()
    if not final_title:
        match = TITLE_RE.search(html) or H1_RE.search(html)
        final_title = html_lib.unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip() if match else ""
    return html, (final_title or "WebAgent 页面")[:120]


def _error_detail(data: Any, response: httpx2.Response) -> str:
    if isinstance(data, dict):
        detail = data.get("detail") or data.get("error") or data.get("message")
        if detail:
            stage = data.get("stage")
            request_id = data.get("requestId")
            suffix = " · ".join(
                part for part in (f"stage={stage}" if stage else "", request_id or "") if part
            )
            return f"{detail}{'（' + suffix + '）' if suffix else ''}"
    return f"HTTP {response.status_code}"


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _final_title(title: str, default_title: str) -> str:
    user_title = str(title or "").strip()
    fallback = str(default_title or "").strip()
    date = _today()
    if user_title and fallback:
        if "{title}" in fallback:
            return fallback.replace("{title}", user_title).replace("{date}", date)[:120]
        if user_title.endswith(f"（{fallback}）"):
            return user_title[:120]
        return f"{user_title}（{fallback}）"[:120]
    if user_title:
        return user_title[:120]
    base = fallback or "WebAgent 页面"
    if "{date}" in base:
        return base.replace("{date}", date)[:120]
    return f"{base} · {date}"[:120]


def _final_description(description: str, default_description: str, username: str) -> str:
    user_description = str(description or "").strip()
    fallback = str(default_description or "").strip()
    date = _today()
    if user_description:
        text = user_description
    elif fallback:
        text = fallback
    else:
        text = f"由 WebAgent 为 {username or '用户'} 于 {date} 发布"
    return (
        text.replace("{date}", date)
        .replace("{user}", username or "用户")
        .strip()[:240]
    )


def _normalize_code(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith(("http://", "https://")):
        parsed = urlparse(text)
        parts = [part for part in parsed.path.split("/") if part]
        text = parts[-1] if parts else ""
    if text and not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", text):
        raise PagePilotError("页面 code 格式不正确，请从“已发布”选择页面", 422)
    return text


def _safe_url(value: Any, base_url: str) -> str:
    if not value:
        return ""
    candidate = urljoin(f"{base_url}/", str(value))
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return ""
    return candidate


async def test_connection() -> dict[str, Any]:
    config = _config()
    if not config["token"]:
        return {"ok": False, "message": "尚未配置 PagePilot Token"}
    try:
        async with httpx2.AsyncClient(timeout=20.0) as client:
            health = await client.get(f"{config['base_url']}/api/health")
            tokens = await client.get(
                f"{config['base_url']}/api/tokens",
                headers={"Authorization": f"Bearer {config['token']}"},
            )
    except httpx2.RequestError as exc:
        return {"ok": False, "message": f"无法连接 PagePilot：{exc}"}
    if tokens.status_code in {401, 403}:
        try:
            data = tokens.json()
        except ValueError:
            data = {}
        return {"ok": False, "message": _error_detail(data, tokens) or "Token 无效"}
    if health.status_code >= 400 or tokens.status_code >= 400:
        return {
            "ok": False,
            "message": f"PagePilot 返回异常：health={health.status_code}, auth={tokens.status_code}",
        }
    return {"ok": True, "message": "PagePilot 连接正常，Token 有效"}


async def publish_html(
    *,
    html: str,
    title: str = "",
    description: str = "",
    filename: str = "",
    code: str = "",
    access_password: str | None = None,
    visibility: str | None = None,
    user: dict[str, Any],
    session_id: str | None = None,
    publication_id: int | None = None,
    source: str = "tool",
) -> dict[str, Any]:
    config = _config()
    if not config["enabled"]:
        raise PagePilotError("PagePilot 发布连接器已被管理员停用")
    if not config["token"]:
        raise PagePilotError("PagePilot Token 尚未配置，请管理员先在 AI 配置中完成接入")
    if session_id and sessions.get_session(session_id, user["id"]) is None:
        raise PagePilotError("来源会话不存在或不属于当前账号", 404)
    target_code = _normalize_code(code)
    previous: dict[str, Any] | None = None
    try:
        if publication_id:
            previous = publications.owned_publication(publication_id, user["id"])
            if previous["remote_base_url"] != config["base_url"]:
                raise PagePilotError("该页面属于之前的 PagePilot 服务，请恢复对应连接器地址后再更新", 409)
            if target_code and target_code != previous["code"]:
                raise PagePilotError("页面 code 与所选发布记录不一致", 422)
            target_code = str(previous["code"] or "")
            if not target_code:
                raise PagePilotError("该记录尚未成功发布，请重新新建页面", 409)
        elif target_code:
            previous = publications.owned_code(target_code, config["base_url"], user["id"])
            publication_id = int(previous["id"])
    except publications.PublicationError as exc:
        raise PagePilotError(str(exc), exc.status_code) from exc
    clean_html, _ = _validate_html(html, "")
    final_title = _final_title(title, config["default_title"])
    final_description = _final_description(
        description, config["default_description"], user["username"]
    )
    target_visibility = visibility if visibility in {"public", "unlisted"} else config["default_visibility"]
    password_set = bool(access_password) if access_password is not None else bool(previous and previous["password_set"])
    payload = {
        "content": clean_html,
        "title": final_title,
        "description": final_description,
        "filename": str(filename or "index.html").strip()[:160] or "index.html",
        "visibility": target_visibility,
    }
    if target_code:
        payload.update(customCode=target_code, enableCustomCode=True, createVersion=True)
    elif access_password not in {None, ""}:
        payload["accessPassword"] = str(access_password)[:200]
    try:
        publication_id, version_id = publications.begin_publish(
            user=user, remote_base_url=config["base_url"], session_id=session_id,
            publication_id=publication_id, title=final_title, description=final_description,
            html=clean_html, filename=payload["filename"], visibility=target_visibility,
            password_set=password_set, source=source,
        )
    except publications.PublicationError as exc:
        raise PagePilotError(str(exc), exc.status_code) from exc
    result = {
        "ok": False,
        "publication_id": publication_id,
        "title": final_title,
        "description": final_description,
        "url": previous.get("url", "") if previous else "",
        "detail_url": previous.get("detail_url", "") if previous else "",
        "code": target_code,
        "version": previous.get("version") if previous else None,
        "updated": bool(target_code),
        "visibility": target_visibility,
        "password_set": password_set,
        "size": len(clean_html.encode("utf-8")),
        "source": source,
    }
    content_published = False
    warnings: list[str] = []

    async def send(client: httpx2.AsyncClient, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = await client.request(method, f"{config['base_url']}{path}", json=body)
        try:
            data = response.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict) or response.status_code >= 400 or data.get("success") is False:
            raise PagePilotError(_error_detail(data, response), remote_status=response.status_code)
        return data

    async def set_metadata(client: httpx2.AsyncClient, path: str, body: dict[str, Any], fallback_path: str) -> None:
        try:
            await send(client, "PATCH", path, body)
        except PagePilotError as exc:
            if exc.remote_status not in {404, 405}:
                raise
            await send(client, "POST", fallback_path, body)

    def safe_error(exc: Exception) -> str:
        text = str(exc)
        for secret in (config["token"], access_password):
            if secret:
                text = text.replace(secret, "[已隐藏]")
        return text[:1000]

    try:
        async with httpx2.AsyncClient(
            timeout=90.0,
            headers={"Authorization": f"Bearer {config['token']}", "Accept": "application/json"},
        ) as client:
            data = await send(client, "POST", "/api/deploy", payload)
            remote_code = _normalize_code(str(data.get("code") or target_code or ""))
            if target_code and remote_code != target_code:
                raise PagePilotError("PagePilot 返回的 code 与更新目标不一致，已停止后续操作，请核对远端状态")
            content_published = True
            result.update({
                "code": remote_code,
                "url": _safe_url(data.get("url") or data.get("pathUrl") or result["url"], config["base_url"]),
                "detail_url": _safe_url(data.get("detailUrl") or result["detail_url"], config["base_url"]),
                "version_url": _safe_url(data.get("versionUrl"), config["base_url"]),
                "version": data.get("versionNumber"),
            })
            publications.finish_publish(
                publication_id, version_id, status="publishing", result=result,
                content_published=True,
            )
            if not result["code"]:
                warnings.append("PagePilot 未返回页面 code，无法核对访问设置")
            else:
                if access_password is not None:
                    try:
                        await set_metadata(client, f"/api/deploys/{result['code']}/access", {"password": str(access_password or "")[:200]}, f"/api/deploys/{result['code']}/access/set")
                    except (httpx2.RequestError, PagePilotError) as exc:
                        warnings.append(f"访问密码未设置成功：{safe_error(exc)}")
                        result["password_set"] = bool(previous and previous["password_set"]) if target_code else bool(access_password)
                try:
                    await set_metadata(client, f"/api/deploys/{result['code']}/visibility", {"visibility": target_visibility}, f"/api/deploys/{result['code']}/visibility")
                except (httpx2.RequestError, PagePilotError) as exc:
                    warnings.append(f"可见范围未设置成功：{safe_error(exc)}")
            result["ok"] = not warnings
            result["status"] = "partial" if warnings else "published"
            if warnings:
                result["warning"] = "内容已发布；" + "；".join(warnings)
    except asyncio.CancelledError:
        publications.finish_publish(publication_id, version_id, status="partial" if content_published else "failed", result=result, error="服务中断，请核对远端发布状态后再重试", content_published=content_published)
        raise
    except (httpx2.RequestError, PagePilotError) as exc:
        message = safe_error(exc)
        if content_published:
            result.update(status="partial", warning=f"内容已发布；{message}")
            publications.finish_publish(publication_id, version_id, status="partial", result=result, error=result["warning"], content_published=True)
            return result
        publications.finish_publish(publication_id, version_id, status="failed", result=result, error=message, content_published=False)
        raise PagePilotError(f"PagePilot 发布失败：{message}；可在“已发布”查看失败记录") from exc
    except Exception as exc:
        message = safe_error(exc)
        publications.finish_publish(
            publication_id, version_id, status="partial" if content_published else "failed",
            result=result, error=f"发布流程异常：{message}", content_published=content_published,
        )
        raise PagePilotError("发布流程异常，请在“已发布”核对记录后重试") from exc
    publications.finish_publish(
        publication_id, version_id, status=result["status"], result=result,
        error=str(result.get("warning") or ""), content_published=True,
    )
    db.log_audit(
        username=user["username"],
        action="pagepilot.publish",
        resource=f"pagepilot:{result['code'] or final_title}",
        detail={
            "title": final_title,
            "code": result["code"],
            "url": result["url"],
            "size": result["size"],
            "updated": result["updated"],
            "visibility": target_visibility,
            "password_set": result["password_set"],
            "source": source,
            "publication_id": publication_id,
            "status": result["status"],
        },
    )
    return result
