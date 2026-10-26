import { describe, expect, it } from "vitest";
import { createSeedWorkspace } from "../../data/seed";
import {
  archiveMemory,
  createEmptyWorkspace,
  createMemory,
  addRelation,
  createSequentialContext,
  listRelations,
  type WorkspaceState,
} from "../../domain";
import {
  buildGraph,
  clusters,
  connectedComponents,
  degrees,
  filterGraph,
  isolatedNodes,
  searchNodes,
  availableAttributeKinds,
  withAttributeNodes,
  MAX_ATTRIBUTE_NODES,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from "./graphModel";

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  title: id.toUpperCase(),
  type: "fact",
  status: "saved",
  archived: false,
  collectionId: null,
  tags: [],
  degree: 0,
  childCount: 0,
  isProject: false,
  project: null,
  ...extra,
});
const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  label: "rel",
  origin: "user",
  demo: false,
});

/** The graph without view-only items: real memories and stored relations. */
const storedOnly = (g: Graph): Graph => ({ nodes: g.nodes.filter((n) => !n.virtual), edges: g.edges.filter((e) => !e.derived) });

describe("buildGraph (seed)", () => {
  const state = createSeedWorkspace();

  it("builds nodes from saved memories and edges only from stored relations", () => {
    const g = storedOnly(buildGraph(state));
    expect(g.nodes).toHaveLength(18);
    expect(g.nodes.some((n) => n.id === "mem_research_ranking")).toBe(false); // only a pending proposal in the Inbox: not saved, so not in the graph
    expect(g.edges).toHaveLength(listRelations(state).length);
    expect(g.edges).toHaveLength(16);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
      expect(state.relations[e.id]).toBeDefined();
    }
  });

  it("computes degree and isolated memories", () => {
    const g = buildGraph(state);
    expect(g.nodes.find((n) => n.id === "mem_proj_mnemonis")!.degree).toBe(8); // 7 stored + 1 derived edge to the "Project" hub
    expect(isolatedNodes(g.nodes).map((n) => n.id).sort()).toEqual(["mem_pref_writing", "mem_profile"]);
  });

  it("finds one big cluster and two singletons", () => {
    const g = storedOnly(buildGraph(state));
    const comps = connectedComponents(g.nodes, g.edges);
    expect(comps.map((c) => c.length)).toEqual([16, 1, 1]);
    expect(clusters(g.nodes, g.edges)).toHaveLength(1);
  });

  it("draws a virtual hub for each repeated generic prefix (Decision:, Meeting:, ...)", () => {
    const g = buildGraph(state);
    const hubs = g.nodes.filter((n) => n.virtual).map((n) => `${n.title}:${n.childCount}`);
    expect(hubs.sort()).toEqual(["Decision:3", "Meeting:2", "Procedure:2", "Project:1", "Reference:1", "Research:2", "Task:2"]);
    expect(g.edges.filter((e) => e.derived)).toHaveLength(13);
  });

  it("hides archived memories (and their edges) unless toggled", () => {
    // Ids must not collide with the seed's own sequential ids (rev_1, ...).
    const base = createSequentialContext("2026-10-01T00:00:00.000Z");
    const ctx = { now: base.now, newId: (prefix: string) => `test_${base.newId(prefix)}` };
    const archived = archiveMemory(state, ctx, { id: "mem_dec_zustand", actor: { kind: "user", name: "t" } }).state;
    const hidden = storedOnly(buildGraph(archived));
    expect(hidden.nodes.some((n) => n.id === "mem_dec_zustand")).toBe(false);
    expect(hidden.edges).toHaveLength(14); // two relations touched it
    const shown = storedOnly(buildGraph(archived, { showArchived: true }));
    const n = shown.nodes.find((x) => x.id === "mem_dec_zustand")!;
    expect(n.archived).toBe(true);
    expect(shown.edges).toHaveLength(16);
  });

  it("drops relations whose endpoint is not a visible memory", () => {
    const rel = Object.values(state.relations)[0];
    const broken = { ...state, relations: { ...state.relations, x: { ...rel, id: "x", toId: "ghost" } } };
    expect(buildGraph(broken).edges.some((e) => e.id === "x")).toBe(false);
  });
});

