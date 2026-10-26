import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Checkbox, Drawer, EmptyState, Input, Modal, SearchInput, Select } from "lojee-ui";
import { listMemories, type MemoryStatus, type WorkspaceState } from "../../domain";
import { normalizeTitle, TITLE_PREFIX_LABEL, TITLE_PREFIX_PROCESS } from "../../domain/titlePrefix";
import { useAction } from "../../components/hooks";
import { PageHeader } from "../../components/PageHeader";
import { STATUS_META, typeLabel } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "../../components/InlineError";
import { useInlineAction } from "../../components/useInlineAction";
import { MemoryDetail } from "../memories/MemoryDetail";
import { GraphCanvas, type FocusRequest } from "./GraphCanvas";
import { GraphSidePanel, type OrganizationSelection } from "./GraphSidePanel";
import { assignProjectAccents } from "./graphStyle";
import {
  buildGraph,
  clusters as findClusters,
  filterGraph,
  isolatedNodes,
  isVirtualNodeId,
  ORGANIZATION_NODE_PREFIX,
  searchNodes,
  availableAttributeKinds,
  withAttributeNodes,
  withOrganizationNodes,
  type AttributeKind,
  type Graph,
  type GraphFilters,
  type GraphNode,
} from "./graphModel";
import { usePrefersReducedMotion } from "./useReducedMotion";

const ALL = "";
const DEFAULT_LABEL = "related to";
const STATUSES = Object.keys(STATUS_META) as MemoryStatus[];

