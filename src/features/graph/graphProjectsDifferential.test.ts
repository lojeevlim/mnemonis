import { describe, expect, it } from "vitest";
import v2Prefixes from "../../domain/__fixtures__/v2-prefixes.json";
import {
  createEmptyWorkspace,
  createMemory,
  createProject,
  renameProject,
  createSequentialContext,
  deriveProjectsFromPrefixes,
  findProjectByKey,
  listMemories,
  migrateWorkspaceState,
  type DomainContext,
  type WorkspaceState,
} from "../../domain";
import { normalizeTitle, parseTitlePrefix, TITLE_PREFIX_LABEL } from "../../domain/titlePrefix";
import { buildGraph, type GraphEdge } from "./graphModel";

/**
 * Differential test: REFERENCE is the title-prefix derivation the graph used before Projects existed (copied
 * verbatim, only typed). For a state migrated from v2 (projects derived from the very same prefixes) the new graph
 * must draw exactly the same derived edges, with each virtual hub `project:<key>` now named `project:<projectId>`.
 */
const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function referenceDerived(memories: { id: string; title: string }[]): { edges: [string, string][]; hubs: string[] } {
  const real = new Map<string, string[]>();
  for (const m of memories) {
    const key = normalizeTitle(m.title);
    real.set(key, [...(real.get(key) ?? []), m.id]);
  }
  const colon = new Map<string, { id: string; raw: string }[]>();
  const colonOf = new Set<string>();
  for (const m of memories) {
    const project = parseTitlePrefix(m.title);
    if (project === null) continue;
    if (m.title.slice(m.title.indexOf(":") + 1).startsWith("//")) continue;
    colonOf.add(m.id);
    const key = normalizeTitle(project);
    colon.set(key, [...(colon.get(key) ?? []), { id: m.id, raw: collapse(project) }]);
  }
  const keys = [...new Set([...colon.keys(), ...real.keys()])].filter((k) => k !== "").sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const keySet = new Set(keys);
  const legacy = new Map<string, { id: string; raw: string }[]>();
  for (const m of memories) {
    if (colonOf.has(m.id)) continue;
    const c = collapse(m.title);
    let found: { key: string; raw: string } | undefined;
    for (let n = c.length - 1; n > 0 && !found; n--) {
      if (c[n] !== " " && c[n] !== ",") continue;
      const raw = c.slice(0, n);
      const k = raw.toLowerCase();
      if (keySet.has(k) && !k.includes("/")) found = { key: k, raw };
    }
    if (found === undefined) continue;
    legacy.set(found.key, [...(legacy.get(found.key) ?? []), { id: m.id, raw: found.raw }]);
  }
  const edges: [string, string][] = [];
  const hubs: string[] = [];
  const link = (child: string, parent: string): void => {
    if (parent !== child) edges.push([child, parent]);
  };
  for (const key of keys) {
    const parents = real.get(key) ?? [];
    const followers = (legacy.get(key) ?? []).filter((f) => !parents.includes(f.id));
    const children = colon.get(key) ?? [];
    if (parents.length > 0) {
      for (const c of [...children, ...followers]) for (const p of parents) link(c.id, p);
    } else if (!key.includes("/") && children.length > 0) {
      const id = `project:${key}`;
      hubs.push(id);
      for (const c of [...children, ...followers]) link(c.id, id);
    }
  }
  return { edges, hubs };
}

function compare(state: WorkspaceState): void {
  const memories = listMemories(state).filter((m) => !m.archived);
  const ref = referenceDerived(memories);
  const mapId = (id: string): string => {
    if (!id.startsWith("project:")) return id;
    const p = findProjectByKey(state, id.slice("project:".length));
    return p ? `project:${p.id}` : id;
  };
  const graph = buildGraph(state);
  const derived = graph.edges.filter((e: GraphEdge) => e.derived);
  const got = derived.map((e) => `${e.source}>${e.target}|${e.label}|${e.prefix}|${e.origin}`).sort();
  // A stored "part of" relation (even a manual one) suppresses the derived edge, in the old code and the new.
  const stored = new Set(Object.values(state.relations).filter((r) => r.label === TITLE_PREFIX_LABEL).map((r) => `${r.fromId}>${r.toId}`));
  const want = ref.edges
    .filter(([s, t]) => !stored.has(`${s}>${t}`))
    .map(([s, t]) => `${s}>${mapId(t)}|${TITLE_PREFIX_LABEL}|true|process`)
    .sort();
  expect(got).toEqual(want);
  expect(graph.nodes.filter((n) => n.virtual).map((n) => n.id).sort()).toEqual(ref.hubs.map(mapId).sort());
  // every virtual hub of a migrated state is a real Project's hub, named like it
  for (const n of graph.nodes.filter((x) => x.virtual && x.id.startsWith("project:prj_"))) {
    expect(state.projects[n.id.slice("project:".length)].name).toBe(n.title);
  }
  expect(graph.edges.map((e) => e.id)).toEqual(expect.arrayContaining(derived.map((e) => e.id)));
  expect(derived.slice().sort(byId).map((e) => e.id)).toEqual(derived.map((e) => e.id)); // deterministic order
}