describe("pure helpers", () => {
  it("degrees counts both endpoints", () => {
    expect(Object.fromEntries(degrees([edge("a", "b"), edge("b", "c")]))).toEqual({ a: 1, b: 2, c: 1 });
  });

  it("connectedComponents orders by size then id and ignores dangling edges", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => node(id));
    const comps = connectedComponents(nodes, [edge("a", "b"), edge("b", "c"), edge("d", "zzz")]);
    expect(comps).toEqual([["a", "b", "c"], ["d"], ["e"]]);
  });

  it("filters by collection, tag, type and status, keeping only inner edges", () => {
    const nodes = [
      node("a", { collectionId: "c1", tags: ["X"], type: "fact" }),
      node("b", { collectionId: "c1", tags: ["y"], type: "task", status: "pending" }),
      node("c", { collectionId: "c2", tags: ["x"], type: "fact" }),
    ];
    const g: Graph = { nodes, edges: [edge("a", "b"), edge("a", "c")] };
    expect(filterGraph(g, {})).toBe(g);
    expect(filterGraph(g, { collectionId: "c1" }).nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(filterGraph(g, { collectionId: "c1" }).edges).toHaveLength(1);
    expect(filterGraph(g, { tag: "x" }).nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(filterGraph(g, { type: "task" }).nodes.map((n) => n.id)).toEqual(["b"]);
    expect(filterGraph(g, { status: "pending" }).nodes.map((n) => n.id)).toEqual(["b"]);
    expect(filterGraph(g, { type: "fact", collectionId: "c2" }).nodes.map((n) => n.id)).toEqual(["c"]);
  });

  it("searchNodes ranks title prefix > title substring > tag/type", () => {
    const nodes = [
      node("1", { title: "My postgres notes" }),
      node("2", { title: "Postgres decision" }),
      node("3", { title: "Other", tags: ["postgres"] }),
      node("4", { title: "Unrelated" }),
    ];
    expect(searchNodes(nodes, "postgres")).toEqual(["2", "1", "3"]);
    expect(searchNodes(nodes, "  ")).toEqual([]);
    expect(searchNodes(nodes, "nothing")).toEqual([]);
  });
});

