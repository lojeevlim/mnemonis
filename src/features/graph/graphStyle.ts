import type { AttributeKind, GraphNode } from "./graphModel";

/** Chromatic lojee-ui accent palettes only (`data-accent="<name>"`); the neutral ones (gray, slate, ...) would read as "no project".
 * `amber` is left out on purpose: AMBER is the pending/highlight ring colour. */
export const PROJECT_ACCENTS = [
  "red", "orange", "yellow", "lime", "green", "emerald", "teal", "cyan",
  "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
] as const;

/** Shade per tier: 500 reads on light and dark; 300 / 700 are the next-most-visible steps on both. */
export const PROJECT_SHADES = [500, 300, 700] as const;

export interface ProjectAccent {
  accent: string;
  shade: number;
}

/** FNV-1a 32-bit string hash: stable across runs and platforms. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Collision probe step. Must be coprime to PROJECT_ACCENTS.length (16) so the probe visits every slot; 7 lands far from the start hue. */
const PROBE_STRIDE = 7;

/**
 * Deterministic, random-looking colour per project key. Keys are processed in (hash, key) order; each starts at
 * `hash % PROJECT_ACCENTS.length` and probes with a fixed stride (PROBE_STRIDE) to the first accent not yet taken in the
 * current tier, so colliding projects land on clearly different hues and up to PROJECT_ACCENTS.length projects get distinct
 * hues. Further projects open a new tier with a different shade (500, 300, 700, then repeating).
 * The result does not depend on input order or duplicates. Limitation: probing means a project's colour can shift
 * when another project that hashes to the same or an earlier slot appears or disappears; callers should compute it
 * from a set of projects that does not change with filters or the archived toggle (all memories, archived included).
 */
export function assignProjectAccents(keys: Iterable<string>): Map<string, ProjectAccent> {
  const sorted = [...new Set(keys)].map((key) => ({ key, hash: hashKey(key) })).sort((a, b) => a.hash - b.hash || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const n = PROJECT_ACCENTS.length;
  const used: Set<number>[] = [];
  const out = new Map<string, ProjectAccent>();
  for (const { key, hash } of sorted) {
    const start = hash % n;
    for (let tier = 0; ; tier++) {
      const taken = (used[tier] ??= new Set());
      if (taken.size >= n) continue;
      let i = start;
      while (taken.has(i)) i = (i + PROBE_STRIDE) % n;
      taken.add(i);
      out.set(key, { accent: PROJECT_ACCENTS[i], shade: PROJECT_SHADES[tier % PROJECT_SHADES.length] });
      break;
    }
  }
  return out;
}

/** Fill for an element inside (or carrying) `data-accent`: `--color-accent-N` re-resolves per element. */
export const accentFill = (shade: number): string => `var(--color-accent-${shade}, #64748b)`;

/** Nodes that belong to no project. */
export const NEUTRAL = "var(--color-slate-400, #94a3b8)";

export const AMBER = "var(--color-amber-500, #f59e0b)";
export const ROSE = "var(--color-rose-500, #f43f5e)";
export const ACCENT = "var(--color-accent-500, #64748b)";

/** Project hub radius: grows with the child count, capped. */
const projectRadius = (childCount: number): number => Math.min(40, 14 + Math.sqrt(childCount) * 4);

/** Category hubs are 35% bigger than a project hub with the same member count (cap 54 vs 40), so they always read as the biggest circles. */
export const ATTRIBUTE_HUB_SCALE = 1.35;

/** Organization hubs are the biggest circles: bigger than any project hub (cap 40), growing a little with their project count. */
const organizationRadius = (projectCount: number): number => Math.min(64, 44 + Math.sqrt(projectCount) * 5);

/** A collection node is this fraction of an organization hub with the same count (still big enough to hold its label, see GraphCanvas). */
export const COLLECTION_NODE_SCALE = 0.7;

/** Radius of a tag / type / status value node: clearly below the smallest memory node (7). */
export const VALUE_NODE_RADIUS = 4.5;



/** Node radius grows with degree (capped); project hubs are bigger and grow with their child count (capped); category hubs are bigger still; value nodes are smaller than any memory. */
export function nodeRadius(node: Pick<GraphNode, "degree"> & Partial<Pick<GraphNode, "childCount" | "isProject" | "attr" | "attrRole" | "organization">>): number {
  if (node.organization) return organizationRadius(node.childCount ?? 0);
  // A collection node grows like an organization hub but is drawn smaller; other value nodes stay tiny.
  if (node.attr && node.attrRole === "value") return node.attr === "collection" ? COLLECTION_NODE_SCALE * organizationRadius(node.childCount ?? 0) : VALUE_NODE_RADIUS;
  // The Collections hub must stay bigger than its (organization-sized) collection nodes.
  if (node.attr === "collection") return Math.min(80, organizationRadius(node.childCount ?? 0) + 16);
  if (node.attr) return Math.min(54, ATTRIBUTE_HUB_SCALE * (14 + Math.sqrt(node.childCount ?? 0) * 4));
  if (node.isProject) return projectRadius(node.childCount ?? 0);
  return 7 + Math.min(10, node.degree * 1.5);
}

/** Outline dash pattern per attribute kind, so the four kinds of neutral hub differ by more than their label. */
export const ATTRIBUTE_DASH: Record<AttributeKind, string | undefined> = {
  collection: undefined,
  type: "10 4",
  tag: "2 4",
  status: "10 3 2 3",
};

