import { useEffect, useRef } from "react";
import { Icon } from "../ui/Icon";
import "./HtmlStreamCard.css";

export interface HtmlStreamCardProps {
  title: string;
  characters: number;
  html: string;
}

export function HtmlStreamCard({ title, characters, html }: HtmlStreamCardProps) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [html]);

  return (
    <section className="html-stream" aria-label={`${title} 正在生成`}>
      <header className="html-stream__head">
        <span className="html-stream__icon"><Icon name="code" size={13} /></span>
        <span className="html-stream__title">{title}</span>
        <span className="html-stream__meta">{characters.toLocaleString()} 字符</span>
        <span className="html-stream__live"><i /><i /><i /></span>
      </header>
      <pre ref={scrollRef} className="html-stream__code" aria-live="off">{html}</pre>
    </section>
  );
}
