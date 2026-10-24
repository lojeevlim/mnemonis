import { Badge } from "lojee-ui";
import { Link } from "react-router-dom";
import type { MemoryDiff, Tree, WorkspaceState } from "../../domain";
import { FieldDiff } from "../../components/FieldDiff";

const KIND = {
  added: { label: "Added", color: "emerald" },
  modified: { label: "Modified", color: "amber" },
  removed: { label: "Removed", color: "rose" },
} as const;

/** Title as of the first tree that has the memory, else the latest known title (diffs only carry ids). */
function memoryTitle(state: WorkspaceState, memoryId: string, trees: Tree[]): string {
  for (const t of trees) {
    const rev = t[memoryId] ? state.revisions[t[memoryId]] : undefined;
    if (rev) return rev.snapshot.title;
  }
  let title = "Untitled memory";
  for (const r of Object.values(state.revisions)) if (r.memoryId === memoryId) title = r.snapshot.title;
  return title;
}

/** Per-memory field diffs, each linking to the memory in the Memories page. */
export function MemoryDiffList({
  state,
  diffs,
  emptyText = "No differences.",
  label,
  trees = [],
}: {
  state: WorkspaceState;
  diffs: MemoryDiff[];
  emptyText?: string;
  label: string;
  /** Trees (memoryId -> revisionId) to resolve titles from, in priority order. */
  trees?: Tree[];
}) {
  if (diffs.length === 0) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ul className="space-y-3" aria-label={label}>
      {diffs.map((d) => {
        const kind = KIND[d.kind];
        return (
          <li key={d.memoryId} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="soft" size="xs" color={kind.color}>
                {kind.label}
              </Badge>
              <Link
                to={`/memories?memory=${encodeURIComponent(d.memoryId)}`}
                className="min-w-0 truncate text-sm font-medium text-fg hover:underline"
              >
                {memoryTitle(state, d.memoryId, trees)}
              </Link>
            </div>
            <FieldDiff changes={d.fields} />
          </li>
        );
      })}
    </ul>
  );
}
