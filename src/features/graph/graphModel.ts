import { LIMITS, listMemories, listOrganizations, listRelations, projectOfMemory, type MemoryStatus, type Project, type WorkspaceState } from "../../domain";
import { STATUS_META, typeLabel } from "../../components/memoryMeta";
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
  /**
   * What this node's project is called in the graph (colours are keyed by it): the Project's id for a member of a real
   * Project, else the normalized title-prefix key (see `normalizeTitle`) of colon children, legacy followers, the
   * project's real memory (when it has members) and its virtual hub. Null otherwise. Independent of filters.
   */
  project: string | null;
  /** Display name of the real Project this node belongs to (null for prefix-only keys and non-members). */
  projectName?: string | null;
  /** Synthetic project hub (id `project:<projectId>`, or `project:<key>` for a prefix-only key with no Project): no memory is titled like the project yet. Never a real memory id. */
  virtual?: boolean;
  /** Optional attribute node (see `withAttributeNodes`): a big category hub (Types, Collections, ...) or a small value node (one collection, type, tag or status). Not a memory. */
  attr?: AttributeKind;
  /** Role of an attribute node: the big category hub, or a small value node around it. */
  attrRole?: "category" | "value";
  /** Organization hub (see `withOrganizationNodes`): a big circle above the project hubs. Not a memory; `degree` / `childCount` = its project count. */
  organization?: boolean;
}

export type AttributeKind = "collection" | "type" | "tag" | "status";
export const ATTRIBUTE_KINDS: readonly AttributeKind[] = ["collection", "type", "tag", "status"];
/** At most this many value nodes per category (most-used first). */
export const MAX_ATTRIBUTE_NODES = 60;

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
  /** Memory -> value node link, or value node -> category hub link (see `withAttributeNodes`): decoration only, never a relation. */
  attribute?: boolean;
  /** With `attribute`: this is a value node -> category hub link (the rest are memory -> value links). */
  category?: boolean;
  /** Project hub -> organization hub link (see `withOrganizationNodes`): decoration only, never a relation. */
  organization?: boolean;
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
  const { derived, hubs, projectOf, names } = derivedPrefixLinks(state, memories, edges);
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
      projectName: names.get(projectOf.get(m.id) ?? "") ?? null,
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
        projectName: names.get(projectOf.get(h.id) ?? "") ?? null,
        virtual: true,
      }),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { nodes, edges };
}

type AttributeGroup = { kind: AttributeKind; key: string; label: string; members: string[] };

/** Attribute values of one kind used by memories (never hubs or other attribute nodes), grouped by value node id, in a single pass. */
function groupAttributes(graph: Graph, kind: AttributeKind, collections: Record<string, { name: string }>): Map<string, AttributeGroup> {
  const groups = new Map<string, AttributeGroup>();
  const add = (m: GraphNode, key: string, label: string) => {
    const id = `${kind}:${key}`;
    const g = groups.get(id);
    if (g) g.members.push(m.id);
    else groups.set(id, { kind, key, label, members: [m.id] });
  };
  for (const m of graph.nodes) {
    if (m.virtual || m.attr || m.organization) continue;
    if (kind === "collection") {
      if (m.collectionId !== null) add(m, m.collectionId, Object.hasOwn(collections, m.collectionId) ? collections[m.collectionId].name : "Unknown collection");
    } else if (kind === "type") {
      add(m, m.type, typeLabel(m.type));
    } else if (kind === "status") {
      const status: MemoryStatus = m.archived ? "archived" : m.status;
      add(m, status, STATUS_META[status].label);
    } else {
      const seen = new Set<string>();
      for (const t of m.tags) {
        const key = t.trim().toLowerCase();
        if (key === "" || seen.has(key)) continue;
        seen.add(key);
        add(m, key, `#${key}`);
      }
    }
  }
  return groups;
}

/** Kinds that have at least one value with a linked memory in this (already filtered) graph: the only categories worth offering. */
export function availableAttributeKinds(graph: Graph, collections: Record<string, { name: string }>): AttributeKind[] {
  return ATTRIBUTE_KINDS.filter((k) => groupAttributes(graph, k, collections).size > 0);
}

export const ATTRIBUTE_CATEGORY_LABEL: Record<AttributeKind, string> = { collection: "Collections", type: "Types", status: "Statuses", tag: "Tags" };

/** Id of a category hub / value node: never a memory id (`mem_...`) nor a project hub id (`project:...`). */
export const categoryNodeId = (kind: AttributeKind): string => `category:${kind}`;

/**
 * Adds, for each chosen category (collection / type / status / tag), one big category hub (`category:<kind>`) with a small
 * value node per value that has at least one linked memory in `graph` (`collection:<id>`, `type:<type>`, `status:<s>`,
 * `tag:<tag>`; the MAX_ATTRIBUTE_NODES most-used per category). Edges: value -> category hub (`category`), and a light link
 * memory -> its value nodes (`attribute`). Memories only (never project hubs). Existing nodes and edges are untouched and an
 * empty selection (or nothing to show) returns the very same graph. Pass the already filtered graph.
 */
