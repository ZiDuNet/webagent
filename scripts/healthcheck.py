"""Container health probe using only the Python standard library."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    url = os.getenv("WEBAGENT_HEALTH_URL", "http://127.0.0.1:8000/api/health")
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            payload = json.load(response)
        return 0 if payload.get("ok") is True else 1
    except (OSError, ValueError, urllib.error.URLError) as exc:
        print(f"Health probe failed: {type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