function hubSelection(graph: Graph, hub: GraphNode): { hub: GraphNode; members: GraphNode[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const members = graph.edges
    .filter((e) => e.target === hub.id)
    .map((e) => byId.get(e.source))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  return { hub, members };
}

/** A value node lists its linked memories; a category hub lists its value nodes. */
function attributeSelection(graph: Graph, node: GraphNode): { node: GraphNode; members: GraphNode[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const category = node.attrRole === "category";
  // A collection is not linked to its memories by edges; it carries their ids.
  if (node.memberIds) {
    const members = node.memberIds
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => !!n)
      .sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
    return { node, members };
  }
  const members = graph.edges
    .filter((e) => e.attribute && !!e.category === category && e.target === node.id)
    .map((e) => byId.get(e.source))
    .filter((n): n is GraphNode => !!n)
    .sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  return { node, members };
}

/** An organization hub lists its projects (with their memory counts) and the memories of those projects. */
function organizationSelection(state: WorkspaceState, graph: Graph, node: GraphNode): OrganizationSelection {
  const organizationId = node.id.slice(ORGANIZATION_NODE_PREFIX.length);
  const projects = Object.values(state.projects)
    .filter((p) => p.organizationId === organizationId)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const ids = new Set(projects.map((p) => p.id));
  const memories = graph.nodes
    .filter((n) => !n.virtual && !n.attr && !n.organization && n.project !== null && ids.has(n.project))
    .sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  const count = new Map<string, number>();
  for (const m of memories) count.set(m.project!, (count.get(m.project!) ?? 0) + 1);
  return { node, projects: projects.map((p) => ({ id: p.id, name: p.name, count: count.get(p.id) ?? 0 })), memories };
}

export function GraphPage() {
  const state = useWorkspace((s) => s.state);
  const addRelation = useWorkspace((s) => s.addRelation);
  const removeRelation = useWorkspace((s) => s.removeRelation);
  const createMemory = useWorkspace((s) => s.createMemory);
  const act = useAction();
  const reducedMotion = usePrefersReducedMotion();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [highlightIsolated, setHighlightIsolated] = useState(false);
  const [activeClusterKey, setActiveClusterKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [confirmEdgeId, setConfirmEdgeId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [attributeId, setAttributeId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [creatingHub, setCreatingHub] = useState(false);
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const creatingHubRef = useRef(false);

  const filters: GraphFilters = {
    type: params.get("type") || undefined,
    collectionId: params.get("collection") || undefined,
    status: (params.get("status") || undefined) as MemoryStatus | undefined,
    tag: params.get("tag") || undefined,
  };
  const openId = params.get("memory");
  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const requestFocus = (ids: string[]) => setFocus((f) => ({ ids, nonce: (f?.nonce ?? 0) + 1 }));

  const archivedVisible = showArchived || filters.status === "archived";
  const base = useMemo(() => (state ? buildGraph(state, { showArchived: archivedVisible }) : null), [state, archivedVisible]);
  const { type, collectionId, status, tag } = filters;
  const graph = useMemo(
    () => (base ? filterGraph(base, { type, collectionId, status, tag }) : null),
    [base, type, collectionId, status, tag],
  );
  // Category hubs and value nodes are always added, on the filtered graph, so a value whose memories are all filtered out never shows
  // and a category with no value is not drawn. Counts, clusters and search keep using `graph`.
  const attributeKinds = useMemo(
    () => new Set<AttributeKind>(graph && state ? availableAttributeKinds(graph, state.collections) : []),
    [graph, state],
  );
  // Organization hubs are added last and only for drawing: counts, clusters, isolated memories and search use `graph`.
  const shown = useMemo(
    () => (graph && state ? withOrganizationNodes(withAttributeNodes(graph, attributeKinds, state.collections), state) : null),
    [graph, state, attributeKinds],
  );
  // Colours come from every project, archived memories included, so neither filters nor the archived toggle recolour anything.
  const projectAccents = useMemo(() => {
    if (!state || !base) return assignProjectAccents([]);
    const all = archivedVisible ? base : buildGraph(state, { showArchived: true });
    return assignProjectAccents(all.nodes.flatMap((n) => (n.project === null ? [] : [n.project])));
  }, [state, base, archivedVisible]);
  const clusterList = useMemo(() => (graph ? findClusters(graph.nodes, graph.edges) : []), [graph]);
  const isolated = useMemo(() => (graph ? isolatedNodes(graph.nodes) : []), [graph]);
  const matches = useMemo(() => (graph ? searchNodes(graph.nodes, query) : []), [graph, query]);

  const options = useMemo(() => {
    const nodes = (base?.nodes ?? []).filter((n) => !n.virtual);
    const tags = new Map<string, string>();
    for (const n of nodes) for (const t of n.tags) if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    return {
      types: [...new Set(nodes.map((n) => n.type))].sort(),
      tags: [...tags.values()].sort((a, b) => a.localeCompare(b)),
    };
  }, [base]);

  // A `project:` selection whose hub is gone (member deleted, renamed or archived) is a dead selection: clear it.
  const staleHubId = openId && isVirtualNodeId(openId) && base && !base.nodes.some((n) => n.id === openId) ? openId : null;
  useEffect(() => {
    if (staleHubId) setParam("memory", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleHubId]);

  if (!state || !base || !graph || !shown) return null;

  const collections = Object.values(state.collections);
  const withCurrent = (values: string[], current: string) =>
    current && !values.includes(current) ? [...values, current] : values;
  const filtered = !!(type || collectionId || status || tag);
  const titleOf = (id: string) => base.nodes.find((n) => n.id === id)?.title ?? state.memories[id]?.id ?? id;

  const activeClusterIndex = activeClusterKey ? clusterList.findIndex((c) => c[0] === activeClusterKey) : -1;
  const activeCluster = activeClusterIndex >= 0 ? clusterList[activeClusterIndex] : null;
  const edge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : undefined;

  const attributeNode = attributeId ? shown.nodes.find((n) => n.id === attributeId && n.attr) : undefined;
  const selectedAttribute = attributeNode ? attributeSelection(shown, attributeNode) : null;

  const organizationNode = organizationId ? shown.nodes.find((n) => n.id === organizationId && n.organization) : undefined;
  const selectedOrganization = organizationNode ? organizationSelection(state, shown, organizationNode) : null;

  let emphasis: Set<string> | null = null;
  if (query.trim()) emphasis = new Set(matches);
  else if (selectedOrganization) {
    const projectIds = new Set(selectedOrganization.projects.map((p) => p.id));
    emphasis = new Set([
      selectedOrganization.node.id,
      ...shown.nodes.filter((n) => n.project !== null && projectIds.has(n.project)).map((n) => n.id),
    ]);
  } else if (selectedAttribute) emphasis = new Set([selectedAttribute.node.id, ...selectedAttribute.members.map((m) => m.id)]);
  else if (activeCluster) emphasis = new Set(activeCluster);
  else if (highlightIsolated) emphasis = new Set(isolated.map((n) => n.id));
  const highlightIds = highlightIsolated ? new Set(isolated.map((n) => n.id)) : null;

  const clearFilters = () => {
    setQuery("");
    setActiveClusterKey(null);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ["type", "collection", "status", "tag"]) next.delete(k);
        return next;
      },
      { replace: true },
    );
  };

  const resetLink = () => {
    setLinkSource(null);
    setLinkTarget(null);
    setLinkNotice(null);
  };
  const toggleLinkMode = () => {
    setLinkMode((on) => !on);
    resetLink();
    setSelectedEdgeId(null);
    setParam("memory", null);
  };

  const selectNode = (id: string) => {
    const org = shown.nodes.find((n) => n.id === id && n.organization);
    if (org) {
      if (linkMode) {
        setLinkNotice(`"${org.title}" is an organization, not a memory, so it cannot be linked.`);
        return;
      }
      setSelectedEdgeId(null);
      setHubNotice(null);
      setAttributeId(null);
      setOrganizationId(id);
      setParam("memory", null);
      return;
    }
    const attr = shown.nodes.find((n) => n.id === id && n.attr);
    if (attr) {
      if (linkMode) {
        setLinkNotice(`"${attr.title}" is ${attr.attrRole === "category" ? "a category" : `a ${attr.attr}`}, not a memory, so it cannot be linked.`);
        return;
      }
      setSelectedEdgeId(null);
      setHubNotice(null);
      setOrganizationId(null);
      setAttributeId(id);
      setParam("memory", null);
      return;
    }
    setAttributeId(null);
    setOrganizationId(null);
    if (linkMode) {
      if (isVirtualNodeId(id)) {
        const hub = base.nodes.find((n) => n.id === id);
        setLinkNotice(`${hub ? `"${hub.title}"` : "A project hub"} is not a memory yet, so it cannot be linked. Create the memory first.`);
        return;
      }
      setLinkNotice(null);
      if (!linkSource) setLinkSource(id);
      else if (id === linkSource) resetLink();
      else setLinkTarget(id);
      return;
    }
    setSelectedEdgeId(null);
    setHubNotice(null);
    setParam("memory", id);
  };
  const selectEdge = (id: string) => {
    if (linkMode) return;
    setAttributeId(null);
    setOrganizationId(null);
    setParam("memory", null);
    setSelectedEdgeId(id);
  };
  const clearSelection = () => {
    setSelectedEdgeId(null);
    setAttributeId(null);
    setOrganizationId(null);
    if (!linkMode) setParam("memory", null);
  };

  const confirmEdge = confirmEdgeId ? state.relations[confirmEdgeId] : undefined;
  const removeConfirmed = async () => {
    if (!confirmEdgeId) return;
    const { ok } = await act(() => removeRelation(confirmEdgeId), "Relation removed");
    if (ok) {
      setConfirmEdgeId(null);
      setSelectedEdgeId(null);
    }
  };

  const isEmpty = base.nodes.length === 0;
  const memoryCount = graph.nodes.filter((n) => !n.virtual).length;
  const hubNode = openId && isVirtualNodeId(openId) ? graph.nodes.find((n) => n.id === openId && n.virtual) : undefined;
  const selectedHub = hubNode ? hubSelection(graph, hubNode) : null;
  const createHub = async (hub: { title: string }) => {
    if (creatingHubRef.current) return;
    creatingHubRef.current = true;
    setHubNotice(null);
    setCreatingHub(true);
    try {
      const key = normalizeTitle(hub.title);
      const existing = listMemories(state, { includePending: true }).find((m) => normalizeTitle(m.title) === key);
      if (existing) {
        const where = existing.archived ? "archived" : existing.status === "pending" ? "pending" : "saved";
        setHubNotice(`A memory titled '${existing.title}' already exists (${where}).`);
        return;
      }
      // As the user, so it saves at once; autoRelate then stores the "part of" relations and the virtual hub is replaced.
      const { ok, value } = await act(
        () =>
          createMemory({ title: hub.title, content: `Project hub for ${hub.title} memories.`, type: "project", tags: [hub.title] }),
        "Memory created",
      );
      if (ok && value) setParam("memory", value.id);
    } finally {
      creatingHubRef.current = false;
      setCreatingHub(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-4">
      <PageHeader
        title="Knowledge Graph"
        description={'Memories and the relations you or your agents have stored between them. Memories are grouped around their project, drawn as a big circle even when no memory is titled like the project. The project is detected from the repository an agent works in; a "<project>: ..." title prefix is only a fallback for memories without a project.'}
        actions={
          <Button
            size="sm"
            variant={linkMode ? "solid" : "outline"}
            icon="link"
            onClick={toggleLinkMode}
            disabled={isEmpty}
          >
            {linkMode ? "Exit link mode" : "Link mode"}
          </Button>
        }
      />

      {isEmpty ? (
        <EmptyState
          icon="share-2"
          title="No memories to graph yet"
          action={
            <Link to="/memories" className="text-sm underline">
              Go to Memories
            </Link>
          }
        >
          Create memories, then relate them to see the graph.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="search">
            <div className="min-w-52 flex-1">
              <SearchInput
                size="sm"
                aria-label="Search graph"
                placeholder="Find a memory in the graph…"
                value={query}
                onChange={(e) => {
                  const q = e.target.value;
                  setQuery(q);
                  setActiveClusterKey(null);
                  const first = searchNodes(graph.nodes, q)[0];
                  if (first) requestFocus([first]);
                }}
                onClear={() => setQuery("")}
              />
            </div>
            <div className="w-36">
              <Select
                size="sm"
                aria-label="Filter by type"
                value={type ?? ALL}
                onChange={(e) => setParam("type", e.target.value)}
                options={[
                  { value: ALL, label: "All types" },
                  ...withCurrent(options.types, type ?? "").map((t) => ({ value: t, label: typeLabel(t) })),
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                size="sm"
                aria-label="Filter by collection"
                value={collectionId ?? ALL}
                onChange={(e) => setParam("collection", e.target.value)}
                options={[
                  { value: ALL, label: "All collections" },
                  ...collections.map((c) => ({ value: c.id, label: c.name })),
                  ...(collectionId && !state.collections[collectionId] ? [{ value: collectionId, label: "Unknown collection" }] : []),
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                size="sm"
                aria-label="Filter by status"
                value={status ?? ALL}
                onChange={(e) => setParam("status", e.target.value)}
                options={[{ value: ALL, label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))]}
              />
            </div>
            <div className="w-36">
              <Select
                size="sm"
                aria-label="Filter by tag"
                value={tag ?? ALL}
                onChange={(e) => setParam("tag", e.target.value)}
                options={[{ value: ALL, label: "All tags" }, ...withCurrent(options.tags, tag ?? "").map((t) => ({ value: t, label: `#${t}` }))]}
              />
            </div>
            {(filtered || query) && (
              <Button size="sm" variant="ghost" icon="x" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Checkbox label="Highlight isolated memories" checked={highlightIsolated} onChange={(e) => setHighlightIsolated(e.target.checked)} />
            <Checkbox label="Show archived" checked={archivedVisible} disabled={filters.status === "archived"} onChange={(e) => setShowArchived(e.target.checked)} />
            <p className="text-xs text-fg-muted" aria-live="polite">
              {memoryCount} {memoryCount === 1 ? "memory" : "memories"} · {graph.edges.length}{" "}
              {graph.edges.length === 1 ? "relation" : "relations"}
              {query.trim() ? ` · ${matches.length} ${matches.length === 1 ? "match" : "matches"}` : ""}
            </p>
          </div>

          {linkMode && (
            <LinkBar
              key={`${linkSource}>${linkTarget}`}
              sourceTitle={linkSource ? titleOf(linkSource) : null}
              targetTitle={linkTarget ? titleOf(linkTarget) : null}
              onCancel={resetLink}
              onCreate={async (label) => {
                if (!linkSource || !linkTarget) return false;
                const { ok } = await act(() => addRelation(linkSource, linkTarget, label), "Relation added");
                if (ok) resetLink();
                return ok;
              }}
            />
          )}
          {linkMode && linkNotice && (
            <p role="status" className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg-muted">
              {linkNotice}
            </p>
          )}

          {base.edges.length === 0 && (
            <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg-muted">
              No relations yet. Use Link mode (or the Related memories section of a memory) to connect memories.
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="h-[min(72vh,46rem)] min-h-[24rem]">
              {graph.nodes.length === 0 ? (
                <EmptyState
                  icon="search"
                  title="No memories match"
                  action={
                    <Button size="sm" variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                >
                  Try removing a filter.
                </EmptyState>
              ) : (
                <GraphCanvas
                  nodes={shown.nodes}
                  edges={shown.edges}
                  projectAccents={projectAccents}
                  selectedNodeId={organizationNode ? organizationNode.id : attributeNode ? attributeNode.id : openId}
                  selectedEdgeId={edge?.id ?? null}
                  emphasisIds={emphasis}
                  highlightIds={highlightIds}
                  linkSourceId={linkSource}
                  focusRequest={focus}
                  reducedMotion={reducedMotion}
                  onSelectNode={selectNode}
                  onSelectEdge={selectEdge}
                  onClearSelection={clearSelection}
                />
              )}
            </div>
            <GraphSidePanel
              nodes={graph.nodes}
              projectAccents={projectAccents}
              clusters={clusterList}
              activeClusterIndex={activeClusterIndex >= 0 ? activeClusterIndex : null}
              isolated={isolated}
              selectedHub={selectedHub}
              attributeKinds={attributeKinds}
              organizationCount={shown.nodes.filter((n) => n.organization).length}
              selectedOrganization={selectedOrganization}
              selectedAttribute={selectedAttribute}
              creatingHub={creatingHub}
              hubNotice={hubNotice}
              onCreateHub={(hub) => void createHub(hub)}
              selectedEdge={edge ? { edge, sourceTitle: titleOf(edge.source), targetTitle: titleOf(edge.target) } : null}
              onFocusCluster={(i) => {
                const ids = clusterList[i];
                if (activeClusterIndex === i) {
                  setActiveClusterKey(null);
                  return;
                }
                setQuery("");
                setActiveClusterKey(ids[0]);
                requestFocus(ids);
              }}
              onOpenMemory={(id) => {
                requestFocus([id]);
                selectNode(id);
              }}
              onRemoveEdge={setConfirmEdgeId}
            />
          </div>
        </>
      )}

      <Drawer open={!!openId && !isVirtualNodeId(openId) && !linkMode} onClose={() => setParam("memory", null)} title="Memory" size="min(44rem, 100vw)">
        {openId && !isVirtualNodeId(openId) && <MemoryDetail key={openId} memoryId={openId} onOpenMemory={(id) => setParam("memory", id)} />}
      </Drawer>

      <Modal open={!!confirmEdge} onClose={() => setConfirmEdgeId(null)} title="Remove relation?">
        {confirmEdge && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This removes &ldquo;{titleOf(confirmEdge.fromId)} — {confirmEdge.label} → {titleOf(confirmEdge.toId)}&rdquo;. The memories
              themselves are kept.
            </p>
            {confirmEdge.label === TITLE_PREFIX_LABEL && confirmEdge.provenance.process === TITLE_PREFIX_PROCESS && (
              <p className="text-sm text-fg-muted">It will reappear while the titles still match.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmEdgeId(null)}>
                Cancel
              </Button>
              <Button size="sm" color="rose" onClick={() => void removeConfirmed()}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface LinkBarProps {
  sourceTitle: string | null;
  targetTitle: string | null;
  onCancel: () => void;
  onCreate: (label: string) => Promise<boolean>;
}

/** Keyed by source/target so the label resets for each new pair. */
function LinkBar({ sourceTitle, targetTitle, onCancel, onCreate }: LinkBarProps) {
  const { run, error } = useInlineAction();
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    try {
      await run(() => onCreate(label.trim()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 rounded-md border border-accent-500 bg-surface-muted px-3 py-2" role="region" aria-label="Create relation">
      {!sourceTitle ? (
        <p className="text-sm text-fg">Link mode: click the source memory.</p>
      ) : !targetTitle ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <span>
            Source: <strong>{sourceTitle}</strong>. Now click the target memory.
          </span>
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <span>
            <strong>{sourceTitle}</strong> →{" "}
            <strong>{targetTitle}</strong>
          </span>
          <div className="w-44">
            <Input size="sm" aria-label="Relation label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" size="sm" icon="link" disabled={busy || !label.trim()}>
            Create relation
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </form>
      )}
      <InlineError message={error} />
    </div>
  );
}
