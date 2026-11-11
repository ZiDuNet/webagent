#!/usr/bin/env python3
"""Start the three demo services and wait until they are healthy."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
DATA_DIR = BASE_DIR / "data"

SERVICES = [
    ("mcp", "webagent.mcp_server.server:app", 8020, "/health"),
    ("agent", "webagent.agent.app:app", 8010, "/health"),
    ("business", "webagent.business.app:app", 8000, "/api/health"),
]


def health_url(port: int, path: str) -> str:
    return f"http://127.0.0.1:{port}{path}"


def wait_for(name: str, port: int, path: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health_url(port, path), timeout=1.5) as response:
                if response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.35)
    raise RuntimeError(f"{name} 未能在 {timeout:.0f} 秒内启动，请查看 logs/{name}.log")


def tail_log(name: str, lines: int = 30) -> str:
    path = LOG_DIR / f"{name}.log"
    if not path.exists():
        return ""
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(content[-lines:])


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the WebAgent demo")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    parser.add_argument("--timeout", type=float, default=20.0, help="启动等待秒数")
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env.setdefault("WEBAGENT_INTERNAL_SECRET", "webagent-demo-internal-secret-change-me")

    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    log_files = []
    try:
        for name, target, port, _path in SERVICES:
            log_path = LOG_DIR / f"{name}.log"
            log_file = log_path.open("ab")
            log_files.append(log_file)
            command = [
                sys.executable,
                "-m",
                "uvicorn",
                target,
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ]
            print(f"[start] {name:<8} :{port}  -> {target}")
            process = subprocess.Popen(
                command,
                cwd=BASE_DIR,
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            processes.append((name, process))
            wait_for(name, port, _path, args.timeout)

        print("\nWebAgent Demo 已启动")
        print("  控制台： http://127.0.0.1:8000")
        print("  Agent  ： http://127.0.0.1:8010/health")
        print("  MCP    ： http://127.0.0.1:8020/health")
        print("\n演示账号：")
        print("  admin / admin123   全部权限 + 用户管理")
        print("  user1 / user1pass  只读设备")
        print("  user2 / user2pass  查询 + 修改（审批后执行）")
        print("  user3 / user3pass  查询 + 修改 + 删除（审批后执行）")
        print("\n按 Ctrl+C 停止全部服务。\n")

        if args.open:
            webbrowser.open("http://127.0.0.1:8000")

        while True:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    raise RuntimeError(
                        f"{name} 退出（code={code}）。\n\n{tail_log(name)}"
                    )
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在停止服务…")
        return 0
    except Exception as exc:  # noqa: BLE001 - print a useful startup failure
        print(f"\n启动失败：{exc}", file=sys.stderr)
        return 1
    finally:
        for name, process in processes:
            if process.poll() is None:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for name, process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for log_file in log_files:
            log_file.close()


if __name__ == "__main__":
    raise SystemExit(main())

