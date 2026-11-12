"""Administrator-defined HTTP tools without redeploying the MCP server."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import quote, urlparse

import httpx2

from webagent.agent import db
from webagent.agent.mcp_client import ToolExecution, ToolSpec


NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,63}$")
PATH_PARAM_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
ALLOWED_RISKS = {"read", "write", "delete"}


class DynamicToolError(ValueError):
    pass


def validate_dynamic_tool(values: dict[str, Any]) -> dict[str, Any]:
    name = str(values.get("name", "")).strip()
    if not NAME_RE.fullmatch(name):
        raise DynamicToolError(
            "工具名必须以字母开头，只允许字母、数字、下划线和短横线，长度 2-64"
        )
    method = str(values.get("method", "GET")).upper()
    if method not in ALLOWED_METHODS:
        raise DynamicToolError(f"不支持的 HTTP 方法：{method}")
    risk = str(values.get("risk", "read")).lower()
    if risk not in ALLOWED_RISKS:
        raise DynamicToolError("风险等级只能是 read、write 或 delete")
    url_template = str(values.get("url_template", "")).strip()
    parsed = urlparse(url_template)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise DynamicToolError("URL 模板必须是完整的 http:// 或 https:// 地址")
    if parsed.username or parsed.password or "{" in parsed.netloc or "}" in parsed.netloc:
        raise DynamicToolError("URL 主机必须固定，不能包含凭证或动态变量")
    schema = values.get("input_schema") or {"type": "object", "properties": {}}
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise DynamicToolError("输入 Schema 必须是 JSON Schema object")
    headers = values.get("headers") or {}
    if not isinstance(headers, dict):
        raise DynamicToolError("Header 必须是 JSON 对象")
    for key, value in headers.items():
        if str(key).lower() in {"authorization", "host", "content-length"}:
            raise DynamicToolError(f"Header 不允许覆盖 {key}")
        if any(char in str(key) for char in "\r\n:") or any(
            char in str(value) for char in "\r\n"
        ):
            raise DynamicToolError("Header 不能包含换行或冒号")
    return {
        **values,
        "name": name,
        "method": method,
        "risk": risk,
        "url_template": url_template,
        "headers": {str(key): str(value) for key, value in headers.items()},
        "input_schema": schema,
    }


def spec_from_row(row: dict[str, Any]) -> ToolSpec:
    return ToolSpec(
        name=row["name"],
        description=row.get("description") or row.get("display_name") or row["name"],
        input_schema=row.get("input_schema") or {"type": "object", "properties": {}},
        permission=row.get("permission", ""),
        risk=row.get("risk", "read"),
        category=row.get("category") or "业务连接器",
        annotations={"source": "dynamic", "dynamic_tool_id": row["id"]},
        source="dynamic",
    )


def list_specs(include_disabled: bool = False) -> list[ToolSpec]:
    return [
        spec_from_row(row)
        for row in db.get_dynamic_tools(include_disabled=include_disabled)
    ]


def _replace_path(template: str, arguments: dict[str, Any]) -> tuple[str, set[str]]:
    used: set[str] = set()

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in arguments:
            raise DynamicToolError(f"缺少路径参数：{key}")
        used.add(key)
        value = arguments[key]
        if value is None or isinstance(value, (dict, list)):
            raise DynamicToolError(f"路径参数必须是字符串或数字：{key}")
        text = str(value)
        if text in {".", ".."} or any(character in text for character in "\r\n\x00"):
            raise DynamicToolError(f"路径参数包含非法字符：{key}")
        return quote(text, safe="")

    return PATH_PARAM_RE.sub(repl, template), used


async def call_dynamic_tool(
    token: str, spec: ToolSpec, arguments: dict[str, Any]
) -> ToolExecution:
    row = db.get_dynamic_tool_by_name(spec.name)
    if not row or not row.get("enabled"):
        return ToolExecution(ok=False, text=f"动态工具 {spec.name} 不存在或已停用")
    try:
        validated = validate_dynamic_tool(row)
        url, path_params = _replace_path(validated["url_template"], arguments)
    except DynamicToolError as exc:
        return ToolExecution(ok=False, text=str(exc))
    payload = {
        key: value for key, value in arguments.items() if key not in path_params
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        **{str(key): str(value) for key, value in (row.get("headers") or {}).items()},
    }
    method = str(row.get("method") or "GET").upper()
    request_kwargs: dict[str, Any] = {"headers": headers}
    if method in {"GET", "DELETE"}:
        request_kwargs["params"] = payload
    else:
        request_kwargs["json"] = payload
        headers.setdefault("Content-Type", "application/json")
    try:
        async with httpx2.AsyncClient(timeout=30.0) as client:
            response = await client.request(method, url, **request_kwargs)
    except httpx2.RequestError as exc:
        return ToolExecution(ok=False, text=f"动态工具请求失败：{exc}")
    text = response.text[:12000]
    parsed: Any = text
    try:
        parsed = response.json()
    except ValueError:
        parsed = text
    if response.status_code >= 400:
        detail = ""
        if isinstance(parsed, dict):
            detail = str(parsed.get("detail") or parsed.get("error") or "")
        return ToolExecution(
            ok=False,
            text=f"HTTP {response.status_code} {detail or text[:800]}".strip(),
            data=parsed,
        )
    if isinstance(parsed, (dict, list)):
        text = json.dumps(parsed, ensure_ascii=False)
    return ToolExecution(ok=True, text=text, data=parsed)


async def test_dynamic_tool(
    token: str, spec: ToolSpec, arguments: dict[str, Any] | None = None
) -> dict[str, Any]:
    execution = await call_dynamic_tool(token, spec, arguments or {})
    return {
        "ok": execution.ok,
        "message": execution.text[:2000],
        "data": execution.data,
    }
