/**
 * Small deterministic force-directed layout: all-pairs repulsion, link springs,
 * a weak centering force and velocity damping. Pure functions over plain data;
 * no randomness except a seedable PRNG for initial positions.
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned nodes never move under forces (user-dragged). */
  pinned?: boolean;
  /** Attribute nodes (category hubs / their value nodes) are pushed well away from project hubs and memories. */
  attr?: "category" | "value";
}

/** A link; the optional third item is a custom rest length (project -> child), pulled with a stronger spring. */
export type Link = readonly [string, string, number?, number?];

/** Spring strength multiplier for links that carry their own rest length. */
const HUB_SPRING = 1.8;

/** Repulsion multiplier between an attribute node and a non-attribute node (project hub or memory). */
export const ATTR_REPULSION = 8;
/** Constant outward push on category hubs, away from the centroid of the non-attribute nodes. */
const CATEGORY_OUTWARD = 10;
/** Ring radius (beyond the non-attribute nodes' extent) where new category hubs start. */
const CATEGORY_RING_GAP = 220;

export interface LayoutOptions {
  repulsion: number;
  springLength: number;
  springStrength: number;
  gravity: number;
  damping: number;
  maxSpeed: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  repulsion: 3200,
  springLength: 95,
  springStrength: 0.07,
  gravity: 0.012,
  damping: 0.78,
  maxSpeed: 30,
};

/** mulberry32: tiny seedable PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic initial positions spread over a disc (same ids + seed => same result). */
export function initialPositions(ids: string[], seed = 1, radius?: number): SimNode[] {
  const rand = seededRandom(seed);
  const r = radius ?? 40 + Math.sqrt(ids.length) * 40;
  return ids.map((id) => {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * r;
    return { id, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, vx: 0, vy: 0 };
  });
}

/**
 * Next node set for a changed id list: nodes that still exist keep their position,
 * new nodes appear near an already-placed neighbor (or at a seeded spot).
 */
export function reconcile(prev: SimNode[], ids: string[], links: readonly Link[], seed = 1): SimNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  const fresh = new Map(initialPositions(ids, seed).map((n) => [n.id, n]));
  const out = new Map<string, SimNode>();
  for (const id of ids) {
    const old = byId.get(id);
    if (old) out.set(id, { ...old, vx: 0, vy: 0 });
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const base = fresh.get(id)!;
    const neighbor = links
      .map(([a, b]) => (a === id ? b : b === id ? a : null))
      .find((o): o is string => o !== null && out.has(o));
    if (neighbor) {
      const nb = out.get(neighbor)!;
      out.set(id, { ...base, x: nb.x + (base.x % 30), y: nb.y + (base.y % 30) });
    } else {
      out.set(id, base);
    }
  }
  return ids.map((id) => out.get(id)!);
}

/**
 * One simulation tick. `alpha` (0..1] scales the forces, letting callers cool the
 * system. Returns new node objects; the input is not mutated.
 */
export function step(
  nodes: SimNode[],
  links: readonly Link[],
  opts: LayoutOptions = DEFAULT_LAYOUT,
  alpha = 1,
): SimNode[] {
  const n = nodes.length;
  const fx = new Array<number>(n).fill(0);
  const fy = new Array<number>(n).fill(0);
  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[i].x - nodes[j].x;
      let dy = nodes[i].y - nodes[j].y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Coincident nodes: separate along a deterministic direction.
        const a = (i * 2.399963 + j) % (Math.PI * 2);
        dx = Math.cos(a);
        dy = Math.sin(a);
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const cross = (nodes[i].attr !== undefined) !== (nodes[j].attr !== undefined);
      const f = (opts.repulsion * (cross ? ATTR_REPULSION : 1)) / Math.max(d2, 100);
      const ux = dx / d;
      const uy = dy / d;
      fx[i] += ux * f;
      fy[i] += uy * f;
      fx[j] -= ux * f;
      fy[j] -= uy * f;
    }
  }

  for (const [a, b, length, strength = 1] of links) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const dx = nodes[j].x - nodes[i].x;
    const dy = nodes[j].y - nodes[i].y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f =
      length === undefined
        ? opts.springStrength * strength * (d - opts.springLength)
        : opts.springStrength * HUB_SPRING * strength * (d - length);
    const ux = dx / d;
    const uy = dy / d;
    fx[i] += ux * f;
    fy[i] += uy * f;
    fx[j] -= ux * f;
    fy[j] -= uy * f;
  }

  // Category hubs get a weak outward bias from the centroid of everything that is not an attribute node.
  let cx = 0;
  let cy = 0;
  let plain = 0;
  for (const node of nodes) {
    if (node.attr === undefined) {
      cx += node.x;
      cy += node.y;
      plain++;
    }
  }
  if (plain > 0) {
    cx /= plain;
    cy /= plain;
    for (let i = 0; i < n; i++) {
      if (nodes[i].attr !== "category") continue;
      const dx = nodes[i].x - cx;
      const dy = nodes[i].y - cy;
      const d = Math.hypot(dx, dy) || 1;
      fx[i] += (dx / d) * CATEGORY_OUTWARD;
      fy[i] += (dy / d) * CATEGORY_OUTWARD;
    }
  }

  return nodes.map((node, i) => {
    if (node.pinned) return { ...node, vx: 0, vy: 0 };
    const gx = -node.x * opts.gravity;
    const gy = -node.y * opts.gravity;
    let vx = (node.vx + (fx[i] + gx) * alpha) * opts.damping;
    let vy = (node.vy + (fy[i] + gy) * alpha) * opts.damping;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > opts.maxSpeed) {
      vx = (vx / speed) * opts.maxSpeed;
      vy = (vy / speed) * opts.maxSpeed;
    }
    return { ...node, x: node.x + vx, y: node.y + vy, vx, vy };
  });
}

