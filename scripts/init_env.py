#!/usr/bin/env python3
"""Create private Compose configuration without overwriting existing secrets."""

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path
import secrets


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 Docker Compose 本地配置")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-demo-users", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1–65535 之间")
    try:
        host = ipaddress.IPv4Address(args.host)
    except ipaddress.AddressValueError:
        parser.error("监听地址必须是 IPv4 地址")
    path = Path(__file__).resolve().parents[1] / ".env"
    values = {
        "WEBAGENT_BIND_HOST": str(host),
        "WEBAGENT_HTTP_PORT": str(args.port),
        "WEBAGENT_INTERNAL_SECRET": secrets.token_urlsafe(48),
        "WEBAGENT_SECRET_KEY": secrets.token_urlsafe(48),
        "WEBAGENT_ADMIN_PASSWORD": secrets.token_urlsafe(18),
        "WEBAGENT_SEED_DEMO_USERS": "0" if args.no_demo_users else "1",
        "WEBAGENT_COOKIE_SECURE": "0",
    }
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(".env 已存在，保留原配置和密钥。")
        return 0
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
    print("已生成权限为 0600 的 .env；管理员账号为 admin，密码请在该文件中查看。")
    print("请备份 .env，尤其是加密根密钥；此文件不会提交 Git 或进入镜像。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
