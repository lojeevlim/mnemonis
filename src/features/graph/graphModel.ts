import { listMemories, listRelations, type MemoryStatus, type WorkspaceState } from "../../domain";
import { TITLE_PREFIX_LABEL, TITLE_PREFIX_PROCESS, normalizeTitle, parseTitlePrefix } from "../../domain/titlePrefix";

/** Pure graph model helpers: no React, no layout. Edges are stored relations plus view-only title-prefix links. */

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  status: MemoryStatus;
  archived: boolean;
  collectionId: string | null;
  tags: string[];
  /** Number of visible relations touching this node (in the graph it was built from). */
  degree: number;
  /** Number of visible `<this title>: ...` memories linked to this node by a title-prefix edge. */
  childCount: number;
  /** Project hub: at least one title-prefix edge points to this node. */
  isProject: boolean;
  /** Normalized project key this node belongs to (see `normalizeTitle`): colon children, legacy followers, the project's real memory (when it has members) and its virtual hub. Null otherwise. Independent of filters. */
  project: string | null;
  /** Synthetic project hub (id `project:<key>`): no memory is titled like the project yet. Never a real memory id. */
  virtual?: boolean;
}

/** Id prefix of virtual project hubs; real memory ids never use it. */
export const PROJECT_NODE_PREFIX = "project:";
export const isVirtualNodeId = (id: string): boolean => id.startsWith(PROJECT_NODE_PREFIX);

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  origin: "user" | "process";
  demo: boolean;
  /** Title-prefix link (stored or derived), child -> project. */
  prefix?: boolean;
  /** View-only edge computed from titles; has no stored relation (never removable). */
  derived?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFilters {
  collectionId?: string;
  tag?: string;
  type?: string;
  status?: MemoryStatus;
}

/**
 * Nodes = saved memories (archived ones only when `showArchived`).
 * Edges = stored relations whose both endpoints are nodes, plus derived (view-only) title-prefix edges
 * `<project>: <data>` -> `<project>` for pairs that have no stored title-prefix relation yet.
 */
