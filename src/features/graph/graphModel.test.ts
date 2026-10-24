import { describe, expect, it } from "vitest";
import { createSeedWorkspace } from "../../data/seed";
import { archiveMemory, createSequentialContext, listRelations } from "../../domain";
import {
  buildGraph,
  clusters,
  connectedComponents,
  degrees,
  filterGraph,
  isolatedNodes,
  searchNodes,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from "./graphModel";

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  title: id.toUpperCase(),
  type: "fact",
  status: "committed",
  archived: false,
  collectionId: null,
  tags: [],
  degree: 0,
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

describe("buildGraph (seed)", () => {
  const state = createSeedWorkspace();

  it("builds nodes from current-branch memories and edges only from stored relations", () => {
    const g = buildGraph(state);
    expect(g.nodes).toHaveLength(18);
    expect(g.nodes.some((n) => n.id === "mem_research_ranking")).toBe(false); // lives on another branch
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
    expect(g.nodes.find((n) => n.id === "mem_proj_mnemonis")!.degree).toBe(7);
    expect(isolatedNodes(g.nodes).map((n) => n.id).sort()).toEqual(["mem_pref_writing", "mem_profile"]);
  });

  it("finds one big cluster and two singletons", () => {
    const g = buildGraph(state);
    const comps = connectedComponents(g.nodes, g.edges);
    expect(comps.map((c) => c.length)).toEqual([16, 1, 1]);
    expect(clusters(g.nodes, g.edges)).toHaveLength(1);
  });

  it("hides archived memories (and their edges) unless toggled", () => {
    const ctx = createSequentialContext("2026-10-01T00:00:00.000Z");
    const archived = archiveMemory(state, ctx, { id: "mem_dec_zustand", author: "t" }).state;
    const hidden = buildGraph(archived);
    expect(hidden.nodes.some((n) => n.id === "mem_dec_zustand")).toBe(false);
    expect(hidden.edges).toHaveLength(14); // two relations touched it
    const shown = buildGraph(archived, { showArchived: true });
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
      node("b", { collectionId: "c1", tags: ["y"], type: "task", status: "draft" }),
      node("c", { collectionId: "c2", tags: ["x"], type: "fact" }),
    ];
    const g: Graph = { nodes, edges: [edge("a", "b"), edge("a", "c")] };
    expect(filterGraph(g, {})).toBe(g);
    expect(filterGraph(g, { collectionId: "c1" }).nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(filterGraph(g, { collectionId: "c1" }).edges).toHaveLength(1);
    expect(filterGraph(g, { tag: "x" }).nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(filterGraph(g, { type: "task" }).nodes.map((n) => n.id)).toEqual(["b"]);
    expect(filterGraph(g, { status: "draft" }).nodes.map((n) => n.id)).toEqual(["b"]);
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
