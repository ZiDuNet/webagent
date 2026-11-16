import { Fragment, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import katex from "katex";
import type { Token } from "markdown-it";
import "katex/dist/katex.min.css";
import { CodeBox } from "../CodeBox/CodeBox";
import { Mermaid } from "../Mermaid/Mermaid";
import { DataChart } from "./DataChart";
import { parseTokens } from "./markdown";
import "./Markdown.css";

export interface MarkdownProps {
  content: string;
  className?: string;
  /** 流式渲染：传入累积文本即可，组件按当前完整内容实时渲染 */
  streaming?: boolean;
}

const TASK_RE = /^\[([ xX])\]\s+/;

function attr(token: Token, name: string): string | undefined {
  const pair = token.attrs?.find(([key]) => key === name);
  return pair ? String(pair[1]) : undefined;
}

function Math({ tex, block }: { tex: string; block: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [tex, block]);

  if (!html) {
    return <span className="md-math md-math--error">{tex}</span>;
  }
  return (
    <span
      className={`md-math ${block ? "md-math--block" : ""}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function linkProps(token: Token) {
  const href = attr(token, "href") ?? "#";
  const title = attr(token, "title");
  const external = /^https?:\/\//i.test(href);
  return {
    href,
    title,
    target: external ? "_blank" : undefined,
    rel: external ? "noreferrer noopener" : undefined,
  };
}

function renderInlineTokens(tokens: Token[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  const walk = (): ReactNode[] => {
    const children: ReactNode[] = [];
    while (index < tokens.length) {
      const token = tokens[index];
      index += 1;

      if (token.type === "text") {
        children.push(token.content);
        continue;
      }
      if (token.type === "softbreak" || token.type === "hardbreak") {
        children.push(<br key={children.length} />);
        continue;
      }
      if (token.type === "code_inline") {
        children.push(
          <code className="md-inline-code" key={children.length}>
            {token.content}
          </code>
        );
        continue;
      }
      if (token.type === "math_inline") {
        children.push(
          <Math tex={token.content} block={false} key={children.length} />
        );
        continue;
      }
      if (token.type === "image") {
        const src = attr(token, "src") ?? "";
        const alt = token.content ?? attr(token, "alt") ?? "";
        children.push(
          <img
            className="md-image"
            src={src}
            alt={alt}
            loading="lazy"
            key={children.length}
          />
        );
        continue;
      }

      if (token.nesting === 1) {
        const inner = walk();
        const key = children.length;
        if (token.type === "strong_open") {
          children.push(<strong key={key}>{inner}</strong>);
        } else if (token.type === "em_open") {
          children.push(<em key={key}>{inner}</em>);
        } else if (token.type === "s_open") {
          children.push(<del key={key}>{inner}</del>);
        } else if (token.type === "link_open") {
          children.push(
            <a {...linkProps(token)} key={key}>
              {inner}
            </a>
          );
        } else {
          children.push(<Fragment key={key}>{inner}</Fragment>);
        }
        continue;
      }

      if (token.nesting === -1) {
        return children;
      }

      children.push(token.content ?? "");
    }
    return children;
  };

  void nodes;
  return walk();
}

function cellStyle(token: Token): CSSProperties | undefined {
  const style = attr(token, "style");
  if (!style) return undefined;
  if (style.includes("text-align:center")) return { textAlign: "center" };
  if (style.includes("text-align:right")) return { textAlign: "right" };
  if (style.includes("text-align:left")) return { textAlign: "left" };
  return undefined;
}

function markTaskItems(tokens: Token[]): Token[] {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "list_item_open") continue;

    let depth = 1;
    let inlineToken: Token | null = null;
    for (let j = i + 1; j < tokens.length && depth > 0; j += 1) {
      const current = tokens[j];
      if (current.type === "list_item_open") depth += 1;
      else if (current.type === "list_item_close") {
        depth -= 1;
        if (depth === 0) break;
      } else if (
        current.type === "inline" &&
        !inlineToken &&
        current.children?.length
      ) {
        inlineToken = current;
      }
    }
    if (!inlineToken || !inlineToken.children) continue;

    const firstText = inlineToken.children.find(
      (child) => child.type === "text"
    );
    if (!firstText) continue;
    const match = firstText.content.match(TASK_RE);
    if (!match) continue;

    firstText.content = firstText.content.slice(match[0].length);
    inlineToken.content = inlineToken.content.replace(TASK_RE, "");
    token.meta = { task: true, checked: match[1].toLowerCase() === "x" };
  }
  return tokens;
}

function renderBlocks(tokens: Token[], streaming = false): ReactNode[] {
  const prepared = markTaskItems(tokens);
  const nodes: ReactNode[] = [];
  let index = 0;

  const walk = (): ReactNode[] => {
    const children: ReactNode[] = [];
    while (index < prepared.length) {
      const token = prepared[index];
      index += 1;

      if (token.type === "inline") {
        children.push(
          <Fragment key={children.length}>
            {renderInlineTokens(token.children ?? [])}
          </Fragment>
        );
        continue;
      }
      if (token.type === "fence") {
        const language = (token.info ?? "text").trim().toLowerCase();
        if (language === "mermaid") {
          children.push(<Mermaid code={token.content} streaming={streaming} key={children.length} />);
        } else if (language === "chart") {
          children.push(<DataChart source={token.content} key={children.length} />);
        } else {
          children.push(
            <div className="md-code" key={children.length}>
              <CodeBox
                code={token.content}
                language={language || "text"}
                lineNumbers={false}
              />
            </div>
          );
        }
        continue;
      }
      if (token.type === "math_block") {
        children.push(<Math tex={token.content} block key={children.length} />);
        continue;
      }
      if (token.type === "hr") {
        children.push(<hr className="md-hr" key={children.length} />);
        continue;
      }

      if (token.nesting === 1) {
        const inner = walk();
        const key = children.length;
        if (token.type === "heading_open") {
          const Tag = `h${token.tag.slice(1)}` as
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6";
          children.push(
            <Tag className={`md-heading ${token.tag}`} key={key}>
              {inner}
            </Tag>
          );
        } else if (token.type === "paragraph_open") {
          children.push(
            <p className="md-paragraph" key={key}>
              {inner}
            </p>
          );
        } else if (token.type === "bullet_list_open") {
          children.push(
            <ul className="md-list" key={key}>
              {inner}
            </ul>
          );
        } else if (token.type === "ordered_list_open") {
          const start = token.attrGet("start")
            ? Number(token.attrGet("start"))
            : 1;
          children.push(
            <ol className="md-list" start={start} key={key}>
              {inner}
            </ol>
          );
        } else if (token.type === "table_open") {
          children.push(
            <div className="md-table-wrap" key={key}>
              <table className="md-table">{inner}</table>
            </div>
          );
        } else if (token.type === "thead_open") {
          children.push(<thead key={key}>{inner}</thead>);
        } else if (token.type === "tbody_open") {
          children.push(<tbody key={key}>{inner}</tbody>);
        } else if (token.type === "tr_open") {
          children.push(<tr key={key}>{inner}</tr>);
        } else if (token.type === "th_open") {
          children.push(
            <th key={key} style={cellStyle(token)}>
              {inner}
            </th>
          );
        } else if (token.type === "td_open") {
          children.push(
            <td key={key} style={cellStyle(token)}>
              {inner}
            </td>
          );
        } else if (token.type === "list_item_open") {
          const meta = token.meta as { task?: boolean; checked?: boolean } | undefined;
          children.push(
            <li
              className={`md-li ${meta?.task ? "md-li--task" : ""}`.trim()}
              key={key}
            >
              {meta?.task && (
                <span
                  className={`md-task ${meta.checked ? "is-checked" : ""}`.trim()}
                  aria-hidden="true"
                >
                  {meta.checked ? "✓" : ""}
                </span>
              )}
              {inner}
            </li>
          );
        } else if (token.type === "blockquote_open") {
          children.push(
            <blockquote className="md-quote" key={key}>
              {inner}
            </blockquote>
          );
        } else {
          children.push(<Fragment key={key}>{inner}</Fragment>);
        }
        continue;
      }

      if (token.nesting === -1) {
        return children;
      }
    }
    return children;
  };

  void nodes;
  return walk();
}

export const Markdown = memo(function Markdown({
  content,
  className = "",
  streaming = false,
}: MarkdownProps) {
  const blocks = useMemo(() => {
    if (!content) return [];
    return renderBlocks(parseTokens(content), streaming);
  }, [content, streaming]);

  return (
    <div className={`md ${className}`.trim()}>
      {blocks}
    </div>
  );
});
