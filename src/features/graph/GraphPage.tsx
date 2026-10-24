import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Checkbox, Drawer, EmptyState, Input, Modal, SearchInput, Select } from "lojee-ui";
import type { MemoryStatus } from "../../domain";
import { useAction } from "../../components/hooks";
import { PageHeader } from "../../components/PageHeader";
import { STATUS_META, typeLabel } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "../../components/InlineError";
import { useInlineAction } from "../../components/useInlineAction";
import { MemoryDetail } from "../memories/MemoryDetail";
import { GraphCanvas, type FocusRequest } from "./GraphCanvas";
import { GraphSidePanel } from "./GraphSidePanel";
import {
  buildGraph,
  clusters as findClusters,
  filterGraph,
  isolatedNodes,
  searchNodes,
  type GraphFilters,
} from "./graphModel";
import { usePrefersReducedMotion } from "./useReducedMotion";

const ALL = "";
const DEFAULT_LABEL = "related to";
const STATUSES = Object.keys(STATUS_META) as MemoryStatus[];

export function GraphPage() {
  const state = useWorkspace((s) => s.state);
  const addRelation = useWorkspace((s) => s.addRelation);
  const removeRelation = useWorkspace((s) => s.removeRelation);
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
  const clusterList = useMemo(() => (graph ? findClusters(graph.nodes, graph.edges) : []), [graph]);
  const isolated = useMemo(() => (graph ? isolatedNodes(graph.nodes) : []), [graph]);
  const matches = useMemo(() => (graph ? searchNodes(graph.nodes, query) : []), [graph, query]);

  const options = useMemo(() => {
    const nodes = base?.nodes ?? [];
    const tags = new Map<string, string>();
    for (const n of nodes) for (const t of n.tags) if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    return {
      types: [...new Set(nodes.map((n) => n.type))].sort(),
      tags: [...tags.values()].sort((a, b) => a.localeCompare(b)),
    };
  }, [base]);

  if (!state || !base || !graph) return null;

  const collections = Object.values(state.collections);
  const withCurrent = (values: string[], current: string) =>
    current && !values.includes(current) ? [...values, current] : values;
  const filtered = !!(type || collectionId || status || tag);
  const titleOf = (id: string) => base.nodes.find((n) => n.id === id)?.title ?? state.memories[id]?.id ?? id;

  const activeClusterIndex = activeClusterKey ? clusterList.findIndex((c) => c[0] === activeClusterKey) : -1;
  const activeCluster = activeClusterIndex >= 0 ? clusterList[activeClusterIndex] : null;
  const edge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : undefined;

  let emphasis: Set<string> | null = null;
  if (query.trim()) emphasis = new Set(matches);
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
  };
  const toggleLinkMode = () => {
    setLinkMode((on) => !on);
    resetLink();
    setSelectedEdgeId(null);
    setParam("memory", null);
  };

  const selectNode = (id: string) => {
    if (linkMode) {
      if (!linkSource) setLinkSource(id);
      else if (id === linkSource) resetLink();
      else setLinkTarget(id);
      return;
    }
    setSelectedEdgeId(null);
    setParam("memory", id);
  };
  const selectEdge = (id: string) => {
    if (linkMode) return;
    setParam("memory", null);
    setSelectedEdgeId(id);
  };
  const clearSelection = () => {
    setSelectedEdgeId(null);
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

  return (
    <div className="mx-auto max-w-7xl space-y-3 p-4">
      <PageHeader
        title="Knowledge Graph"
        description="Memories and the relations you or your agents have stored between them. Edges are never inferred."
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
              {graph.nodes.length} {graph.nodes.length === 1 ? "memory" : "memories"} · {graph.edges.length}{" "}
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
                  nodes={graph.nodes}
                  edges={graph.edges}
                  selectedNodeId={openId}
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
              clusters={clusterList}
              activeClusterIndex={activeClusterIndex >= 0 ? activeClusterIndex : null}
              isolated={isolated}
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

      <Drawer open={!!openId && !linkMode} onClose={() => setParam("memory", null)} title="Memory" size="min(44rem, 100vw)">
        {openId && <MemoryDetail key={openId} memoryId={openId} onOpenMemory={(id) => setParam("memory", id)} />}
      </Drawer>

      <Modal open={!!confirmEdge} onClose={() => setConfirmEdgeId(null)} title="Remove relation?">
        {confirmEdge && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              This removes &ldquo;{titleOf(confirmEdge.fromId)} — {confirmEdge.label} → {titleOf(confirmEdge.toId)}&rdquo;. The memories
              themselves are kept.
            </p>
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
