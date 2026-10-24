import type { GraphNode } from "./graphModel";

/** Fallbacks keep the graph readable even if a palette variable is not emitted. */
const PALETTE: [string, string][] = [
  ["--color-blue-500", "#3b82f6"],
  ["--color-emerald-500", "#10b981"],
  ["--color-violet-500", "#8b5cf6"],
  ["--color-amber-500", "#f59e0b"],
  ["--color-rose-500", "#f43f5e"],
  ["--color-cyan-500", "#06b6d4"],
  ["--color-fuchsia-500", "#d946ef"],
  ["--color-lime-500", "#84cc16"],
  ["--color-orange-500", "#f97316"],
  ["--color-slate-400", "#94a3b8"],
];

const BUILT_IN_ORDER = [
  "personal_context",
  "preference",
  "project",
  "technical_decision",
  "fact",
  "research",
  "procedure",
  "meeting_note",
  "task",
  "reference",
];

const css = ([name, fallback]: [string, string]) => `var(${name}, ${fallback})`;

/** Stable colour per memory type (custom types hash into the palette). Theme-aware via CSS variables. */
export function typeColor(type: string): string {
  const i = BUILT_IN_ORDER.indexOf(type);
  if (i >= 0) return css(PALETTE[i % PALETTE.length]);
  let h = 0;
  for (let c = 0; c < type.length; c++) h = (h * 31 + type.charCodeAt(c)) >>> 0;
  return css(PALETTE[h % PALETTE.length]);
}

export const AMBER = "var(--color-amber-500, #f59e0b)";
export const ROSE = "var(--color-rose-500, #f43f5e)";
export const ACCENT = "var(--color-accent-500, #64748b)";

/** Node radius grows with degree (capped). */
export function nodeRadius(node: Pick<GraphNode, "degree">): number {
  return 7 + Math.min(10, node.degree * 1.5);
}
