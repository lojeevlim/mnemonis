import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, safeHref, type MdBlock } from "./markdown";

/** Longest span (code, bold, emphasis, link text, link url) that is parsed as one inline token. */
const MAX_TOKEN = 500;
/** Lines longer than this are rendered as plain text (inline parsing is skipped). */
const MAX_INLINE_LINE = 10_000;
const MAX_DEPTH = 4;

const isSpace = (c: string) => /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /\w/.test(c);

/** Index of `ch` within [from, from + MAX_TOKEN], stopping early at a newline or a `stop` char; -1 if absent. */
function findWithin(text: string, ch: string, from: number, stop = ""): number {
  const end = Math.min(text.length, from + MAX_TOKEN + 1);
  for (let j = from; j < end; j++) {
    const c = text[j];
    if (c === ch) return j;
    if (c === "\n" || (stop && stop.includes(c))) return -1;
  }
  return -1;
}

const HOSTLIKE = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "mailto:") return decodeURIComponent(u.pathname).split("@").pop()?.toLowerCase() ?? "";
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}
const bare = (h: string) => h.replace(/^www\./, "");

/** If the visible link text looks like a URL/host that differs from the real destination, returns the real host. */
function spoofedHost(visible: string, href: string): string | null {
  // Judge what the reader actually sees: emphasis/code markers are not displayed, so drop them first.
  const t = visible.replace(/[*_`]/g, "").trim();
  if (!HOSTLIKE.test(t)) return null;
  const shown = hostOf(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  const real = hostOf(href);
  if (!real || bare(shown) === bare(real)) return null;
  return real;
}

/** Linear single-pass inline tokenizer; every token is bounded by MAX_TOKEN so cost is O(n * MAX_TOKEN) at worst. */
function scanInline(text: string, depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let key = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  const nested = (t: string) => (depth >= MAX_DEPTH ? [t] : scanInline(t, depth + 1));
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    let end = -1; // index just after the token
    let node: ReactNode = null;
    if (c === "`") {
      const j = findWithin(text, "`", i + 1);
      if (j > i + 1) {
        end = j + 1;
        node = (
          <code key={key++} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]">
            {text.slice(i + 1, j)}
          </code>
        );
      }
    } else if (c === "*" && text[i + 1] === "*") {
      const j = findWithin(text, "*", i + 2);
      if (j > i + 2 && text[j + 1] === "*") {
        end = j + 2;
        node = <strong key={key++}>{nested(text.slice(i + 2, j))}</strong>;
      }
    } else if (c === "[") {
      const close = findWithin(text, "]", i + 1);
      if (close > i + 1 && text[close + 1] === "(") {
        const urlEnd = findWithin(text, ")", close + 2, " \t\r\f\v");
        if (urlEnd > close + 2) {
          end = urlEnd + 1;
          const label = text.slice(i + 1, close);
          const href = safeHref(text.slice(close + 2, urlEnd));
          if (href) {
            const host = spoofedHost(label, href);
            node = (
              <Fragment key={key++}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent-400 underline underline-offset-2"
                >
                  {nested(label)}
                </a>
                {host && <span className="ml-1 text-xs text-fg-muted">(links to {host})</span>}
              </Fragment>
            );
          } else {
            node = text.slice(i, end);
          }
        }
      }
    } else if (c === "*" && i + 1 < text.length && !isSpace(text[i + 1]) && text[i + 1] !== "*") {
      const j = findWithin(text, "*", i + 2);
      if (j > 0) {
        end = j + 1;
        node = <em key={key++}>{nested(text.slice(i + 1, j))}</em>;
      }
    } else if (c === "_" && !isWord(text[i - 1]) && i + 1 < text.length && !isSpace(text[i + 1]) && text[i + 1] !== "_") {
      const j = findWithin(text, "_", i + 2);
      if (j > 0 && !isWord(text[j + 1])) {
        end = j + 1;
        node = <em key={key++}>{nested(text.slice(i + 1, j))}</em>;
      }
    }
    if (end < 0) {
      plain += c;
      i++;
      continue;
    }
    if (typeof node === "string") plain += node;
    else {
      flush();
      out.push(node);
    }
    i = end;
  }
  flush();
  return out;
}

function renderInline(text: string): ReactNode[] {
  return text.length > MAX_INLINE_LINE ? [text] : scanInline(text, 0);
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
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  if (!source.trim()) return <p className="text-sm text-fg-subtle">No content.</p>;
  return (
    <div className={`space-y-2 text-sm text-fg ${className ?? ""}`}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