export function withAttributeNodes(graph: Graph, kinds: Iterable<AttributeKind>, collections: Record<string, { name: string }>): Graph {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return graph;
  const taken = new Set(graph.nodes.map((n) => n.id));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const make = (id: string, title: string, kind: AttributeKind, role: "category" | "value", count: number): GraphNode => ({
    id,
    title,
    type: kind,
    status: "saved",
    archived: false,
    collectionId: null,
    tags: [],
    degree: count,
    childCount: count,
    isProject: false,
    project: null,
    attr: kind,
    attrRole: role,
  });
  for (const kind of ATTRIBUTE_KINDS) {
    if (!wanted.has(kind)) continue;
    const chosen = [...groupAttributes(graph, kind, collections).entries()]
      .filter(([id]) => !taken.has(id))
      .sort((a, b) => b[1].members.length - a[1].members.length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, MAX_ATTRIBUTE_NODES)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const hubId = categoryNodeId(kind);
    if (chosen.length === 0 || taken.has(hubId)) continue;
    nodes.push(make(hubId, ATTRIBUTE_CATEGORY_LABEL[kind], kind, "category", chosen.length));
    for (const [id, g] of chosen) {
      nodes.push(make(id, g.label, kind, "value", g.members.length));
      edges.push({ id: `cat:${id}`, source: id, target: hubId, label: kind, origin: "process", demo: false, attribute: true, category: true });
      for (const memberId of g.members) {
        edges.push({ id: `attr:${id}:${memberId}`, source: memberId, target: id, label: kind, origin: "process", demo: false, attribute: true });
      }
    }
  }
  if (nodes.length === 0) return graph;
  return { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] };
}

/** Id prefix of organization hubs; no memory id, project hub id (`project:`), category or value node id starts with it. */
export const ORGANIZATION_NODE_PREFIX = "org:";
export const organizationNodeId = (organizationId: string): string => `${ORGANIZATION_NODE_PREFIX}${organizationId}`;
/** At most this many organization hubs are drawn (the workspace itself caps organizations at LIMITS.maxOrganizations). */
export const MAX_ORGANIZATION_NODES = LIMITS.maxOrganizations;

/**
 * Adds one big organization hub (`org:<organizationId>`, labelled with the organization's name; `degree` = its number of
 * projects) per organization of `state` (the oldest MAX_ORGANIZATION_NODES), always, plus a link from every project hub
 * of `graph` (a virtual hub, or the memory titled like the project) to the hub of the project's organization.
 * Organization hubs are not memories: they never get a project colour, and callers keep counting, clustering and searching
 * on the graph WITHOUT them. Existing nodes and edges are untouched (an id already taken is skipped) and a workspace
 * without organizations returns the very same graph. Pass the graph that is drawn (after the attribute nodes).
 */
export function withOrganizationNodes(graph: Graph, state: WorkspaceState): Graph {
  const organizations = listOrganizations(state).slice(0, MAX_ORGANIZATION_NODES);
  if (organizations.length === 0) return graph;
  const taken = new Set(graph.nodes.map((n) => n.id));
  const projectsOf = new Map<string, string[]>();
  for (const p of Object.values(state.projects)) {
    if (p.organizationId === null || p.organizationId === undefined) continue;
    const list = projectsOf.get(p.organizationId);
    if (list) list.push(p.id);
    else projectsOf.set(p.organizationId, [p.id]);
  }
  // project id -> its hub nodes in this graph (a real parent memory and / or the virtual hub)
  const hubsOf = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!n.isProject || n.project === null || n.attr || n.organization) continue;
    const list = hubsOf.get(n.project);
    if (list) list.push(n.id);
    else hubsOf.set(n.project, [n.id]);
  }
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const o of organizations) {
    const id = organizationNodeId(o.id);
    if (taken.has(id)) continue;
    const members = projectsOf.get(o.id) ?? [];
    nodes.push({
      id,
      title: o.name,
      type: "organization",
      status: "saved",
      archived: false,
      collectionId: null,
      tags: [],
      degree: members.length,
      childCount: members.length,
      isProject: false,
      project: null,
      organization: true,
    });
    for (const projectId of members) {
      for (const hub of hubsOf.get(projectId) ?? []) {
        edges.push({ id: `org:${o.id}:${hub}`, source: hub, target: id, label: "organization", origin: "process", demo: false, organization: true });
      }
    }
  }
  if (nodes.length === 0) return graph;
  return { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] };
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");
/** Longest key (in characters) the legacy "<project> ..." follower scan looks for: bounds the work per title. */
const MAX_PREFIX_SCAN = 100;

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
 * - A memory of a real Project (projectOfMemory: its projectId, else its title prefix / exact name) is a member of
 *   that project whatever its title says. Other colon children `<project>: <data>` form a prefix-only group.
 * - Members link to every visible memory titled like the project's key (a real parent), else to a hub node:
 *   `project:<projectId>` for a real Project, the virtual `project:<key>` for a prefix-only key.
 * - Legacy followers (`<project> ...` / `<project>, ...`, no colon) link to the longest key that has a real parent
 *   or at least one member.
 * Also returns `projectOf` (node id -> project value, see GraphNode.project) for every member, real parent with
 * members, and hub, and `names` (project value -> Project name) for real Projects.
 * A real parent's own project is its key even if its title is itself a member of another project.
 * Titles longer than LIMITS.title are never scanned and legacy followers only look at the first MAX_PREFIX_SCAN
 * characters, so a hostile title cannot cost more than a bounded amount of work.
 */
