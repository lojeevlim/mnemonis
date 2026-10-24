import { useMemo, useState } from "react";
import { Badge, Button, EmptyState } from "lojee-ui";
import { commitLog, commitTree, diffCommits, getBranch } from "../../domain";
import { formatDateTime } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { CreateBranchModal } from "./CreateBranchModal";
import { MemoryDiffList } from "./MemoryDiffList";

export function CommitHistory() {
  const state = useWorkspace((s) => s.state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const log = useMemo(() => (state ? commitLog(state) : []), [state]);
  const selected = selectedId ? state?.commits[selectedId] : undefined;
  const diffs = useMemo(
    () => (state && selected ? diffCommits(state, selected.parentIds[0] ?? null, selected.id) : []),
    [state, selected],
  );
  if (!state) return null;
  const branch = getBranch(state, state.currentBranchId);

  if (log.length === 0) {
    return (
      <EmptyState icon="git-commit-horizontal" title="No versions yet">
        Save your first version on <strong>{branch.name}</strong> and they will appear here.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ol className="divide-y divide-border self-start rounded-lg border border-border" aria-label="Version history">
        {log.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(active ? null : c.id)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 ${active ? "bg-surface-muted" : ""}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-fg">{c.message}</span>
                  {c.parentIds.length > 1 && (
                    <Badge variant="outline" size="xs" color="violet">
                      Merge
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-fg-muted">
                  {c.author} · {formatDateTime(c.timestamp)} · {c.changes.length}{" "}
                  {c.changes.length === 1 ? "memory" : "memories"} changed
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section aria-label="Version details" className="min-w-0 space-y-3">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{selected.message}</h3>
              <Button size="xs" variant="outline" icon="git-branch" className="ml-auto" onClick={() => setBranchFrom(selected.id)}>
                Branch from this version
              </Button>
            </div>
            <MemoryDiffList
              state={state}
              diffs={diffs}
              label="Version changes"
              trees={[commitTree(state, selected.id), commitTree(state, selected.parentIds[0] ?? null)]}
              emptyText="This version has no field changes compared to its parent."
            />
          </>
        ) : (
          <p className="text-sm text-fg-muted">Select a version to see what it changed.</p>
        )}
      </section>

      <CreateBranchModal open={branchFrom !== null} fromCommitId={branchFrom ?? undefined} onClose={() => setBranchFrom(null)} />
    </div>
  );
}
