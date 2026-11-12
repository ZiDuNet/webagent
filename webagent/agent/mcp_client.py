"""Authenticated MCP client used by the Agent runtime."""

from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, Tool

from webagent.config import INTERNAL_SECRET, MCP_URL


META_RE = re.compile(r"\s*\[META\](.*?)\[/META\]\s*", re.DOTALL)


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    permission: str
    risk: str
    category: str
    annotations: dict[str, Any] = field(default_factory=dict)
    source: str = "mcp"

    def public(self, *, enabled: bool | None = None) -> dict[str, Any]:
        item = {
            "name": self.name,
            "description": self.description,
            "permission": self.permission,
            "risk": self.risk,
            "category": self.category,
            "input_schema": self.input_schema,
            "read_only": bool(self.annotations.get("read_only_hint")),
            "destructive": bool(self.annotations.get("destructive_hint")),
            "source": self.source,
        }
        if enabled is not None:
            item["enabled"] = enabled
        return item


@dataclass
class ToolExecution:
    ok: bool
    text: str
    data: Any = None


def parse_meta(description: str) -> tuple[str, dict[str, str]]:
    match = META_RE.search(description or "")
    meta: dict[str, str] = {}
    if match:
        for part in match.group(1).split(";"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            meta[key.strip()] = value.strip()
        description = META_RE.sub("", description).strip()
    return description, meta


def parse_tool(tool: Tool) -> ToolSpec:
    description, meta = parse_meta(tool.description or "")
    annotations = tool.annotations.model_dump(exclude_none=True) if tool.annotations else {}
    return ToolSpec(
        name=tool.name,
        description=description,
        input_schema=tool.input_schema or {"type": "object", "properties": {}},
        permission=meta.get("permission", ""),
        risk=meta.get("risk", "write"),
        category=meta.get("category", "其他"),
        annotations=annotations,
    )


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Internal-Token": INTERNAL_SECRET,
    }


@asynccontextmanager
async def mcp_session(token: str) -> AsyncIterator[ClientSession]:
    async with httpx2.AsyncClient(headers=_headers(token), timeout=30.0) as client:
        async with streamable_http_client(MCP_URL, http_client=client) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


async def list_tools(token: str) -> list[ToolSpec]:
    async with mcp_session(token) as session:
        result = await session.list_tools()
    return [parse_tool(tool) for tool in result.tools]


def _extract_text(result: CallToolResult) -> str:
    parts: list[str] = []
    for block in result.content:
        if getattr(block, "type", "") == "text":
            parts.append(str(getattr(block, "text", "")))
        else:
            parts.append(json.dumps(block.model_dump(mode="json"), ensure_ascii=False))
    return "\n".join(parts).strip()


async def call_tool(token: str, name: str, arguments: dict[str, Any]) -> ToolExecution:
    async with mcp_session(token) as session:
        result = await session.call_tool(name, arguments)
    if not isinstance(result, CallToolResult):
        return ToolExecution(ok=False, text="MCP 返回了非预期的结果类型")
    text = _extract_text(result)
    parsed: Any = None
    try:
        if text.startswith("{") or text.startswith("["):
            parsed = json.loads(text)
        else:
            parsed = text
    except json.JSONDecodeError:
        parsed = text
    return ToolExecution(ok=not result.is_error, text=text, data=parsed)