function derivedPrefixLinks(
  state: WorkspaceState,
  memories: { id: string; title: string; projectId?: string | null }[],
  stored: GraphEdge[],
): { derived: GraphEdge[]; hubs: { id: string; title: string }[]; projectOf: Map<string, string>; names: Map<string, string> } {
  const real = new Map<string, string[]>();
  for (const m of memories) {
    if (m.title.length > LIMITS.title) continue;
    const key = normalizeTitle(m.title);
    real.set(key, [...(real.get(key) ?? []), m.id]);
  }
  // Any stored "part of" link (even a manual one) suppresses the derived edge, but only title-prefix-provenance links count toward isProject/childCount.
  const have = new Set(stored.filter((e) => e.label === TITLE_PREFIX_LABEL).map((e) => `${e.source}>${e.target}`));

  const hasProjects = Object.keys(state.projects).length > 0;
  /** group key -> the real Project that group is (its current key). */
  const projectOfKey = new Map<string, Project>();
  const colon = new Map<string, { id: string; raw: string }[]>();
  const colonOf = new Set<string>();
  const join = (key: string, id: string, raw: string): void => {
    colonOf.add(id);
    colon.set(key, [...(colon.get(key) ?? []), { id, raw }]);
  };
  for (const m of memories) {
    if (m.title.length > LIMITS.title) continue;
    const pr = hasProjects ? projectOfMemory(state, m) : null;
    if (pr) {
      projectOfKey.set(pr.key, pr);
      // The memory titled exactly like the project is its real parent, not a member of itself.
      if (normalizeTitle(m.title) === pr.key) continue;
      join(pr.key, m.id, pr.name);
      continue;
    }
    const project = parseTitlePrefix(m.title);
    if (project === null) continue;
    // `http://a.com` is a URL, not a `<project>: <data>` title.
    if (m.title.slice(m.title.indexOf(":") + 1).startsWith("//")) continue;
    join(normalizeTitle(project), m.id, collapse(project));
  }

  const keys = [...new Set([...colon.keys(), ...real.keys()])].filter((k) => k !== "").sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const keySet = new Set(keys);
  const legacy = new Map<string, { id: string; raw: string }[]>();
  for (const m of memories) {
    if (colonOf.has(m.id) || m.title.length > LIMITS.title) continue;
    // Match on the collapsed title itself (not its lowercase form, whose length can differ, e.g. "İ"), longest key first.
    const c = collapse(m.title);
    let found: { key: string; raw: string } | undefined;
    for (let n = Math.min(c.length - 1, MAX_PREFIX_SCAN); n > 0 && !found; n--) {
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
  const names = new Map<string, string>();
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
    const pr = projectOfKey.get(key);
    const value = pr ? pr.id : key;
    if (pr) names.set(value, pr.name);
    const parents = real.get(key) ?? [];
    const followers = (legacy.get(key) ?? []).filter((f) => !parents.includes(f.id));
    const children = colon.get(key) ?? [];
    if (parents.length > 0) {
      if (children.length + followers.length > 0) {
        for (const c of [...children, ...followers]) if (!projectOf.has(c.id)) projectOf.set(c.id, value);
        for (const p of parents) projectOf.set(p, value);
      }
      for (const c of [...children, ...followers]) for (const p of parents) link(c.id, p);
    } else if ((pr || !key.includes("/")) && children.length > 0) {
      // A prefix-only key never collides with a real Project's hub id.
      const id = `${PROJECT_NODE_PREFIX}${pr ? pr.id : Object.hasOwn(state.projects, key) ? `key:${key}` : key}`;
      hubs.push({ id, title: pr ? pr.name : displayName([...children, ...followers].map((c) => c.raw)) });
      projectOf.set(id, value);
      for (const c of [...children, ...followers]) if (!projectOf.has(c.id)) projectOf.set(c.id, value);
      for (const c of [...children, ...followers]) link(c.id, id);
    }
  }
  return { derived: derived.sort(byId), hubs, projectOf, names };
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
