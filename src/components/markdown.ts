/**
 * Tiny, dependency-free Markdown block parser. It only produces a data AST
 * (no HTML strings); MarkdownView renders that AST through React, so untrusted
 * content can never inject markup.
 */
export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: { text: string; checked: boolean | null }[] }
  | { type: "hr" };

/** Lines longer than this are never treated as block syntax; they become plain paragraph text. */
export const MAX_BLOCK_LINE = 10_000;

// Block syntax is recognised with small manual scanners rather than regexes: every helper below is a
// single linear pass, so long whitespace/marker runs in untrusted content cannot cause backtracking.
const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
const skipWs = (l: string, from = 0) => {
  let k = from;
  while (k < l.length && isWs(l[k])) k++;
  return k;
};

/** "```lang" opening fence: returns the language ("" if none) or null. */
function fenceLang(l: string): string | null {
  if (!l.startsWith("```")) return null;
  const rest = l.slice(3).trim();
  return /^[\w+-]*$/.test(rest) ? rest : null;
}

const isClosingFence = (l: string) => l.startsWith("```") && l.slice(3).trim() === "";

/** ATX heading: returns level and text or null. */
function parseHeading(l: string): { level: number; text: string } | null {
  let n = 0;
  while (n < l.length && n <= 6 && l[n] === "#") n++;
  if (n < 1 || n > 6 || !isWs(l[n])) return null;
  let text = l.slice(n).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  text = text.slice(0, end).trimEnd();
  return { level: n, text };
}

function isHr(l: string): boolean {
  let k = 0;
  while (k < 3 && isWs(l[k])) k++;
  const c = l[k];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  let count = 0;
  for (; k < l.length; k++) {
    if (l[k] === c) count++;
    else if (!isWs(l[k])) return false;
  }
  return count >= 3;
}

/** Bullet item: returns the item text or null. */
function ulText(l: string): string | null {
  const k = skipWs(l);
  const c = l[k];
  if ((c !== "-" && c !== "*" && c !== "+") || !isWs(l[k + 1])) return null;
  return l.slice(skipWs(l, k + 1));
}

/** Numbered item: returns the item text or null. */
function olText(l: string): string | null {
  let k = skipWs(l);
  const d = k;
  while (k < l.length && l[k] >= "0" && l[k] <= "9") k++;
  if (k === d || (l[k] !== "." && l[k] !== ")") || !isWs(l[k + 1])) return null;
  return l.slice(skipWs(l, k + 1));
}

/** Task checkbox prefix "[ ] " / "[x] ": returns state and text or null. */
function taskText(l: string): { checked: boolean; text: string } | null {
  if (l[0] !== "[" || (l[1] !== " " && l[1] !== "x" && l[1] !== "X") || l[2] !== "]" || !isWs(l[3])) return null;
  return { checked: l[1] !== " ", text: l.slice(skipWs(l, 3)) };
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  const isBlockStart = (l: string) =>
    l.length <= MAX_BLOCK_LINE &&
    (fenceLang(l) !== null || parseHeading(l) !== null || isHr(l) || ulText(l) !== null || olText(l) !== null || l.startsWith(">"));

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.length <= MAX_BLOCK_LINE) {
      const lang = fenceLang(line);
      if (lang !== null) {
        const body: string[] = [];
        i++;
        while (i < lines.length && !(lines[i].length <= MAX_BLOCK_LINE && isClosingFence(lines[i]))) body.push(lines[i++]);
        i++; // closing fence (or end of input)
        blocks.push({ type: "code", lang, text: body.join("\n") });
        continue;
      }
      const heading = parseHeading(line);
      if (heading) {
        blocks.push({ type: "heading", level: heading.level, text: heading.text });
        i++;
        continue;
      }
      if (isHr(line)) {
        blocks.push({ type: "hr" });
        i++;
        continue;
      }
      if (line.startsWith(">")) {
        const body: string[] = [];
        while (i < lines.length && lines[i].length <= MAX_BLOCK_LINE && lines[i].startsWith(">")) {
          const q = lines[i++].slice(1);
          body.push(isWs(q[0]) ? q.slice(1) : q);
        }
        blocks.push({ type: "quote", text: body.join("\n") });
        continue;
      }
      const ordered = olText(line) !== null;
      if (ordered || ulText(line) !== null) {
        const match = ordered ? olText : ulText;
        const items: { text: string; checked: boolean | null }[] = [];
        while (i < lines.length && lines[i].length <= MAX_BLOCK_LINE) {
          const t = match(lines[i]);
          if (t === null) break;
          const task = taskText(t);
          items.push(task ? { text: task.text, checked: task.checked } : { text: t, checked: null });
          i++;
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

/** Only these URL schemes are ever turned into links. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}
