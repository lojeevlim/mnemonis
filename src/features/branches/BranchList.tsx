import { useMemo } from "react";
import { Badge, Button } from "lojee-ui";
import { ancestorSet, getBranch, type WorkspaceState } from "../../domain";
import { formatRelative } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "./InlineError";
import { useInlineAction } from "./useInlineAction";

export function BranchList({ state, onCreate }: { state: WorkspaceState; onCreate: () => void }) {
  const switchBranch = useWorkspace((s) => s.switchBranch);
  const { run, error } = useInlineAction();
  const rows = useMemo(() => {
    const currentAnc = ancestorSet(state, getBranch(state, state.currentBranchId).headCommitId);
    return Object.values(state.branches)
      .sort((a, b) => (a.id === state.currentBranchId ? -1 : b.id === state.currentBranchId ? 1 : a.name.localeCompare(b.name)))
      .map((b) => {
        const head = b.headCommitId ? state.commits[b.headCommitId] : undefined;
        const ahead = [...ancestorSet(state, b.headCommitId)].filter((id) => !currentAnc.has(id)).length;
        return { branch: b, head, ahead };
      });
  }, [state]);
  const current = state.branches[state.currentBranchId];

  return (
    <section aria-label="Branches" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">Branches</h2>
        <Badge variant="soft" size="sm" color="blue" icon="git-branch">
          <span className="sr-only">Current branch: </span>
          {current.name}
        </Badge>
        <Button size="sm" variant="outline" icon="plus" className="ml-auto" onClick={onCreate}>
          New branch
        </Button>
      </div>
      <InlineError message={error} />
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Branch list">
        {rows.map(({ branch, head, ahead }) => {
          const isCurrent = branch.id === state.currentBranchId;
          return (
            <li key={branch.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-sm font-medium text-fg">{branch.name}</span>
              {isCurrent && (
                <Badge variant="soft" size="xs" color="emerald">
                  Current
                </Badge>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                {head ? `${head.message} · ${formatRelative(head.timestamp)}` : "No versions yet"}
                {!isCurrent && ahead > 0 && ` · ${ahead} ${ahead === 1 ? "version" : "versions"} not on ${current.name}`}
              </span>
              {!isCurrent && (
                <Button size="xs" variant="outline" onClick={() => void run(() => switchBranch(branch.id), `Switched to ${branch.name}`)}>
                  <span aria-hidden="true">Switch</span>
                  <span className="sr-only">Switch to {branch.name}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 1 && (
        <p className="text-xs text-fg-muted">
          Only <strong>{current.name}</strong> exists. Create a branch to experiment without affecting it.
        </p>
      )}
    </section>
  );
}
