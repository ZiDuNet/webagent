"""Render model-generated HTML into a PNG snapshot."""

from __future__ import annotations

import asyncio
import os
import re
import shutil


class ArtifactRenderError(RuntimeError):
    pass


_SEMAPHORE = asyncio.Semaphore(2)


def _cap_page_height(html: str) -> str:
    style = (
        "<style>html,body{max-height:5000px!important;"
        "overflow:hidden!important}</style>"
    )
    if re.search(r"<head[^>]*>", html, re.IGNORECASE):
        return re.sub(
            r"(<head[^>]*>)", r"\1" + style, html, count=1, flags=re.IGNORECASE
        )
    if re.search(r"<html[^>]*>", html, re.IGNORECASE):
        return re.sub(
            r"(<html[^>]*>)",
            r"\1<head>" + style + "</head>",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    return style + html


def _chrome_path() -> str | None:
    configured = os.getenv("WEBAGENT_CHROME_PATH", "").strip()
    if configured:
        return configured
    for candidate in (
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ):
        if os.path.exists(candidate):
            return candidate
    return shutil.which("google-chrome") or shutil.which("chromium")


async def render_html_png(html: str) -> bytes:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise ArtifactRenderError(
            "服务端截图组件未安装，请安装 Playwright 并准备 Chromium"
        ) from exc
    executable = _chrome_path()
    try:
        async with _SEMAPHORE:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(
                    executable_path=executable,
                    headless=True,
                    args=["--no-sandbox", "--disable-dev-shm-usage"],
                )
                try:
                    context = await browser.new_context(
                        viewport={"width": 1280, "height": 1000},
                        device_scale_factor=1.5,
                        java_script_enabled=False,
                    )
                    # A report must not be able to call back into internal services
                    # while the server-side browser is rendering it.
                    await context.route("**/*", lambda route: route.abort())
                    page = await context.new_page()
                    capped = _cap_page_height(html)
                    await page.set_content(capped, wait_until="domcontentloaded", timeout=15000)
                    await page.wait_for_timeout(280)
                    png = await page.screenshot(full_page=True, type="png")
                finally:
                    await browser.close()
    except ArtifactRenderError:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller
        raise ArtifactRenderError(f"HTML 截图失败：{exc}") from exc
    if not png:
        raise ArtifactRenderError("HTML 截图返回空内容")
    return png