/** Fastest node speed: a cheap "is the layout still moving" measure. */
export function maxSpeed(nodes: SimNode[]): number {
  let m = 0;
  for (const n of nodes) m = Math.max(m, Math.hypot(n.vx, n.vy));
  return m;
}

export interface SettleOptions {
  maxIterations?: number;
  /** Stop once the fastest node moves slower than this. */
  threshold?: number;
  layout?: LayoutOptions;
}

/** Runs the simulation (cooling alpha) until it settles or the iteration cap is hit. */
export function runToSettle(
  nodes: SimNode[],
  links: readonly Link[],
  { maxIterations = 300, threshold = 0.05, layout = DEFAULT_LAYOUT }: SettleOptions = {},
): { nodes: SimNode[]; iterations: number; settled: boolean } {
  let current = nodes;
  let alpha = 1;
  for (let i = 1; i <= maxIterations; i++) {
    current = step(current, links, layout, alpha);
    alpha = Math.max(0.05, alpha * 0.985);
    if (maxSpeed(current) < threshold) return { nodes: current, iterations: i, settled: true };
  }
  return { nodes: current, iterations: maxIterations, settled: maxSpeed(current) < threshold };
}

/**
 * Places freshly added attribute nodes: category hubs on an outer ring around the centroid of the non-attribute nodes
 * (evenly spaced by order), value nodes beside their category hub. Existing nodes (`known`) are left alone.
 * `categoryOf` maps a value node id to its category hub id.
 */
export function placeAttributeNodes(
  nodes: SimNode[],
  known: ReadonlySet<string>,
  categoryOf: ReadonlyMap<string, string>,
): SimNode[] {
  const plain = nodes.filter((n) => n.attr === undefined);
  const hubs = nodes.filter((n) => n.attr === "category");
  if (hubs.length === 0 || hubs.every((h) => known.has(h.id))) return nodes;
  let cx = 0;
  let cy = 0;
  for (const p of plain) {
    cx += p.x / plain.length;
    cy += p.y / plain.length;
  }
  let extent = 0;
  for (const p of plain) extent = Math.max(extent, Math.hypot(p.x - cx, p.y - cy));
  const ring = extent + CATEGORY_RING_GAP;
  const out = new Map(nodes.map((n) => [n.id, n]));
  hubs.forEach((h, i) => {
    if (known.has(h.id)) return;
    const a = -Math.PI / 2 + (i / hubs.length) * Math.PI * 2;
    out.set(h.id, { ...h, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring });
  });
  let seq = 0;
  for (const v of nodes) {
    if (v.attr !== "value" || known.has(v.id)) continue;
    const hub = out.get(categoryOf.get(v.id) ?? "");
    if (!hub) continue;
    const a = seq++ * 2.399963; // golden angle: deterministic spread around the hub
    out.set(v.id, { ...v, x: hub.x + Math.cos(a) * 40, y: hub.y + Math.sin(a) * 40 });
  }
  return nodes.map((n) => out.get(n.id)!);
}

export interface ViewTransform {
  x: number;
  y: number;
  /** Scale. */
  k: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of nodes, each grown by its optional radius `r`; null when empty. */
export function boundsOf(nodes: readonly { x: number; y: number; r?: number }[]): Bounds | null {
  if (nodes.length === 0) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of nodes) {
    const r = n.r ?? 0;
    b.minX = Math.min(b.minX, n.x - r);
    b.minY = Math.min(b.minY, n.y - r);
    b.maxX = Math.max(b.maxX, n.x + r);
    b.maxY = Math.max(b.maxY, n.y + r);
  }
  return b;
}

/**
 * Pure fit: the transform that centres `bounds` in `size` with `padding` on every side. The zoom is clamped to
 * [minZoom, maxZoom] (a single point or tiny box therefore does not zoom in past maxZoom). Empty bounds (null) or an
 * unusable viewport give the neutral centred view at k = 1 (clamped).
 */
export function fitView(
  bounds: Bounds | null,
  size: { w: number; h: number },
  padding = 48,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): ViewTransform {
  if (!bounds || size.w <= 0 || size.h <= 0) {
    return { x: size.w / 2, y: size.h / 2, k: Math.min(maxZoom, Math.max(minZoom, 1)) };
  }
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const availW = Math.max(size.w - padding * 2, 1);
  const availH = Math.max(size.h - padding * 2, 1);
  const k = Math.min(maxZoom, Math.max(minZoom, Math.min(availW / w, availH / h)));
  return { k, x: size.w / 2 - ((bounds.minX + bounds.maxX) / 2) * k, y: size.h / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
}

/** Transform that centers the nodes' bounding box in a width x height viewport. */
export function fitTransform(
  nodes: readonly { x: number; y: number; r?: number }[],
  width: number,
  height: number,
  padding = 48,
  maxScale = 1.5,
): ViewTransform {
  return fitView(boundsOf(nodes), { w: width, h: height }, padding, MIN_ZOOM, Math.min(MAX_ZOOM, maxScale));
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(view: ViewTransform, factor: number, px: number, py: number): ViewTransform {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}
