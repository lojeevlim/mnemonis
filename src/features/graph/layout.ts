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
}

/** A link; the optional third item is a custom rest length (project -> child), pulled with a stronger spring. */
export type Link = readonly [string, string, number?];

/** Spring strength multiplier for links that carry their own rest length. */
const HUB_SPRING = 1.8;

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
      const f = opts.repulsion / Math.max(d2, 100);
      const ux = dx / d;
      const uy = dy / d;
      fx[i] += ux * f;
      fy[i] += uy * f;
      fx[j] -= ux * f;
      fy[j] -= uy * f;
    }
  }

  for (const [a, b, length] of links) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const dx = nodes[j].x - nodes[i].x;
    const dy = nodes[j].y - nodes[i].y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f =
      length === undefined ? opts.springStrength * (d - opts.springLength) : opts.springStrength * HUB_SPRING * (d - length);
    const ux = dx / d;
    const uy = dy / d;
    fx[i] += ux * f;
    fy[i] += uy * f;
    fx[j] -= ux * f;
    fy[j] -= uy * f;
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

export interface ViewTransform {
  x: number;
  y: number;
  /** Scale. */
  k: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Transform that centers the nodes' bounding box in a width x height viewport. */
export function fitTransform(
  nodes: readonly { x: number; y: number }[],
  width: number,
  height: number,
  padding = 48,
  maxScale = 1.5,
): ViewTransform {
  if (nodes.length === 0 || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const k = clampZoom(Math.min(maxScale, (width - padding * 2) / w, (height - padding * 2) / h));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k };
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(view: ViewTransform, factor: number, px: number, py: number): ViewTransform {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}