export function buildGraph(state: WorkspaceState, opts: { showArchived?: boolean } = {}): Graph {
  const memories = listMemories(state).filter((m) => opts.showArchived || !m.archived);
  const ids = new Set(memories.map((m) => m.id));
  const edges: GraphEdge[] = listRelations(state)
    .filter((r) => ids.has(r.fromId) && ids.has(r.toId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      id: r.id,
      source: r.fromId,
      target: r.toId,
      label: r.label,
      origin: r.provenance.origin,
      demo: !!r.provenance.demo,
      ...(r.label === TITLE_PREFIX_LABEL && r.provenance.process === TITLE_PREFIX_PROCESS ? { prefix: true } : {}),
    }));
  const { derived, hubs, projectOf } = derivedPrefixLinks(memories, edges);
  edges.push(...derived);
  const degree = degrees(edges);
  const children = new Map<string, number>();
  for (const e of edges) if (e.prefix) children.set(e.target, (children.get(e.target) ?? 0) + 1);
  const nodes: GraphNode[] = [
    ...memories.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      archived: m.archived,
      collectionId: m.collectionId,
      tags: m.tags,
      degree: degree.get(m.id) ?? 0,
      childCount: children.get(m.id) ?? 0,
      isProject: children.has(m.id),
      project: projectOf.get(m.id) ?? null,
    })),
    ...hubs.map(
      (h): GraphNode => ({
        id: h.id,
        title: h.title,
        type: "project",
        status: "saved",
        archived: false,
        collectionId: null,
        tags: [],
        degree: degree.get(h.id) ?? 0,
        childCount: children.get(h.id) ?? 0,
        isProject: true,
        project: projectOf.get(h.id) ?? null,
        virtual: true,
      }),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");

/** Most common raw casing; ties go to the variant with uppercase letters, then alphabetical. */
function displayName(votes: string[]): string {
  const count = new Map<string, number>();
  for (const v of votes) count.set(v, (count.get(v) ?? 0) + 1);
  const hasUpper = (v: string): boolean => v !== v.toLowerCase();
  return [...count.entries()].sort(
    (a, b) => b[1] - a[1] || Number(hasUpper(b[0])) - Number(hasUpper(a[0])) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  )[0][0];
}

/**
 * View-only child -> project "part of" edges, minus pairs that already have a stored "part of" relation.
 * - Colon children `<project>: <data>` link to every visible memory titled `<project>`.
 * - Legacy followers (`<project> ...` / `<project>, ...`, no colon) link to the longest project key that has a
 *   real parent or at least one colon child.
 * - A key with no real parent and >= 1 colon child gets a virtual hub (`project:<key>`).
 * Also returns `projectOf` (node id -> project key) for every member, real parent with members, and virtual hub.
 * A real parent's own project is its key even if its title is itself a member of another project.
 */
function derivedPrefixLinks(
  memories: { id: string; title: string }[],
  stored: GraphEdge[],
): { derived: GraphEdge[]; hubs: { id: string; title: string }[]; projectOf: Map<string, string> } {
  const real = new Map<string, string[]>();
  for (const m of memories) {
    const key = normalizeTitle(m.title);
    real.set(key, [...(real.get(key) ?? []), m.id]);
  }
  // Any stored "part of" link (even a manual one) suppresses the derived edge, but only title-prefix-provenance links count toward isProject/childCount.
  const have = new Set(stored.filter((e) => e.label === TITLE_PREFIX_LABEL).map((e) => `${e.source}>${e.target}`));

  const colon = new Map<string, { id: string; raw: string }[]>();
  const colonOf = new Set<string>();
  for (const m of memories) {
    const project = parseTitlePrefix(m.title);
    if (project === null) continue;
    // `http://a.com` is a URL, not a `<project>: <data>` title.
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
    // Match on the collapsed title itself (not its lowercase form, whose length can differ, e.g. "İ"), longest key first.
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

  const derived: GraphEdge[] = [];
  const hubs: { id: string; title: string }[] = [];
  const projectOf = new Map<string, string>();
  const link = (childId: string, parentId: string): void => {
    if (parentId === childId || have.has(`${childId}>${parentId}`)) return;
    derived.push({
      id: `prefix:${childId}:${parentId}`,
      source: childId,
      target: parentId,
      label: TITLE_PREFIX_LABEL,
      origin: "process",
      demo: false,
      prefix: true,
      derived: true,
    });
  };
  for (const key of keys) {
    const parents = real.get(key) ?? [];
    const followers = (legacy.get(key) ?? []).filter((f) => !parents.includes(f.id));
    const children = colon.get(key) ?? [];
    if (parents.length > 0) {
      if (children.length + followers.length > 0) {
        for (const c of [...children, ...followers]) if (!projectOf.has(c.id)) projectOf.set(c.id, key);
        for (const p of parents) projectOf.set(p, key);
      }
      for (const c of [...children, ...followers]) for (const p of parents) link(c.id, p);
    } else if (!key.includes("/") && children.length > 0) {
      const id = `${PROJECT_NODE_PREFIX}${key}`;
      hubs.push({ id, title: displayName([...children, ...followers].map((c) => c.raw)) });
      projectOf.set(id, key);
      for (const c of [...children, ...followers]) if (!projectOf.has(c.id)) projectOf.set(c.id, key);
      for (const c of [...children, ...followers]) link(c.id, id);
    }
  }
  return { derived: derived.sort(byId), hubs, projectOf };
}

export function degrees(edges: GraphEdge[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
}

/** Memories with no visible relation at all. */
export function isolatedNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.filter((n) => n.degree === 0);
}

/**
 * Connected components (undirected), each as a sorted id list. Ordered by size
 * descending, then by first id for determinism. Includes singletons.
 */
export function connectedComponents(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    const g = groups.get(r);
    if (g) g.push(n.id);
    else groups.set(r, [n.id]);
  }
  return [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/** Clusters = components with at least two memories. */
export function clusters(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  return connectedComponents(nodes, edges).filter((c) => c.length > 1);
}

export function nodeMatchesFilters(n: GraphNode, f: GraphFilters): boolean {
  if (f.collectionId && n.collectionId !== f.collectionId) return false;
  if (f.type && n.type !== f.type) return false;
  if (f.status && n.status !== f.status) return false;
  if (f.tag && !n.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  return true;
}

/** Keeps matching nodes and the edges between them. Node degrees are left untouched. */
export function filterGraph(graph: Graph, f: GraphFilters): Graph {
  if (!f.collectionId && !f.type && !f.status && !f.tag) return graph;
  // A virtual hub has no type/tags of its own: it stays while at least one of its members passes.
  const passing = new Set(graph.nodes.filter((n) => !n.virtual && nodeMatchesFilters(n, f)).map((n) => n.id));
  const withMember = new Set(graph.edges.filter((e) => passing.has(e.source)).map((e) => e.target));
  const nodes = graph.nodes.filter((n) => (n.virtual ? withMember.has(n.id) : passing.has(n.id)));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/**
 * Ids matching a free-text query (title, type, tags), best matches first:
 * title prefix, then title substring, then type/tag. Empty query matches nothing.
 */
export function searchNodes(nodes: GraphNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, GraphNode][] = [];
  for (const n of nodes) {
    const title = n.title.toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score = 3;
    else if (title.includes(q)) score = 2;
    else if (n.type.replace(/_/g, " ").toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))) score = 1;
    if (score) scored.push([score, n]);
  }
  return scored.sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1)).map(([, n]) => n.id);
}
