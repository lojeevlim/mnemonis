import { Fragment, type ReactNode } from "react";
import { parseMarkdown, safeHref, type MdBlock } from "./markdown";

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)|((?<!\w)_[^_\s][^_\n]*_(?!\w))/;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = key++;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={k}>{renderInline(tok.slice(2, -2))}</strong>);
    } else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = mm ? safeHref(mm[2]) : null;
      out.push(
        href && mm ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent-400 underline underline-offset-2"
          >
            {renderInline(mm[1])}
          </a>
        ) : (
          <Fragment key={k}>{tok}</Fragment>
        ),
      );
    } else {
      out.push(<em key={k}>{renderInline(tok.slice(1, -1))}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** Renders text with soft line breaks preserved. */
function Inline({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderInline(l)}
        </Fragment>
      ))}
    </>
  );
}

const HEADING_CLASS = [
  "",
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-medium",
  "text-sm font-medium text-fg-muted",
  "text-xs font-medium text-fg-muted",
];

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
      return (
        <Tag className={`mt-3 first:mt-0 ${HEADING_CLASS[block.level]}`}>
          <Inline text={block.text} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="leading-relaxed">
          <Inline text={block.text} />
        </p>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted p-2 font-mono text-xs">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-border-strong pl-3 text-fg-muted">
          <Inline text={block.text} />
        </blockquote>
      );
    case "hr":
      return <hr className="border-border" />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`space-y-0.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((it, i) => (
            <li key={i} className={it.checked !== null ? "list-none -ml-5" : undefined}>
              {it.checked !== null && (
                <input type="checkbox" checked={it.checked} readOnly disabled className="mr-2 align-middle" aria-label={it.checked ? "done" : "not done"} />
              )}
              <Inline text={it.text} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

/** Safe Markdown renderer: builds React elements from a parsed AST, never raw HTML. */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  if (!source.trim()) return <p className="text-sm text-fg-subtle">No content.</p>;
  return (
    <div className={`space-y-2 text-sm text-fg ${className ?? ""}`}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