describe("graph edges: migrated v2 state == the pre-Projects derivation", () => {
  it("v2-prefixes fixture", () => {
    const r = migrateWorkspaceState(JSON.parse(JSON.stringify(v2Prefixes)));
    if (!r.ok) throw new Error(r.reason);
    expect(Object.keys(r.state.projects).length).toBeGreaterThan(0);
    compare(r.state);
  });

  it("randomized prefix / legacy / parent / URL / slash titles", () => {
    const words = ["acme", "Acme", "ACME", "beta", "gamma delta", "a/b", "x"];
    const shapes = (w: string, n: number): string[] => [`${w}: note ${n}`, `${w} notes ${n}`, `${w}, more ${n}`, w, `${w}:http://x/${n}`, `${w}:   `];
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      const ctx: DomainContext = createSequentialContext();
      let state = createEmptyWorkspace();
      for (let i = 0; i < 4 + rnd(10); i++) {
        const w = words[rnd(words.length)];
        const options = shapes(w, i);
        const title = options[rnd(options.length)];
        state = createMemory(state, ctx, { title, actor: { kind: "user", name: "u" }, projectId: null, collectionId: null }).state;
      }
      compare(deriveProjectsFromPrefixes(state));
    }
  });

  it("without any Project the fallback hubs keep their old ids", () => {
    const ctx = createSequentialContext();
    let state = createEmptyWorkspace();
    state = createMemory(state, ctx, { title: "Acme: one", actor: { kind: "user", name: "u" }, projectId: null }).state;
    const g = buildGraph(state);
    expect(g.nodes.filter((n) => n.virtual).map((n) => [n.id, n.project, n.projectName])).toEqual([["project:acme", "acme", null]]);
  });
});

describe("real Projects in the graph", () => {
  const user = { kind: "user", name: "u" } as const;
  const setup = () => {
    const ctx = createSequentialContext();
    const p = createProject(createEmptyWorkspace(), ctx, { name: "Acme", actor: user });
    return { ctx, state: p.state, project: p.value };
  };

  it("a member with any title joins its Project's hub `project:<projectId>`; the colour key is the project id", () => {
    const { ctx, state, project } = setup();
    const a = createMemory(state, ctx, { title: "Billing notes", projectId: project.id, actor: user });
    const b = createMemory(a.state, ctx, { title: "Acme: login", actor: user });
    const c = createMemory(b.state, ctx, { title: "Loose note", projectId: null, collectionId: null, actor: user });
    const g = buildGraph(c.state);
    const hub = g.nodes.find((n) => n.virtual)!;
    expect(hub).toMatchObject({ id: `project:${project.id}`, title: "Acme", project: project.id, projectName: "Acme", isProject: true, childCount: 2 });
    expect(g.edges.filter((e) => e.derived).map((e) => [e.source, e.target]).sort()).toEqual(
      [[a.value.id, hub.id], [b.value.id, hub.id]].sort(),
    );
    expect(g.nodes.find((n) => n.id === a.value.id)).toMatchObject({ project: project.id, projectName: "Acme" });
    expect(g.nodes.find((n) => n.id === c.value.id)).toMatchObject({ project: null, projectName: null });
  });

  it("a rename keeps the same hub id and colour key, and the old name still groups", () => {
    const { ctx, state, project } = setup();
    const a = createMemory(state, ctx, { title: "Acme: one", actor: user });
    const r = renameProject(a.state, { id: project.id, name: "Acme Inc", actor: user }, ctx);
    const g = buildGraph(r.state);
    expect(g.nodes.find((n) => n.virtual)).toMatchObject({ id: `project:${project.id}`, title: "Acme Inc", project: project.id });
  });

  it("a memory titled like the project stays its real parent (no virtual hub)", () => {
    const { ctx, state, project } = setup();
    const parent = createMemory(state, ctx, { title: "Acme", actor: user });
    const child = createMemory(parent.state, ctx, { title: "Roadmap", projectId: project.id, actor: user });
    const g = buildGraph(child.state);
    expect(g.nodes.some((n) => n.virtual)).toBe(false);
    expect(g.edges.some((e) => e.source === child.value.id && e.target === parent.value.id && e.prefix)).toBe(true);
    expect(g.nodes.find((n) => n.id === parent.value.id)).toMatchObject({ project: project.id, isProject: true });
  });

  it("long hostile titles are not scanned (bounded work)", () => {
    const { ctx, state } = setup();
    const ids = Array.from({ length: 5 }, (_, i) => `mem_long${i}`);
    let s = state;
    for (const id of ids) {
      const base = createMemory(s, ctx, { id, title: "x", actor: user });
      s = base.state;
    }
    // Bypass the write limits the way an old import could have: rewrite the saved snapshots with huge titles.
    const revisions = { ...s.revisions };
    for (const r of Object.values(revisions)) if (ids.includes(r.memoryId)) revisions[r.id] = { ...r, snapshot: { ...r.snapshot, title: `${"a ".repeat(100_000)}: tail` } };
    const t0 = performance.now();
    const g = buildGraph({ ...s, revisions });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(g.edges.filter((e) => e.derived)).toEqual([]);
  });
});
