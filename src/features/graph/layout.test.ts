import { describe, expect, it } from "vitest";
import {
  clampZoom,
  boundsOf,
  fitTransform,
  fitView,
  placeAttributeNodes,
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

  it("treats links without a rest length (legacy 2-element links) as before", () => {
    const far = (): SimNode[] => [
      { id: "a", x: -400, y: 0, vx: 0, vy: 0 },
      { id: "b", x: 400, y: 0, vx: 0, vy: 0 },
    ];
    const legacy: Link[] = [["a", "b"]];
    const next = step(far(), legacy);
    expect(Number.isFinite(next[0].x)).toBe(true);
    expect(next[0].x).toBeGreaterThan(-400); // pulled toward its partner
    expect(next[1].x).toBeLessThan(400);
    expect(step(far(), legacy)).toEqual(next);
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

describe("hub links", () => {
  it("pull children into a ring near the hub at their rest length", () => {
    const hubIds = ["hub", "k1", "k2", "k3", "k4"];
    const hubLinks: Link[] = hubIds.slice(1).map((k) => ["k" + k.slice(1), "hub", 70] as Link);
    const { nodes } = runToSettle(initialPositions(hubIds, 7), hubLinks);
    const hub = nodes.find((n) => n.id === "hub")!;
    for (const n of nodes.filter((x) => x.id !== "hub")) {
      const d = Math.hypot(n.x - hub.x, n.y - hub.y);
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(130);
    }
  });
});

describe("fitView", () => {
  const size = { w: 800, h: 600 };
  it("handles empty bounds with the neutral centred view", () => {
    expect(fitView(null, size)).toEqual({ x: 400, y: 300, k: 1 });
    expect(boundsOf([])).toBeNull();
    expect(fitView({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, k: 1 });
  });

  it("centres a single node and clamps the zoom to the maximum", () => {
    const t = fitView(boundsOf([{ x: 50, y: -20 }]), size, 48, 0.15, 4);
    expect(t.k).toBe(4);
    expect(t.x).toBeCloseTo(400 - 50 * 4);
    expect(t.y).toBeCloseTo(300 + 20 * 4);
  });

  it("clamps to the minimum zoom for huge bounds and honours custom limits", () => {
    expect(fitView({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }, size).k).toBe(MIN_ZOOM);
    expect(fitView({ minX: 0, minY: 0, maxX: 1e5, maxY: 10 }, size, 48, 0.5, 2).k).toBe(0.5);
  });

  it("is limited by the tighter axis for wide and tall boxes, and padding shrinks the zoom", () => {
    const wide = fitView({ minX: 0, minY: 0, maxX: 1600, maxY: 100 }, size, 0);
    expect(wide.k).toBeCloseTo(800 / 1600);
    const tall = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 1200 }, size, 0);
    expect(tall.k).toBeCloseTo(600 / 1200);
    const padded = fitView({ minX: 0, minY: 0, maxX: 1600, maxY: 100 }, size, 100);
    expect(padded.k).toBeCloseTo(600 / 1600);
    expect(padded.x + 800 * padded.k).toBeCloseTo(400); // box centre lands mid-viewport
  });

  it("includes node radii in the bounds", () => {
    expect(boundsOf([{ x: 0, y: 0, r: 10 }, { x: 100, y: 50, r: 5 }])).toEqual({ minX: -10, minY: -10, maxX: 105, maxY: 55 });
  });
});

describe("attribute nodes stay far from project clusters", () => {
  // Two project hubs with 6 members each (hub links), plus two category hubs with values linked to members.
  const build = (withAttr: boolean) => {
    const ids: string[] = [];
    const ls: Link[] = [];
    for (const p of ["pa", "pb"]) {
      ids.push(p);
      for (let i = 0; i < 6; i++) {
        ids.push(`${p}m${i}`);
        ls.push([`${p}m${i}`, p, 60]);
      }
    }
    if (withAttr) {
      for (const c of ["category:type", "category:tag"]) {
        ids.push(c);
        for (let i = 0; i < 3; i++) {
          const v = `${c}/v${i}`;
          ids.push(v);
          ls.push([v, c, 50]);
          ls.push(["pa" + "m" + i, v, undefined, 0.2]);
          ls.push(["pb" + "m" + i, v, undefined, 0.2]);
        }
      }
    }
    return { ids, ls };
  };
  const run = (withAttr: boolean, strip = false) => {
    const { ids, ls } = build(withAttr);
    const nodes = initialPositions(ids, 7).map((n) => (n.id.startsWith("category:") ? { ...n, attr: (n.id.includes("/") ? "value" : "category") as "value" | "category" } : n));
    const placed = placeAttributeNodes(nodes, new Set(), new Map(ids.filter((i) => i.includes("/")).map((i) => [i, i.split("/")[0]])));
    return runToSettle(strip ? placed.map((n) => ({ ...n, attr: undefined })) : placed, ls, { maxIterations: 600 }).nodes;
  };
  const dist = (a: SimNode, b: SimNode) => Math.hypot(a.x - b.x, a.y - b.y);

  it("puts category hubs and values well away from project hubs and their members", () => {
    const nodes = run(true);
    const plain = nodes.filter((n) => !n.attr);
    const attrs = nodes.filter((n) => n.attr);
    const hubs = nodes.filter((n) => n.id === "pa" || n.id === "pb");
    for (const cat of nodes.filter((n) => n.attr === "category")) {
      for (const h of hubs) expect(dist(cat, h)).toBeGreaterThan(250);
    }
    // Baseline: same graph and start without the attribute forces (no cross repulsion, no outward bias).
    const base = run(true, true);
    const baseNearest = Math.min(...base.filter((n) => n.id.startsWith("category:")).flatMap((a) => base.filter((p) => !p.id.startsWith("category:")).map((p) => dist(a, p))));
    const nearest = Math.min(...attrs.flatMap((a) => plain.map((p) => dist(a, p))));
    expect(nearest).toBeGreaterThan(120);
    expect(nearest).toBeGreaterThan(baseNearest + 40);
    // members stay with their project hub despite the weak memory -> value links.
    for (const n of plain.filter((x) => x.id.startsWith("pam"))) expect(dist(n, hubs.find((h) => h.id === "pa")!)).toBeLessThan(160);
  });

  it("is deterministic, and without attribute nodes the layout is unchanged by the attribute forces", () => {
    expect(run(true)).toEqual(run(true));
    const { ids, ls } = build(false);
    const start = initialPositions(ids, 7);
    const plain = runToSettle(start, ls, { maxIterations: 600 }).nodes;
    const tagged = runToSettle(start.map((n) => ({ ...n, attr: undefined })), ls, { maxIterations: 600 }).nodes;
    expect(tagged).toEqual(plain);
    expect(placeAttributeNodes(start, new Set(), new Map())).toBe(start);
  });
});