describe("title-prefix edges", () => {
  const actor = { kind: "user", name: "t" } as const;
  const ctx = createSequentialContext("2026-10-01T00:00:00.000Z");
  const make = (state: WorkspaceState, id: string, title: string) =>
    createMemory(state, ctx, { id, title, content: "x", actor }).state;
  /** Memories only; the stored auto-relations are dropped to mimic memories saved before the feature. */
  const unlinked = (titles: [string, string][]): WorkspaceState => {
    let s = createEmptyWorkspace();
    for (const [id, title] of titles) s = make(s, id, title);
    return { ...s, relations: {} };
  };
  const base: [string, string][] = [
    ["p", "VT"],
    ["c1", "VT: run build"],
    ["c2", "vt : deploy"],
    ["o", "Other"],
  ];

  it("derives child -> project edges (case-insensitive) when nothing is stored", () => {
    const g = buildGraph(unlinked(base));
    expect(g.edges.map((e) => e.id)).toEqual(["prefix:c1:p", "prefix:c2:p"]);
    expect(g.edges[0]).toMatchObject({ source: "c1", target: "p", label: "part of", origin: "process", derived: true, prefix: true });
  });

  it("does not duplicate a pair that already has a stored relation", () => {
    const stored = buildGraph(make(unlinked(base), "c3", "VT: docs")); // autoRelate stores c3 -> p
    const derived = stored.edges.filter((e) => e.derived).map((e) => e.id);
    expect(derived).toEqual(["prefix:c1:p", "prefix:c2:p"]);
    const real = stored.edges.filter((e) => !e.derived);
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ source: "c3", target: "p", prefix: true });
    expect(stored.nodes.find((n) => n.id === "p")).toMatchObject({ isProject: true, childCount: 3 });
  });

  it("flags hubs and counts children, degree and components", () => {
    const g = buildGraph(unlinked(base));
    expect(g.nodes.find((n) => n.id === "p")).toMatchObject({ isProject: true, childCount: 2, degree: 2 });
    expect(g.nodes.find((n) => n.id === "c1")).toMatchObject({ isProject: false, childCount: 0, degree: 1 });
    expect(isolatedNodes(g.nodes).map((n) => n.id)).toEqual(["o"]);
    expect(connectedComponents(g.nodes, g.edges)).toEqual([["c1", "c2", "p"], ["o"]]);
    expect(clusters(g.nodes, g.edges)).toHaveLength(1);
  });

  it("ignores an archived project unless showArchived", () => {
    const s = unlinked(base);
    const archived = archiveMemory(s, ctx, { id: "p", actor }).state;
    const hidden = buildGraph(archived);
    // The hidden parent no longer counts: its two children form a virtual hub instead.
    expect(hidden.edges.map((e) => e.id)).toEqual(["prefix:c1:project:vt", "prefix:c2:project:vt"]);
    expect(hidden.nodes.filter((n) => n.isProject).map((n) => n.id)).toEqual(["project:vt"]);
    const shown = buildGraph(archived, { showArchived: true });
    expect(shown.edges.map((e) => e.id)).toEqual(["prefix:c1:p", "prefix:c2:p"]);
    expect(shown.nodes.find((n) => n.id === "p")!.isProject).toBe(true);
    expect(shown.nodes.some((n) => n.virtual)).toBe(false);
  });

  it("keeps derived edges consistent with filterGraph", () => {
    const g = buildGraph(unlinked(base));
    expect(filterGraph(g, { type: "nope" })).toEqual({ nodes: [], edges: [] });
    const f = filterGraph({ nodes: g.nodes.map((n) => (n.id === "c2" ? { ...n, tags: ["k"] } : n)), edges: g.edges }, { tag: "k" });
    expect(f.edges).toEqual([]); // the project is filtered out, so its derived edge goes too
    expect(filterGraph(g, { type: "fact" }).edges).toHaveLength(2);
  });

  it("shows a stored topic link as a normal edge, not a prefix edge", () => {
    let s = createEmptyWorkspace();
    s = createMemory(s, ctx, { id: "a", title: "A: billing", tags: ["stripe"], actor }).state;
    s = createMemory(s, ctx, { id: "b", title: "B: checkout", tags: ["stripe"], actor }).state;
    const g = storedOnly(buildGraph(s));
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: "b", target: "a", label: "shares topic: stripe", origin: "process" });
    expect(g.edges[0].prefix).toBeUndefined();
    expect(g.edges[0].derived).toBeUndefined();
    expect(g.nodes.every((n) => !n.virtual && !n.isProject)).toBe(true);
  });

  it("flags a stored title-prefix relation with prefix: true", () => {
    const g = buildGraph(make(unlinked(base), "c3", "VT: docs"));
    expect(g.edges.find((e) => !e.derived)).toMatchObject({ source: "c3", target: "p", prefix: true });
  });

  it("lets a stored manual part-of link suppress the derived edge without counting as a hub child", () => {
    const s = unlinked([
      ["p", "VT"],
      ["c1", "VT: run build"],
    ]);
    const withManual = addRelation(s, ctx, {
      fromId: "c1",
      toId: "p",
      label: "part of",
      provenance: { origin: "user", createdBy: "t" },
      actor,
    }).state;
    const g = buildGraph(withManual);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].derived).toBeUndefined();
    expect(g.edges[0].prefix).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "p")).toMatchObject({ isProject: false, childCount: 0 });
  });

  it("derives one edge per same-titled parent", () => {
    const g = buildGraph(
      unlinked([
        ["p1", "VT"],
        ["p2", "VT"],
        ["c", "VT: x"],
      ]),
    );
    expect(g.edges.map((e) => e.id)).toEqual(["prefix:c:p1", "prefix:c:p2"]);
  });

  it("never derives an edge to itself", () => {
    // The edge goes to the virtual hub, never from a memory to itself.
    expect(buildGraph(unlinked([["a", "A: A"]])).edges.map((e) => [e.source, e.target])).toEqual([["a", "project:a"]]);
  });

  it("derives edges from legacy followers of a real parent", () => {
    const g = buildGraph(unlinked([["p", "VT"], ["l1", "VT run, build, test"], ["l2", "VT project overview"], ["x", "VTX other"]]));
    expect(g.edges.map((e) => e.id)).toEqual(["prefix:l1:p", "prefix:l2:p"]);
    expect(g.nodes.some((n) => n.virtual)).toBe(false);
  });
});

