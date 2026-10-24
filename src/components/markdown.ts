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

const FENCE = /^```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  const isBlockStart = (l: string) =>
    FENCE.test(l) || HEADING.test(l) || HR.test(l) || UL.test(l) || OL.test(l) || l.startsWith(">");

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }
    const ordered = OL.test(line);
    if (ordered || UL.test(line)) {
      const re = ordered ? OL : UL;
      const items: { text: string; checked: boolean | null }[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        const task = TASK.exec(m[1]);
        items.push(task ? { text: task[2], checked: task[1] !== " " } : { text: m[1], checked: null });
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) {
      para.push(lines[i++]);
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

/** Only these URL schemes are ever turned into links. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}
