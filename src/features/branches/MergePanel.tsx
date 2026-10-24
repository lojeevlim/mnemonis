import { useMemo, useState, type FormEvent } from "react";
import { Alert, Button, EmptyState, Input, Select } from "lojee-ui";
import { getBranch, pendingChanges } from "../../domain";
import { useToast } from "../../components/ToastProvider";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "./InlineError";
import { useInlineAction } from "./useInlineAction";

/** Starts a merge of another branch into the current one (the target). */
export function MergePanel() {
  const state = useWorkspace((s) => s.state);
  const merge = useWorkspace((s) => s.merge);
  const toast = useToast();
  const { run, error } = useInlineAction();
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const others = useMemo(
    () => (state ? Object.values(state.branches).filter((b) => b.id !== state.currentBranchId) : []),
    [state],
  );
  if (!state) return null;
  const target = getBranch(state, state.currentBranchId);

  if (others.length === 0) {
    return (
      <EmptyState icon="git-merge" title="Nothing to merge">
        <strong>{target.name}</strong> is the only branch. Create another branch, make changes there, then merge it back.
      </EmptyState>
    );
  }
  const blockedByDrafts = pendingChanges(state, target.id).length > 0;
  const blockedByMerge = !!state.pendingMerge;
  const chosen = others.some((b) => b.id === source) ? source : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    const sourceName = state.branches[chosen].name;
    setBusy(true);
    try {
      const { ok, value } = await run(() => merge(chosen, message.trim() || undefined));
      if (!ok || !value) return;
      if (value.status === "up-to-date") {
        toast(`${target.name} already contains everything from ${sourceName}`, "info");
      } else if (value.status === "merged") {
        toast(`Merged ${sourceName} into ${target.name}`, "success");
        setMessage("");
      } else {
        const n = value.conflicts.length;
        toast(`${n} ${n === 1 ? "conflict needs" : "conflicts need"} resolving before the merge can finish`, "warning");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-xl space-y-3">
      <p className="text-sm text-fg-muted">
        Merge another branch into <strong className="text-fg">{target.name}</strong> (the current branch).
      </p>
      {blockedByDrafts && (
        <Alert variant="warning" title="Unsaved changes on this branch">
          {target.name} has unsaved drafts. Save a version (see Working changes) before merging.
        </Alert>
      )}
      {blockedByMerge && !blockedByDrafts && (
        <Alert variant="info">A merge is already in progress. Resolve it or abort it first.</Alert>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="merge-source-select" className="text-xs font-medium text-fg-muted">
          Merge from
        </label>
        <Select
          id="merge-source-select"
          size="sm"
          value={chosen}
          placeholder="Choose a branch"
          onChange={(e) => setSource(e.target.value)}
          options={others.map((b) => ({ value: b.id, label: b.name }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="merge-message" className="text-xs font-medium text-fg-muted">
          Merge version note (optional)
        </label>
        <Input id="merge-message" size="sm" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <InlineError message={error} />
      <Button type="submit" size="sm" icon="git-merge" loading={busy} disabled={!chosen || blockedByDrafts || blockedByMerge}>
        Merge into {target.name}
      </Button>
    </form>
  );
}