describe("virtual project hubs", () => {
  const actor = { kind: "user", name: "t" } as const;
  const ctx = createSequentialContext("2026-10-01T00:00:00.000Z");
  const unlinked = (titles: [string, string][]): WorkspaceState => {
    let s = createEmptyWorkspace();
    for (const [id, title] of titles) s = createMemory(s, ctx, { id, title, content: "x", actor }).state;
    return { ...s, relations: {} };
  };
  // The user's real workspace: no memory titled "VT".
  const user: [string, string][] = [
    ["a", "vt: ticket selling feature flow and gotchas"],
    ["b", "vt: conductor payout flow (Stripe Connect)"],
    ["c", "VT run, build, test"],
    ["d", "VT project overview"],
    ["e", "VT coding conventions"],
    ["f", "VT new-developer first steps"],
  ];

  it("groups the user's six VT memories under one hub named VT", () => {
    const g = buildGraph(unlinked(user));
    const hubs = g.nodes.filter((n) => n.virtual);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]).toMatchObject({
      id: "project:vt",
      title: "VT", // 4 legacy "VT" votes beat 2 colon "vt" votes
      type: "project",
      status: "saved",
      archived: false,
      collectionId: null,
      tags: [],
      isProject: true,
      virtual: true,
      childCount: 6,
      degree: 6,
    });
    expect(g.edges.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e", "f"].map((id) => `prefix:${id}:project:vt`));
    expect(g.edges[0]).toMatchObject({ source: "a", target: "project:vt", label: "part of", origin: "process", derived: true, prefix: true, demo: false });
    expect(g.nodes).toHaveLength(7);
    expect(connectedComponents(g.nodes, g.edges)).toEqual([["a", "b", "c", "d", "e", "f", "project:vt"]]);
    expect(isolatedNodes(g.nodes)).toEqual([]);
    expect(clusters(g.nodes, g.edges)).toHaveLength(1);
  });

  it("forms a hub from a single colon child, but not from legacy followers alone", () => {
    expect(buildGraph(unlinked([["c", "VT run"], ["d", "VT overview"], ["e", "VT notes"]])).nodes.some((n) => n.virtual)).toBe(false);
    const single = buildGraph(unlinked([["a", "VT: only one"]]));
    expect(single.nodes.find((n) => n.virtual)).toMatchObject({ id: "project:vt", title: "VT", isProject: true, virtual: true, childCount: 1, degree: 1 });
    expect(single.edges.map((e) => e.id)).toEqual(["prefix:a:project:vt"]);
    expect(connectedComponents(single.nodes, single.edges)).toEqual([["a", "project:vt"]]);
    // One colon child plus one follower makes two members.
    const g = buildGraph(unlinked([["a", "VT: one"], ["c", "VT overview"]]));
    expect(g.nodes.filter((n) => n.virtual).map((n) => n.id)).toEqual(["project:vt"]);
  });

  it("requires a word boundary for legacy followers", () => {
    const g = buildGraph(unlinked([["a", "VT: one"], ["b", "VT: two"], ["c", "VTX overview"], ["d", "VT-overview"]]));
    expect(g.edges.map((e) => e.id)).toEqual(["prefix:a:project:vt", "prefix:b:project:vt"]);
  });

  it("makes no virtual hub when a real parent exists", () => {
    const g = buildGraph(unlinked([["p", "VT"], ...user]));
    expect(g.nodes.some((n) => n.virtual)).toBe(false);
    expect(g.edges.every((e) => e.target === "p" && e.derived)).toBe(true);
    expect(g.edges).toHaveLength(6);
    expect(g.nodes.find((n) => n.id === "p")).toMatchObject({ isProject: true, childCount: 6 });
  });

  it("picks the display name by count, then uppercase, then alphabetical", () => {
    const name = (titles: string[]) =>
      buildGraph(unlinked(titles.map((t, i) => [`m${i}`, t] as [string, string]))).nodes.find((n) => n.virtual)!.title;
    expect(name(["Vt: a", "Vt: b", "VT: c"])).toBe("Vt");
    expect(name(["vt: a", "VT: b"])).toBe("VT");
    expect(name(["Vt: a", "vT: b"])).toBe("Vt");
    expect(name(["vt: a", "vt: b", "VT: c"])).toBe("vt");
  });

  it("ignores archived members unless showArchived", () => {
    const s = archiveMemory(unlinked(user), ctx, { id: "c", actor }).state;
    expect(buildGraph(s).nodes.find((n) => n.virtual)).toMatchObject({ childCount: 5 });
    expect(buildGraph(s, { showArchived: true }).nodes.find((n) => n.virtual)).toMatchObject({ childCount: 6 });
    let two = archiveMemory(unlinked(user), ctx, { id: "a", actor }).state;
    for (const id of ["c", "d", "e", "f"]) two = archiveMemory(two, ctx, { id, actor }).state;
    expect(buildGraph(two).nodes.find((n) => n.virtual)).toMatchObject({ childCount: 1 }); // one member left, still a hub
    const none = archiveMemory(two, ctx, { id: "b", actor }).state;
    expect(buildGraph(none).nodes.some((n) => n.virtual)).toBe(false);
  });

  it("keeps a hub while a member passes the filters", () => {
    const g = buildGraph(unlinked(user));
    const tagged: Graph = { ...g, nodes: g.nodes.map((n) => (n.id === "a" ? { ...n, tags: ["k"] } : n)) };
    const f = filterGraph(tagged, { tag: "k" });
    expect(f.nodes.map((n) => n.id).sort()).toEqual(["a", "project:vt"]);
    expect(f.edges.map((e) => e.id)).toEqual(["prefix:a:project:vt"]);
    expect(filterGraph(tagged, { tag: "none" }).nodes).toEqual([]);
    expect(filterGraph(g, { type: "fact" }).nodes).toHaveLength(7);
    expect(filterGraph(g, { type: "project" }).nodes).toEqual([]); // the hub's own type does not keep it
  });

  it("does not treat URLs or slash keys as projects", () => {
    expect(buildGraph(unlinked([["a", "http://a.com"], ["b", "http://b.com"]])).nodes.some((n) => n.virtual)).toBe(false);
    expect(buildGraph(unlinked([["a", "https://a.com/x"], ["b", "https://b.com/y"], ["c", "https://c.com"]])).edges).toEqual([]);
    expect(buildGraph(unlinked([["a", "a/b: one"], ["b", "a/b: two"], ["c", "a/b notes"]])).nodes.some((n) => n.virtual)).toBe(false);
    // A real project still forms next to URL-looking titles.
    const g = buildGraph(unlinked([["a", "VT: one"], ["b", "VT: two"], ["c", "http://x.com"]]));
    expect(g.nodes.filter((n) => n.virtual).map((n) => n.id)).toEqual(["project:vt"]);
  });

  it("derives the display name without assuming toLowerCase keeps the length", () => {
    const g = buildGraph(unlinked([["a", "İ: one"], ["b", "İ run"], ["c", "İ build"]]));
    expect(g.nodes.find((n) => n.virtual)).toMatchObject({ title: "İ", childCount: 3 });
  });

  it("keeps a hub through filterGraph while a member passes", () => {
    let s = unlinked(user.slice(0, 2));
    s = createMemory(s, ctx, { id: "t", title: "vt: tagged", content: "x", tags: ["k"], actor }).state;
    const g = buildGraph({ ...s, relations: {} });
    const f = filterGraph(g, { tag: "k" });
    expect(f.nodes.map((n) => n.id).sort()).toEqual(["project:vt", "t"]);
    expect(f.edges.map((e) => e.id)).toEqual(["prefix:t:project:vt"]);
  });

  it("is replaced by the real memory (no duplicate hub or edges) once it is created", () => {
    const colonOnly = unlinked(user.slice(0, 2));
    expect(buildGraph(colonOnly).nodes.some((n) => n.virtual)).toBe(true);
    const created = createMemory(colonOnly, ctx, { id: "hub", title: "vt", content: "x", type: "project", actor }).state;
    const g = buildGraph(created);
    expect(g.nodes.some((n) => n.virtual)).toBe(false);
    expect(g.edges.map((e) => e.id).sort()).toEqual(Object.keys(created.relations).sort()); // stored only, nothing derived
    expect(g.edges.every((e) => e.target === "hub" && !e.derived && e.prefix)).toBe(true);
    expect(g.nodes.find((n) => n.id === "hub")).toMatchObject({ isProject: true, childCount: 2 });
  });
});

