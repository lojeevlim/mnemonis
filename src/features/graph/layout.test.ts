import { describe, expect, it } from "vitest";
import {
  clampZoom,
  fitTransform,
  initialPositions,
  maxSpeed,
  MAX_ZOOM,
  MIN_ZOOM,
  reconcile,
  runToSettle,
  seededRandom,
  step,
  zoomAt,
  type Link,
  type SimNode,
} from "./layout";

const ids = ["a", "b", "c", "d", "e", "f"];
const links: Link[] = [
  ["a", "b"],
  ["b", "c"],
  ["c", "d"],
  ["d", "e"],
];

describe("seeded positions", () => {
  it("is deterministic per seed and differs across seeds", () => {
    expect(initialPositions(ids, 3)).toEqual(initialPositions(ids, 3));
    expect(initialPositions(ids, 3)).not.toEqual(initialPositions(ids, 4));
    const r = seededRandom(1);
    const vals = Array.from({ length: 50 }, r);
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("simulation", () => {
  it("repels coincident and nearby nodes apart, deterministically", () => {
    const start: SimNode[] = [
      { id: "a", x: 0, y: 0, vx: 0, vy: 0 },
      { id: "b", x: 0, y: 0, vx: 0, vy: 0 },
    ];
    const next = step(start, []);
    expect(Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y)).toBeGreaterThan(0);
    expect(step(start, [])).toEqual(next);
  });

  it("does not mutate input and keeps pinned nodes fixed", () => {
    const start = initialPositions(ids, 1);
    start[0] = { ...start[0], pinned: true };
    const copy = JSON.parse(JSON.stringify(start));
    const next = step(start, links);
    expect(start).toEqual(copy);
    expect(next[0].x).toBe(start[0].x);
    expect(next[0].y).toBe(start[0].y);
  });

  it("springs pull linked nodes toward the rest length", () => {
    const far: SimNode[] = [
      { id: "a", x: -400, y: 0, vx: 0, vy: 0 },
      { id: "b", x: 400, y: 0, vx: 0, vy: 0 },
    ];
    const { nodes } = runToSettle(far, [["a", "b"]]);
    expect(Math.abs(nodes[1].x - nodes[0].x)).toBeLessThan(400);
  });

  it("gravity keeps unlinked components near the centre", () => {
    const { nodes } = runToSettle(initialPositions(["x", "y", "z"], 5, 800), []);
    for (const n of nodes) expect(Math.hypot(n.x, n.y)).toBeLessThan(800);
  });

  it("runToSettle settles and is reproducible", () => {
    const a = runToSettle(initialPositions(ids, 9), links, { maxIterations: 600 });
    const b = runToSettle(initialPositions(ids, 9), links, { maxIterations: 600 });
    expect(a.settled).toBe(true);
    expect(a.nodes).toEqual(b.nodes);
    expect(maxSpeed(a.nodes)).toBeLessThan(0.05);
    for (const n of a.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("runToSettle honours the iteration cap", () => {
    const r = runToSettle(initialPositions(ids, 9), links, { maxIterations: 2, threshold: 0 });
    expect(r.iterations).toBe(2);
    expect(r.settled).toBe(false);
  });

  it("handles empty and single-node inputs", () => {
    expect(runToSettle([], []).nodes).toEqual([]);
    const one = runToSettle(initialPositions(["a"], 1), []);
    expect(one.nodes).toHaveLength(1);
  });
});

describe("reconcile", () => {
  it("keeps existing positions, drops removed nodes, places new nodes near a neighbour", () => {
    const prev: SimNode[] = [
      { id: "a", x: 100, y: 100, vx: 3, vy: 3, pinned: true },
      { id: "gone", x: 0, y: 0, vx: 0, vy: 0 },
    ];
    const out = reconcile(prev, ["a", "n"], [["a", "n"]], 1);
    expect(out.map((n) => n.id)).toEqual(["a", "n"]);
    expect(out[0]).toMatchObject({ x: 100, y: 100, vx: 0, vy: 0, pinned: true });
    expect(Math.hypot(out[1].x - 100, out[1].y - 100)).toBeLessThan(60);
  });
});

describe("view transforms", () => {
  it("fitTransform centres the bounds inside the viewport", () => {
    const pts = [
      { x: -100, y: -50 },
      { x: 100, y: 50 },
    ];
    const t = fitTransform(pts, 800, 600);
    expect(t.x).toBeCloseTo(400);
    expect(t.y).toBeCloseTo(300);
    expect(t.k).toBeLessThanOrEqual(1.5);
    expect(fitTransform([], 800, 600)).toEqual({ x: 400, y: 300, k: 1 });
  });

  it("zoomAt keeps the anchor point fixed and clamps scale", () => {
    const v = { x: 10, y: 20, k: 1 };
    const z = zoomAt(v, 2, 100, 100);
    expect((100 - z.x) / z.k).toBeCloseTo((100 - v.x) / v.k);
    expect((100 - z.y) / z.k).toBeCloseTo((100 - v.y) / v.k);
    expect(zoomAt(v, 1000, 0, 0).k).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
});
