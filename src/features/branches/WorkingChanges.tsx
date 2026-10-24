import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Input } from "lojee-ui";
import { diffWorkingTree, getBranch } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "./InlineError";
import { MemoryDiffList } from "./MemoryDiffList";
import { useInlineAction } from "./useInlineAction";

export function WorkingChanges() {
  const state = useWorkspace((s) => s.state);
  const commit = useWorkspace((s) => s.commit);
  const { run, error } = useInlineAction();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const diffs = useMemo(() => (state ? diffWorkingTree(state) : []), [state]);
  if (!state) return null;
  const branch = getBranch(state, state.currentBranchId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      const { ok } = await run(() => commit(message.trim()), "Version saved");
      if (ok) setMessage("");
    } finally {
      setBusy(false);
    }
  };

  if (diffs.length === 0) {
    return (
      <EmptyState icon="check" title="No unsaved changes">
        Edits to memories on <strong>{branch.name}</strong> show up here for review before you save a version.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="soft" color="amber" size="sm">
          {diffs.length} {diffs.length === 1 ? "memory" : "memories"} changed on {branch.name}
        </Badge>
      </div>
      <MemoryDiffList state={state} diffs={diffs} label="Working changes" />
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
        <div className="min-w-56 flex-1 space-y-1">
          <Input
            size="sm"
            aria-label="Version note"
            placeholder="Version note (required)"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <InlineError message={error} />
        </div>
        <Button type="submit" size="sm" icon="check" loading={busy} disabled={!message.trim()}>
          Save version
        </Button>
      </form>
    </div>
  );
}
