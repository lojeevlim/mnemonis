import { useMemo, useState } from "react";
import { Badge, Button } from "lojee-ui";
import {
  diffRevisions,
  memoryHistory,
  type Memory,
  type Revision,
  type WorkspaceState,
} from "../../domain";
import { useAction } from "../../components/hooks";
import { OriginBadge } from "../../components/OriginBadge";
import { FieldDiff } from "../../components/FieldDiff";
import { MarkdownView } from "../../components/MarkdownView";
import { formatDateTime, typeLabel } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";

function RevisionDetails({ state, rev, mode }: { state: WorkspaceState; rev: Revision; mode: "view" | "diff" }) {
  if (mode === "view") {
    const s = rev.snapshot;
    return (
      <div className="space-y-2 rounded-md border border-border p-2">
        <div className="text-sm font-medium">{s.title}</div>
        <div className="text-xs text-fg-muted">
          {typeLabel(s.type)}
          {s.tags.length > 0 && ` · ${s.tags.map((t) => `#${t}`).join(" ")}`}
          {s.archived && " · archived"}
        </div>
        <MarkdownView source={s.content} />
      </div>
    );
  }
  if (!rev.parentRevisionId) return <p className="text-xs text-fg-muted">First revision: nothing to compare against.</p>;
  return <FieldDiff changes={diffRevisions(state, rev.parentRevisionId, rev.id)} collections={state.collections} projects={state.projects} />;
}

export function RevisionHistory({ state, memory }: { state: WorkspaceState; memory: Memory }) {
  const rollback = useWorkspace((s) => s.rollbackMemory);
  const act = useAction();
  const history = useMemo(() => memoryHistory(state, memory.id), [state, memory.id]);
  const [open, setOpen] = useState<Record<string, "view" | "diff" | undefined>>({});

  const toggle = (id: string, mode: "view" | "diff") =>
    setOpen((o) => ({ ...o, [id]: o[id] === mode ? undefined : mode }));

  if (history.length === 0) return <p className="text-sm text-fg-muted">No saved versions yet.</p>;

  return (
    <ol className="space-y-2" aria-label="Revision history">
      {history.map((rev, i) => {
        const mode = open[rev.id];
        return (
          <li key={rev.id} className="rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{i === 0 ? "Current" : `Revision ${history.length - i}`}</span>
              <Badge variant="soft" size="xs" color="emerald">
                Saved
              </Badge>
              <OriginBadge origin={rev.origin} />
              <span className="text-xs text-fg-muted">
                {rev.note ? `“${rev.note}” · ` : ""}
                {rev.author} · {formatDateTime(rev.savedAt ?? rev.createdAt)}
              </span>
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => toggle(rev.id, "view")} aria-expanded={mode === "view"}>
                  <span aria-hidden="true">View</span>
                  <span className="sr-only">View revision {history.length - i}</span>
                </Button>
                {rev.parentRevisionId && (
                  <Button size="xs" variant="ghost" onClick={() => toggle(rev.id, "diff")} aria-expanded={mode === "diff"}>
                    <span aria-hidden="true">Changes</span>
                    <span className="sr-only">Changes in revision {history.length - i}</span>
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={i === 0}
                  onClick={() =>
                    void act(() => rollback(memory.id, rev.id), "Rolled back")
                  }
                >
                  <span aria-hidden="true">Roll back</span>
                  <span className="sr-only">Roll back to revision {history.length - i}</span>
                </Button>
              </span>
            </div>
            {mode && (
              <div className="mt-2">
                <RevisionDetails state={state} rev={rev} mode={mode} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
