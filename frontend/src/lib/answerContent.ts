import type { ArtifactData, MessagePart } from "../types";

export interface HtmlProgress {
  title: string;
  characters: number;
}

export interface AnswerContent {
  parts: MessagePart[];
  artifacts: ArtifactData[];
  pendingHtml?: HtmlProgress;
}

function htmlTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "").trim() || "HTML 页面";
}

export function extractHtmlArtifacts(content: string, messageId: string, streaming = false): AnswerContent {
  const result: AnswerContent = { parts: [], artifacts: [] };
  const appendMarkdown = (text: string) => {
    if (text.trim()) result.parts.push({ kind: "markdown", content: text });
  };
  const appendHtml = (html: string, pending: boolean, characterCount = html.length, titleSource = html) => {
    const title = htmlTitle(pending ? titleSource.slice(0, 512) : html);
    if (pending) {
      result.pendingHtml = { title, characters: characterCount };
      return;
    }
    const artifact: ArtifactData = { id: `${messageId}-html-${result.artifacts.length}`, title, html };
    result.artifacts.push(artifact);
    result.parts.push({ kind: "artifact", artifact });
  };

  const trimmed = content.trimStart().toLowerCase();
  const rawDocument = /^(?:<!doctype\s+html(?:\s|>|$)|<html(?:\s|>|$))/i.test(trimmed);
  const partialDocument = streaming && trimmed.startsWith("<") && ["<!doctype html", "<html"].some((prefix) => prefix.startsWith(trimmed));
  if (rawDocument || partialDocument) {
    const closing = /<\/html\s*>/i.exec(content);
    const end = closing ? closing.index + closing[0].length : content.length;
    appendHtml(closing || !streaming ? content.slice(0, end) : "", streaming && !closing, end, content.slice(0, Math.min(512, end)));
    appendMarkdown(content.slice(end));
    return result;
  }

  const openings = /(^|\n) {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/g;
  let previous = 0;
  let opening: RegExpExecArray | null;
  while ((opening = openings.exec(content)) !== null) {
    const fenceStart = opening.index + opening[1].length;
    const bodyStart = openings.lastIndex;
    const marker = opening[2];
    const language = opening[3].trim().split(/\s+/)[0].toLowerCase();
    const closings = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[\\t ]*\\r?$`, "gm");
    closings.lastIndex = bodyStart;
    const closing = closings.exec(content);
    const partialLanguage = streaming && bodyStart === content.length && !opening[0].endsWith("\n") && ["html", "htm"].some((value) => value.startsWith(language));
    if (language === "html" || language === "htm" || partialLanguage) {
      appendMarkdown(content.slice(previous, fenceStart));
      const htmlLength = (closing?.index ?? content.length) - bodyStart;
      const html = closing || !streaming ? content.slice(bodyStart, closing?.index ?? content.length) : "";
      appendHtml(html, streaming && !closing, htmlLength, content.slice(bodyStart, Math.min(bodyStart + 512, content.length)));
      previous = closing ? closings.lastIndex : content.length;
    }
    if (!closing) break;
    openings.lastIndex = closings.lastIndex;
  }
  appendMarkdown(content.slice(previous));
  return result;
}