describe("node.project", () => {
  const actor = { kind: "user", name: "t" } as const;
  const ctx = createSequentialContext("2026-10-01T00:00:00.000Z");
  const unlinked = (titles: [string, string][], extra: Record<string, { tags: string[] }> = {}): WorkspaceState => {
    let s = createEmptyWorkspace();
    for (const [id, title] of titles) s = createMemory(s, ctx, { id, title, content: "x", tags: extra[id]?.tags, actor }).state;
    return { ...s, relations: {} };
  };
  const projectOf = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!.project;

  it("is the key for a colon child, a real parent with members and a legacy follower; null for unrelated memories", () => {
    const g = buildGraph(unlinked([["p", "VT"], ["c", "Vt : run"], ["l", "VT notes"], ["o", "Other"], ["u", "http://x.com"]]));
    expect(projectOf(g, "p")).toBe("vt");
    expect(projectOf(g, "c")).toBe("vt");
    expect(projectOf(g, "l")).toBe("vt");
    expect(projectOf(g, "o")).toBeNull();
    expect(projectOf(g, "u")).toBeNull();
  });

  it("is null for a real memory titled like a project but without members", () => {
    expect(projectOf(buildGraph(unlinked([["p", "VT"], ["o", "Other"]])), "p")).toBeNull();
  });

  it("is set on a virtual hub and its members", () => {
    const g = buildGraph(unlinked([["a", "VT: one"], ["b", "VT two"], ["c", "AB: x"]]));
    expect(projectOf(g, "project:vt")).toBe("vt");
    expect(projectOf(g, "a")).toBe("vt");
    expect(projectOf(g, "project:ab")).toBe("ab");
    // a lone legacy follower of no known project stays unassigned
    expect(projectOf(g, "b")).toBe("vt");
  });

  it("is the same when stored relations exist", () => {
    let s = createEmptyWorkspace();
    s = createMemory(s, ctx, { id: "p", title: "VT", content: "x", actor }).state;
    s = createMemory(s, ctx, { id: "c", title: "VT: run", content: "x", actor }).state;
    expect(listRelations(s).length).toBeGreaterThan(0);
    const g = buildGraph(s);
    expect([projectOf(g, "p"), projectOf(g, "c")]).toEqual(["vt", "vt"]);
  });

  it("does not change when filters hide other nodes", () => {
    const g = buildGraph(unlinked([["a", "VT: one"], ["b", "VT: two"], ["c", "AB: x"]], { b: { tags: ["k"] } }));
    const f = filterGraph(g, { tag: "k" });
    expect(f.nodes.map((n) => n.id).sort()).toEqual(["b", "project:vt"]);
    for (const n of f.nodes) expect(n.project).toBe(g.nodes.find((m) => m.id === n.id)!.project);
    expect(projectOf(f, "b")).toBe("vt");
  });
});

