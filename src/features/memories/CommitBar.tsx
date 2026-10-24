import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Input } from "lojee-ui";
import { pendingChanges } from "../../domain";
import { useAction } from "../../components/hooks";
import { KIND_META } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";

/** Shown whenever uncommitted drafts exist: review the list and commit with a message. */
export function CommitBar({ onOpenMemory }: { onOpenMemory: (id: string) => void }) {
  const state = useWorkspace((s) => s.state);
  const commit = useWorkspace((s) => s.commit);
  const act = useAction();
  const pending = useMemo(() => (state ? pendingChanges(state) : []), [state]);
  const [message, setMessage] = useState("");
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);

  if (pending.length === 0) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      const { ok } = await act(() => commit(message.trim()), "Version saved");
      if (ok) setMessage("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Unsaved changes"
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="soft" color="amber" size="sm">
          {pending.length} unsaved {pending.length === 1 ? "change" : "changes"}
        </Badge>
        <button
          type="button"
          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
          aria-expanded={showList}
          onClick={() => setShowList((v) => !v)}
        >
          {showList ? "Hide changes" : "Show changes"}
        </button>
        <form onSubmit={(e) => void submit(e)} className="ml-auto flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <Input
            size="sm"
            aria-label="Version note"
            placeholder="Version note"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" size="sm" icon="check" loading={busy} disabled={!message.trim()}>
            Save version
          </Button>
        </form>
      </div>
      {showList && (
        <ul className="mt-2 space-y-1" aria-label="Pending changes">
          {pending.map((p) => (
            <li key={p.memoryId} className="flex items-center gap-2 text-sm">
              <Badge variant="outline" size="xs" color={KIND_META[p.kind].color}>
                {KIND_META[p.kind].label}
              </Badge>
              <button
                type="button"
                className="min-w-0 truncate text-left text-fg hover:underline"
                onClick={() => onOpenMemory(p.memoryId)}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
