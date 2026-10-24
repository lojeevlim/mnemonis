import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Drawer, EmptyState, Pagination, SearchInput, Select } from "lojee-ui";
import { searchWorkspace, type MemoryStatus } from "../../domain";
import { useDebounced, useMemories } from "../../components/hooks";
import { DemoBadge } from "../../components/DemoBadge";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatRelative, isDemoMemory, STATUS_META, typeLabel } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { CommitBar } from "./CommitBar";
import { CreateMemoryModal } from "./CreateMemoryModal";
import { MemoryDetail } from "./MemoryDetail";

const PAGE_SIZE = 10;
const ALL = "";
const STATUSES = Object.keys(STATUS_META) as MemoryStatus[];

function snippet(content: string): string {
  return content.replace(/[#>*_`\-[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
}

export function MemoriesPage() {
  const state = useWorkspace((s) => s.state);
  const memories = useMemories();
  const [params, setParams] = useSearchParams();
  const [queryInput, setQueryInput] = useState("");
  const query = useDebounced(queryInput, 200);
  const [creating, setCreating] = useState(false);
  const [pageState, setPageState] = useState({ key: "", page: 1 });

  const type = params.get("type") ?? ALL;
  const collection = params.get("collection") ?? ALL;
  const status = params.get("status") ?? ALL;
  const tag = params.get("tag") ?? ALL;
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

  const filterKey = JSON.stringify([query, type, collection, status, tag]);
  const page = pageState.key === filterKey ? pageState.page : 1;

  const result = useMemo(
    () =>
      state
        ? searchWorkspace(state, {
            query,
            type: type || undefined,
            collectionId: collection || undefined,
            status: (status || undefined) as MemoryStatus | undefined,
            tag: tag || undefined,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          })
        : null,
    [state, query, type, collection, status, tag, page],
  );

  const options = useMemo(() => {
    const types = [...new Set(memories.map((m) => m.type))].sort();
    const tags = new Map<string, string>();
    for (const m of memories) for (const t of m.tags) if (!tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    return { types, tags: [...tags.values()].sort((a, b) => a.localeCompare(b)) };
  }, [memories]);

  if (!state || !result) return null;
  const collections = Object.values(state.collections);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const filtered = !!(query.trim() || type || collection || status || tag);
  const activeCollection = collection ? state.collections[collection] : undefined;

  const openMemory = (id: string) => setParam("memory", id);
  const clearFilters = () => {
    setQueryInput("");
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ["type", "collection", "status", "tag"]) next.delete(k);
        return next;
      },
      { replace: true },
    );
  };

  const withCurrent = (values: string[], current: string) =>
    current && !values.includes(current) ? [...values, current] : values;

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <PageHeader
        title="Memories"
        description={
          activeCollection ? (
            <>
              In collection <strong>{activeCollection.name}</strong> ·{" "}
              <Link to="/collections" className="underline">
                all collections
              </Link>
            </>
          ) : (
            "Everything your agents and you have remembered on this branch."
          )
        }
        actions={
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
            New memory
          </Button>
        }
      />

      <CommitBar onOpenMemory={openMemory} />

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="min-w-52 flex-1">
          <SearchInput
            size="sm"
            aria-label="Search memories"
            placeholder="Search title, content, tags…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onClear={() => setQueryInput("")}
          />
        </div>
        <div className="w-36">
          <Select
            size="sm"
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setParam("type", e.target.value)}
            options={[{ value: ALL, label: "All types" }, ...withCurrent(options.types, type).map((t) => ({ value: t, label: typeLabel(t) }))]}
          />
        </div>
        <div className="w-40">
          <Select
            size="sm"
            aria-label="Filter by collection"
            value={collection}
            onChange={(e) => setParam("collection", e.target.value)}
            options={[
              { value: ALL, label: "All collections" },
              ...collections.map((c) => ({ value: c.id, label: c.name })),
              ...(collection && !state.collections[collection] ? [{ value: collection, label: "Unknown collection" }] : []),
            ]}
          />
        </div>
        <div className="w-36">
          <Select
            size="sm"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setParam("status", e.target.value)}
            options={[
              { value: ALL, label: "Active (no archived)" },
              ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
            ]}
          />
        </div>
        <div className="w-36">
          <Select
            size="sm"
            aria-label="Filter by tag"
            value={tag}
            onChange={(e) => setParam("tag", e.target.value)}
            options={[{ value: ALL, label: "All tags" }, ...withCurrent(options.tags, tag).map((t) => ({ value: t, label: `#${t}` }))]}
          />
        </div>
        {filtered && (
          <Button size="sm" variant="ghost" icon="x" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <p className="text-xs text-fg-muted" aria-live="polite">
        {result.total} {result.total === 1 ? "memory" : "memories"}
        {filtered ? " match" : ""}
      </p>

      {result.items.length === 0 ? (
        <EmptyState
          icon={filtered ? "search" : "inbox"}
          title={filtered ? "No memories match" : "No memories yet"}
          action={
            filtered ? (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
                New memory
              </Button>
            )
          }
        >
          {filtered ? "Try a different search or remove a filter." : "Create your first memory to get started."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Memories">
          {result.items.map(({ memory: m }) => {
            const col = m.collectionId ? state.collections[m.collectionId] : undefined;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openMemory(m.id)}
                  className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{m.title}</span>
                    {isDemoMemory(m) && <DemoBadge />}
                    <StatusBadge status={m.status} />
                    <span className="ml-auto text-xs text-fg-subtle">{formatRelative(m.updatedAt)}</span>
                  </span>
                  <span className="truncate text-xs text-fg-muted">{snippet(m.content) || "No content"}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" size="xs">
                      {typeLabel(m.type)}
                    </Badge>
                    {col && (
                      <Badge variant="outline" size="xs" icon="folder">
                        {col.name}
                      </Badge>
                    )}
                    {m.tags.slice(0, 4).map((t) => (
                      <span key={t} className="text-xs text-fg-subtle">
                        #{t}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination page={page} totalPages={totalPages} onPageChange={(p) => setPageState({ key: filterKey, page: p })} />
        </div>
      )}

      <CreateMemoryModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={openMemory}
        defaultCollectionId={collection || null}
      />

      <Drawer open={!!openId} onClose={() => setParam("memory", null)} title="Memory" size="min(44rem, 100vw)">
        {openId && <MemoryDetail key={openId} memoryId={openId} onOpenMemory={openMemory} />}
      </Drawer>
    </div>
  );
}
