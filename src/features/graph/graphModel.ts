import { listMemories, listRelations, type MemoryStatus, type WorkspaceState } from "../../domain";

/** Pure graph model helpers: no React, no layout. Edges come only from stored relations. */

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
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  origin: "user" | "process";
  demo: boolean;
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
 * Nodes = current-branch memories (archived ones only when `showArchived`).
 * Edges = stored relations whose both endpoints are nodes.
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
    }));
  const degree = degrees(edges);
  const nodes: GraphNode[] = memories
    .map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      archived: m.archived,
      collectionId: m.collectionId,
      tags: m.tags,
      degree: degree.get(m.id) ?? 0,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
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
  const nodes = graph.nodes.filter((n) => nodeMatchesFilters(n, f));
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
