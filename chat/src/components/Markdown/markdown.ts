import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItInstance, Token } from "markdown-it";

function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,
    xhtmlOut: false,
    breaks: false,
    linkify: true,
    typographer: true,
    langPrefix: "language-",
  });

  md.block.ruler.before("paragraph", "math_block", mathBlock, {
    alt: ["paragraph", "reference"],
  });
  md.inline.ruler.after("emphasis", "strikethrough", strikethrough);
  md.inline.ruler.after("strikethrough", "math_inline", mathInline);

  return md;
}

let instance: MarkdownItInstance | null = null;

export function parseTokens(source: string): Token[] {
  if (!instance) instance = createMarkdownIt();
  return instance.parse(source, {});
}

function mathBlock(
  state: any,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (pos + 2 > max) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;

  let closeLine = -1;
  for (let line = startLine + 1; line < endLine; line += 1) {
    const lpos = state.bMarks[line] + state.tShift[line];
    const lmax = state.eMarks[line];
    if (state.src.slice(lpos, lmax).trim() === "$$") {
      closeLine = line;
      break;
    }
  }
  if (closeLine < 0) return false;

  if (silent) return true;

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.map = [startLine, closeLine + 1];
  token.content = state
    .getLines(startLine + 1, closeLine, state.blkIndent, true)
    .trim();
  token.markup = "$$";
  state.line = closeLine + 1;
  return true;
}

function strikethrough(state: any, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x7e) return false;
  if (state.src.charCodeAt(state.pos + 1) !== 0x7e) return false;

  const contentStart = state.pos + 2;
  const end = state.src.indexOf("~~", contentStart);
  if (end < 0) return false;
  const content = state.src.slice(contentStart, end);
  if (!content || content.includes("\n")) return false;

  if (!silent) {
    const open = state.push("s_open", "s", 1);
    open.markup = "~~";
    const text = state.push("text", "", 0);
    text.content = content;
    const close = state.push("s_close", "s", -1);
    close.markup = "~~";
  }
  state.pos = end + 2;
  return true;
}

function mathInline(state: any, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24) return false;
  if (state.src.charCodeAt(state.pos + 1) === 0x24) return false;

  const end = state.src.indexOf("$", state.pos + 1);
  if (end < 0) return false;
  const content = state.src.slice(state.pos + 1, end);
  if (!content || content.includes("\n")) return false;

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

const MERMAID_RE = /^\s{0,3}(`{3,}|~{3,})\s*(mermaid)\s*$/i;

export interface UnclosedFence {
  language: string;
  code: string;
}

/**
 * 检测流式输出中尚未闭合的代码围栏（当前仅 mermaid 需要占位渲染）。
 * 返回 null 表示没有未闭合的围栏。
 */
export function findUnclosedMermaid(source: string): UnclosedFence | null {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(MERMAID_RE);
    if (!open) continue;
    const marker = open[1][0];
    const fenceLength = open[1].length;
    const code: string[] = [];
    let closed = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const close = lines[cursor].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === marker && close[1].length >= fenceLength) {
        closed = true;
        break;
      }
      code.push(lines[cursor]);
    }
    if (!closed) {
      return { language: "mermaid", code: code.join("\n") };
    }
  }
  return null;
}
