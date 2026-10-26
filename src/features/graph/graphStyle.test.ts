import { describe, expect, it } from "vitest";
import { PROJECT_ACCENTS, PROJECT_SHADES, accentFill, assignProjectAccents, hashKey, nodeRadius, ATTRIBUTE_HUB_SCALE, VALUE_NODE_RADIUS } from "./graphStyle";

describe("nodeRadius", () => {
  it("keeps ordinary nodes at the degree-based size", () => {
    expect(nodeRadius({ degree: 0 })).toBe(7);
    expect(nodeRadius({ degree: 2, childCount: 0, isProject: false })).toBe(10);
    expect(nodeRadius({ degree: 50 })).toBe(17);
  });

  it("makes project hubs bigger than leaves, growing with children up to a cap", () => {
    const leaf = nodeRadius({ degree: 1, childCount: 0, isProject: false });
    const small = nodeRadius({ degree: 1, childCount: 1, isProject: true });
    const big = nodeRadius({ degree: 9, childCount: 9, isProject: true });
    expect(small).toBeGreaterThan(leaf);
    expect(big).toBeGreaterThan(small);
    expect(big).toBe(26);
    expect(nodeRadius({ degree: 500, childCount: 500, isProject: true })).toBe(40);
  });

  it("makes an organization hub bigger than any project hub, growing with its project count up to a cap", () => {
    const biggestProject = nodeRadius({ degree: 500, childCount: 500, isProject: true });
    expect(nodeRadius({ degree: 0, childCount: 0, organization: true })).toBeGreaterThan(biggestProject);
    expect(nodeRadius({ degree: 4, childCount: 4, organization: true })).toBeGreaterThan(nodeRadius({ degree: 1, childCount: 1, organization: true }));
    expect(nodeRadius({ degree: 50, childCount: 50, organization: true })).toBe(64);
  });

  it("sizes a hub with six children like a project hub", () => {
    expect(nodeRadius({ degree: 6, childCount: 6, isProject: true })).toBe(Math.min(40, 14 + Math.sqrt(6) * 4));
  });
});

