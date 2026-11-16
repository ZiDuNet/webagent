import createDOMPurify from "dompurify";

const exportPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export function htmlImageDocument(html: string, hostWindow: Parameters<typeof createDOMPurify>[0] = window): string {
  if (typeof html !== "string" || !html.trim() || new TextEncoder().encode(html).length > 3200000) throw new Error("HTML 为空或超过 3.2 MB，无法导出图片。");
  const purifier = createDOMPurify(hostWindow);
  const sanitized = purifier.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "video", "audio", "source", "track", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["srcset", "ping", "action", "formaction", "poster", "background", "is"],
    ALLOWED_URI_REGEXP: /^(?:data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]*|#[\w:-]+)$/i,
    RETURN_TRUSTED_TYPE: false,
  });
  return sanitized.replace(/<head\b[^>]*>/i, (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${exportPolicy}"><meta charset="utf-8"><meta name="viewport" content="width=1200">`);
}

export async function saveHtmlImage(html: string, title: string): Promise<{ bytes: number; width: number; height: number }> {
  const documentHtml = htmlImageDocument(html);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;pointer-events:none";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("客户端导出准备超时，请下载 HTML 后查看。")), 8000);
      frame.onload = () => { window.clearTimeout(timer); resolve(); };
      frame.onerror = () => { window.clearTimeout(timer); reject(new Error("浏览器无法建立图片导出视图。")); };
      frame.srcdoc = documentHtml;
      document.body.appendChild(frame);
    });
    const content = frame.contentDocument?.body;
    if (!content) throw new Error("当前浏览器不支持客户端 HTML 导出，请下载 HTML。");
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const height = Math.max(content.scrollHeight, frame.contentDocument!.documentElement.scrollHeight, 800);
    if (height > 5000) throw new Error("页面过长，客户端图片导出最多支持 5000px 高度，请下载 HTML。");
    const { toBlob } = await import("html-to-image");
    const blob = await toBlob(content, { width: 1200, height, pixelRatio: 1.5, backgroundColor: "#ffffff", skipFonts: true, fetchRequestInit: { signal: AbortSignal.abort() }, imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" });
    if (!blob) throw new Error("浏览器未生成图片。动态脚本、远程图片和字体不包含在静态导出中。");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "report"}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { bytes: blob.size, width: 1800, height: height * 1.5 };
  } catch (failure) {
    throw new Error(failure instanceof Error ? failure.message : "客户端导出失败，请尝试下载 HTML。");
  } finally {
    frame.onload = null;
    frame.onerror = null;
    frame.remove();
  }
}