describe("withAttributeNodes", () => {
  const collections = { c1: { name: "Work" }, __proto__x: { name: "Odd" } };
  const base = (): Graph => ({
    nodes: [
      node("a", { collectionId: "c1", tags: ["Red", "blue"], type: "fact" }),
      node("b", { collectionId: "c1", tags: ["red"], type: "task", status: "pending" }),
      node("c", { tags: ["solo", "RED"], type: "fact", archived: true, status: "saved" }),
      node("project:p", { virtual: true, isProject: true, type: "project", tags: ["red"], collectionId: "c1" }),
    ],
    edges: [edge("a", "b")],
  });
  const ids = (g: Graph) => g.nodes.filter((n) => n.attr).map((n) => n.id).sort();
  const hubEdges = (g: Graph, hub: string) => g.edges.filter((e) => e.attribute && e.target === hub).map((e) => e.source).sort();

  it("returns the very same graph with no kind (nodes and edges byte-identical)", () => {
    const g = base();
    const before = JSON.stringify(g);
    expect(withAttributeNodes(g, null, collections)).toBe(g);
    expect(JSON.stringify(withAttributeNodes(g, null, collections))).toBe(before);
  });

  it("adds collection hubs and member edges; memories without a collection get none; project hubs never", () => {
    const g = withAttributeNodes(base(), "collection", collections);
    expect(ids(g)).toEqual(["collection:c1"]);
    expect(g.nodes.find((n) => n.id === "collection:c1")!.title).toBe("Work");
    expect(hubEdges(g, "collection:c1")).toEqual(["a", "b"]);
  });

  it("adds type hubs", () => {
    const g = withAttributeNodes(base(), "type", collections);
    expect(ids(g)).toEqual(["type:fact", "type:task"]); // not the project hub's "project" type
    expect(hubEdges(g, "type:fact")).toEqual(["a", "c"]);
  });

  it("adds status hubs derived from the archived flag and status", () => {
    const g = withAttributeNodes(base(), "status", collections);
    expect(ids(g)).toEqual(["status:archived", "status:pending", "status:saved"]);
    expect(g.edges.find((e) => e.attribute && e.source === "c")!.target).toBe("status:archived");
  });

  it("adds a tag hub for every tag with a memory (even one), case-insensitively and once per memory", () => {
    const g = withAttributeNodes(base(), "tag", collections);
    expect(ids(g)).toEqual(["tag:blue", "tag:red", "tag:solo"]);
    expect(hubEdges(g, "tag:red")).toEqual(["a", "b", "c"]);
    expect(hubEdges(g, "tag:solo")).toEqual(["c"]);
  });

  it("only ever adds one kind of hub at a time and every member sits on its hub", () => {
    for (const kind of ["collection", "type", "tag", "status"] as const) {
      const g = withAttributeNodes(base(), kind, collections);
      expect(g.nodes.filter((n) => n.attr).every((n) => n.attr === kind && n.id.startsWith(`${kind}:`))).toBe(true);
      for (const e of g.edges.filter((x) => x.attribute)) expect(e.target.startsWith(`${kind}:`)).toBe(true);
    }
  });

  it("makes hubs bigger by member count and never creates a hub without members", () => {
    const g = withAttributeNodes(base(), "type", collections);
    for (const n of g.nodes.filter((x) => x.attr)) {
      expect(n.childCount).toBe(hubEdges(g, n.id).length);
      expect(n.childCount).toBeGreaterThan(0);
    }
  });

  it("leaves existing nodes, edges, degrees and counts untouched", () => {
    const g = base();
    for (const kind of ["collection", "type", "tag", "status"] as const) {
      const out = withAttributeNodes(g, kind, collections);
      expect(out.nodes.slice(0, g.nodes.length)).toEqual(g.nodes);
      expect(out.edges.slice(0, g.edges.length)).toEqual(g.edges);
      const memories = out.nodes.filter((n) => !n.attr);
      expect(connectedComponents(memories, out.edges.filter((e) => !e.attribute))).toEqual(connectedComponents(g.nodes, g.edges));
      expect(new Set(out.nodes.map((n) => n.id)).size).toBe(out.nodes.length);
    }
  });

  it("caps each kind at the most-used hubs", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => node(`m${i}`, { collectionId: `col${i}`, tags: [`t${i}`, "common", `pair${i % 50}`, `alt${i % 49}`] }));
    const many = Object.fromEntries(nodes.map((n) => [n.collectionId!, { name: n.collectionId! }]));
    const gc = withAttributeNodes({ nodes, edges: [] }, "collection", many);
    const gt = withAttributeNodes({ nodes, edges: [] }, "tag", many);
    expect(ids(gc)).toHaveLength(MAX_ATTRIBUTE_NODES);
    expect(ids(gt)).toHaveLength(MAX_ATTRIBUTE_NODES);
    expect(ids(gt)).toContain("tag:common"); // most used survives the cap
  });

  it("uses safe keys for odd names and unknown collections", () => {
    const odd = { nodes: [node("a", { collectionId: "__proto__", tags: ["__proto__", "constructor"] }), node("b", { collectionId: "ghost", tags: ["__proto__", "constructor"] })], edges: [] };
    const gc = withAttributeNodes(odd, "collection", collections);
    expect(ids(gc)).toEqual(["collection:__proto__", "collection:ghost"]);
    expect(gc.nodes.find((n) => n.id === "collection:__proto__")!.title).toBe("Unknown collection");
    expect(ids(withAttributeNodes(odd, "tag", collections))).toEqual(["tag:__proto__", "tag:constructor"]);
  });

  it("hides hubs whose members are all filtered out (filter first, then add)", () => {
    const filtered = filterGraph(base(), { type: "task" });
    expect(ids(withAttributeNodes(filtered, "type", collections))).toEqual(["type:task"]);
    expect(ids(withAttributeNodes(filtered, "collection", collections))).toEqual(["collection:c1"]);
    expect(ids(withAttributeNodes(filtered, "tag", collections))).toEqual(["tag:red"]);
  });

  it("returns the same graph when the kind has no hub", () => {
    const g: Graph = { nodes: [node("a", { tags: [] })], edges: [] };
    expect(withAttributeNodes(g, "collection", collections)).toBe(g);
    expect(withAttributeNodes(g, "tag", collections)).toBe(g);
  });
});

describe("availableAttributeKinds", () => {
  const collections = { c1: { name: "Work" } };
  it("lists only kinds with at least one hub", () => {
    const none: Graph = { nodes: [node("a", { tags: [] })], edges: [] };
    expect(availableAttributeKinds(none, collections)).toEqual(["type", "status"]);
    const all: Graph = { nodes: [node("a", { tags: ["x"], collectionId: "c1" })], edges: [] };
    expect(availableAttributeKinds(all, collections)).toEqual(["collection", "type", "tag", "status"]);
  });

  it("ignores project hubs and is empty without memories", () => {
    const hubOnly: Graph = { nodes: [node("project:p", { virtual: true, isProject: true, tags: ["x"], collectionId: "c1" })], edges: [] };
    expect(availableAttributeKinds(hubOnly, collections)).toEqual([]);
    expect(availableAttributeKinds({ nodes: [], edges: [] }, collections)).toEqual([]);
  });

  it("follows the filters", () => {
    const g: Graph = { nodes: [node("a", { type: "fact", tags: ["x"], collectionId: "c1" }), node("b", { type: "task", tags: [] })], edges: [] };
    expect(availableAttributeKinds(filterGraph(g, { type: "task" }), collections)).toEqual(["type", "status"]);
  });
});
