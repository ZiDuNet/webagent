"""Runtime configuration shared by the three demo services."""

from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("WEBAGENT_DATA_DIR", BASE_DIR / "data"))
WEB_DIR = BASE_DIR / "web"

BUSINESS_HOST = os.getenv("WEBAGENT_BUSINESS_HOST", "127.0.0.1")
BUSINESS_PORT = int(os.getenv("WEBAGENT_BUSINESS_PORT", "8000"))
AGENT_HOST = os.getenv("WEBAGENT_AGENT_HOST", "127.0.0.1")
AGENT_PORT = int(os.getenv("WEBAGENT_AGENT_PORT", "8010"))
MCP_HOST = os.getenv("WEBAGENT_MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.getenv("WEBAGENT_MCP_PORT", "8020"))

BUSINESS_URL = os.getenv(
    "WEBAGENT_BUSINESS_URL", f"http://{BUSINESS_HOST}:{BUSINESS_PORT}"
)
AGENT_URL = os.getenv("WEBAGENT_AGENT_URL", f"http://{AGENT_HOST}:{AGENT_PORT}")
MCP_URL = os.getenv("WEBAGENT_MCP_URL", f"http://{MCP_HOST}:{MCP_PORT}/mcp")

BUSINESS_DB_PATH = Path(
    os.getenv("WEBAGENT_BUSINESS_DB", DATA_DIR / "business.db")
)
AGENT_DB_PATH = Path(os.getenv("WEBAGENT_AGENT_DB", DATA_DIR / "agent.db"))

INTERNAL_SECRET = os.getenv(
    "WEBAGENT_INTERNAL_SECRET", "webagent-demo-internal-secret-change-me"
)
SESSION_COOKIE = "wa_session"
SESSION_HOURS = int(os.getenv("WEBAGENT_SESSION_HOURS", "24"))


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