describe("assignProjectAccents", () => {
  const keys = (n: number) => Array.from({ length: n }, (_, i) => `project-${i}`);
  const NEUTRAL_ACCENTS = ["gray", "mauve", "mist", "neutral", "olive", "slate", "stone", "taupe", "zinc"];

  it("is deterministic and independent of input order and duplicates", () => {
    const k = keys(30);
    const a = assignProjectAccents(k);
    const b = assignProjectAccents([...k].reverse().concat(k));
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
    expect(assignProjectAccents(k)).toEqual(a);
  });

  it("gives up to PROJECT_ACCENTS.length projects distinct accents, all chromatic", () => {
    for (const n of [1, 2, 5, PROJECT_ACCENTS.length]) {
      const m = assignProjectAccents(keys(n));
      expect(new Set([...m.values()].map((v) => v.accent)).size).toBe(n);
      for (const v of m.values()) {
        expect(PROJECT_ACCENTS).toContain(v.accent);
        expect(NEUTRAL_ACCENTS).not.toContain(v.accent);
        expect(v.shade).toBe(PROJECT_SHADES[0]);
      }
    }
    expect(PROJECT_ACCENTS).toHaveLength(16);
    expect(PROJECT_ACCENTS).not.toContain("amber");
  });

  it("opens a second tier with another shade beyond PROJECT_ACCENTS.length projects, keeping (accent, shade) pairs unique", () => {
    const m = assignProjectAccents(keys(PROJECT_ACCENTS.length + 3));
    const shades = new Set([...m.values()].map((v) => v.shade));
    expect(shades).toEqual(new Set([PROJECT_SHADES[0], PROJECT_SHADES[1]]));
    expect([...m.values()].filter((v) => v.shade === PROJECT_SHADES[1])).toHaveLength(3);
    expect(new Set([...m.values()].map((v) => `${v.accent}/${v.shade}`)).size).toBe(PROJECT_ACCENTS.length + 3);
  });

  it("probes with a stride so colliding keys land far apart, never on a neighbouring hue", () => {
    const n = PROJECT_ACCENTS.length;
    const bySlot = new Map<number, string[]>();
    for (let i = 0; bySlot.size < n || [...bySlot.values()].every((v) => v.length < 2); i++) {
      const k = `k${i}`;
      const slot = hashKey(k) % n;
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), k]);
      if (i > 5000) break;
    }
    const pair = [...bySlot.values()].find((v) => v.length >= 2)!;
    const m = assignProjectAccents(pair.slice(0, 2));
    const [a, b] = pair.slice(0, 2).map((k) => PROJECT_ACCENTS.indexOf(m.get(k)!.accent as (typeof PROJECT_ACCENTS)[number]));
    const d = Math.abs(a - b);
    expect(Math.min(d, n - d)).toBeGreaterThanOrEqual(3);
  });

  it("uses a probe stride coprime to the accent count and fills every slot with N colliding-free keys", () => {
    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
    expect(gcd(7, PROJECT_ACCENTS.length)).toBe(1);
    // keys that all start in slot 0 still get distinct accents
    const same: string[] = [];
    for (let i = 0; same.length < PROJECT_ACCENTS.length; i++) if (hashKey(`s${i}`) % PROJECT_ACCENTS.length === 0) same.push(`s${i}`);
    const m = assignProjectAccents(same);
    expect(new Set([...m.values()].map((v) => v.accent)).size).toBe(PROJECT_ACCENTS.length);
  });

  it("keeps a key's colour stable across calls and when it is alone", () => {
    const one = assignProjectAccents(["vt"]).get("vt")!;
    expect(assignProjectAccents(["vt"]).get("vt")).toEqual(one);
    expect(assignProjectAccents(["vt", "mnemonis"]).get("vt")).toBeDefined();
    expect(assignProjectAccents([]).size).toBe(0);
  });

  it("spreads keys across hues (not just alphabetically)", () => {
    const m = assignProjectAccents(["a", "b", "c", "d"]);
    expect([...m.values()].map((v) => v.accent)).not.toEqual(PROJECT_ACCENTS.slice(0, 4));
  });
});

describe("accentFill", () => {
  it("reads the per-element accent variable with a neutral fallback", () => {
    expect(accentFill(500)).toBe("var(--color-accent-500, #64748b)");
  });
});

describe("nodeRadius for category hubs and value nodes", () => {
  it("category hubs are bigger than a project hub with the same member count, up to the caps", () => {
    for (const n of [0, 1, 4, 9, 30, 100, 1000]) {
      const project = nodeRadius({ degree: n, childCount: n, isProject: true });
      const hub = nodeRadius({ degree: n, childCount: n, attr: "tag", attrRole: "category" });
      expect(hub).toBeGreaterThan(project);
      expect(hub).toBeGreaterThanOrEqual(project * 1.3);
    }
    expect(nodeRadius({ degree: 4, childCount: 4, attr: "type", attrRole: "category" })).toBeCloseTo(ATTRIBUTE_HUB_SCALE * (14 + 8));
  });

  it("category hubs grow with their values but are capped, and are bigger than any memory", () => {
    const hub = (n: number) => nodeRadius({ degree: n, childCount: n, attr: "type", attrRole: "category" });
    expect(hub(9)).toBeGreaterThan(hub(1));
    expect(hub(5000)).toBe(54);
    expect(hub(1)).toBeGreaterThan(nodeRadius({ degree: 99 }));
  });

  it("value nodes are a fixed size clearly smaller than the smallest memory node, whatever their member count", () => {
    const smallestMemory = nodeRadius({ degree: 0 });
    for (const n of [0, 1, 50, 5000]) {
      const r = nodeRadius({ degree: n, childCount: n, attr: "collection", attrRole: "value" });
      expect(r).toBe(VALUE_NODE_RADIUS);
      expect(r).toBeLessThanOrEqual(smallestMemory - 2);
    }
  });
});
