import { useState } from "react";
import { Alert, Badge, Button, Input, Select, Textarea } from "lojee-ui";
import { Link } from "react-router-dom";
import type { Conflict, MemoryFieldValue, PendingMerge } from "../../domain";
import { showValue } from "../../components/FieldDiff";
import { useToast } from "../../components/ToastProvider";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "./InlineError";
import { useInlineAction } from "./useInlineAction";

/** Editable text form of a field value, and the inverse parse (typed by the "ours" value). */
function toText(v: MemoryFieldValue): string {
  if (typeof v === "string") return v;
  if (v === null) return "";
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v, null, 2);
}

function parseManual(shape: MemoryFieldValue, text: string): { ok: true; value: MemoryFieldValue } | { ok: false; error: string } {
  if (typeof shape === "boolean") return { ok: true, value: text === "true" };
  if (Array.isArray(shape)) {
    return { ok: true, value: text.split(",").map((t) => t.trim()).filter(Boolean) };
  }
  if (shape === null) return { ok: true, value: text.trim() === "" ? null : text };
  if (typeof shape === "object") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "Metadata must be a JSON object." };
      }
      return { ok: true, value: parsed as MemoryFieldValue };
    } catch {
      return { ok: false, error: "Metadata must be valid JSON." };
    }
  }
  return { ok: true, value: text };
}

function ValueBox({ label, value, multiline }: { label: string; value: MemoryFieldValue; multiline: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-border">
      <div className="border-b border-border px-2 py-1 text-xs font-medium text-fg-muted">{label}</div>
      <pre className={`overflow-x-auto whitespace-pre-wrap p-2 text-xs ${multiline ? "font-mono" : ""}`}>{showValue(value)}</pre>
    </div>
  );
}

function ConflictItem({ conflict, title }: { conflict: Conflict; title: string }) {
  const resolveConflict = useWorkspace((s) => s.resolveConflict);
  const { run, error } = useInlineAction();
  const [manual, setManual] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const res = conflict.resolution;
  const multiline = typeof conflict.ours === "string" && conflict.field === "content";
  const editing = manual !== null;
  const shownManual = manual ?? "";

  const choose = async (choice: "ours" | "theirs") => {
    setManual(null);
    setParseError(null);
    await run(() => resolveConflict(conflict.id, choice));
  };
  const applyManual = async () => {
    const parsed = parseManual(conflict.ours, shownManual);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError(null);
    const { ok } = await run(() => resolveConflict(conflict.id, "manual", parsed.value));
    if (ok) setManual(null);
  };

  return (
    <li
      role="group"
      aria-label={`Conflict: ${conflict.field} of ${title}`}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg">{conflict.field}</span>
        <Badge variant="soft" size="xs" color={res ? "emerald" : "rose"}>
          {res ? `Resolved: ${res.choice}` : "Unresolved"}
        </Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ValueBox label="Ours (current branch)" value={conflict.ours} multiline={multiline} />
        <ValueBox label="Theirs (merging in)" value={conflict.theirs} multiline={multiline} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant={res?.choice === "ours" ? "solid" : "outline"} aria-pressed={res?.choice === "ours"} onClick={() => void choose("ours")}>
          Keep ours
        </Button>
        <Button size="xs" variant={res?.choice === "theirs" ? "solid" : "outline"} aria-pressed={res?.choice === "theirs"} onClick={() => void choose("theirs")}>
          Take theirs
        </Button>
        <Button
          size="xs"
          variant={res?.choice === "manual" || editing ? "solid" : "outline"}
          aria-pressed={res?.choice === "manual" || editing}
          onClick={() => setManual(res ? toText(res.value) : toText(conflict.ours))}
        >
          Edit manually
        </Button>
      </div>
      {editing && (
        <div className="space-y-2">
          {typeof conflict.ours === "boolean" ? (
            <Select
              size="sm"
              aria-label="Manual value"
              value={shownManual}
              onChange={(e) => setManual(e.target.value)}
              options={[
                { value: "true", label: "true" },
                { value: "false", label: "false" },
              ]}
            />
          ) : multiline || (typeof conflict.ours === "object" && conflict.ours !== null && !Array.isArray(conflict.ours)) ? (
            <Textarea aria-label="Manual value" rows={6} value={shownManual} onChange={(e) => setManual(e.target.value)} />
          ) : (
            <Input
              size="sm"
              aria-label="Manual value"
              placeholder={Array.isArray(conflict.ours) ? "Comma-separated values" : undefined}
              value={shownManual}
              onChange={(e) => setManual(e.target.value)}
            />
          )}
          <InlineError message={parseError} />
          <div className="flex gap-2">
            <Button size="xs" onClick={() => void applyManual()}>
              Use this value
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setManual(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <InlineError message={error} />
    </li>
  );
}

/** Shown while state.pendingMerge exists: resolve each conflict, then complete or abort. */
export function ConflictResolver({ pending }: { pending: PendingMerge }) {
  const state = useWorkspace((s) => s.state);
  const completeMerge = useWorkspace((s) => s.completeMerge);
  const abortMerge = useWorkspace((s) => s.abortMerge);
  const toast = useToast();
  const { run, error } = useInlineAction();
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const source = state.branches[pending.sourceBranchId]?.name ?? "source";
  const target = state.branches[pending.targetBranchId]?.name ?? "target";
  const unresolved = pending.conflicts.filter((c) => !c.resolution).length;
  const memoryIds = [...new Set(pending.conflicts.map((c) => c.memoryId))];

  const complete = async () => {
    setBusy(true);
    try {
      const { ok } = await run(() => completeMerge());
      if (ok) toast(`Merged ${source} into ${target}`, "success");
    } finally {
      setBusy(false);
    }
  };
  const abort = async () => {
    const { ok } = await run(() => abortMerge());
    if (ok) toast("Merge aborted. No changes were made.", "info");
  };

  return (
    <section aria-label="Merge conflicts" className="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
      <Alert variant="warning" title={`Merging ${source} into ${target}`}>
        {pending.conflicts.length} {pending.conflicts.length === 1 ? "conflict" : "conflicts"} in {memoryIds.length}{" "}
        {memoryIds.length === 1 ? "memory" : "memories"}. Those memories show as Conflict until resolved.
      </Alert>
      {memoryIds.map((id) => {
        const title = pending.merged[id]?.title ?? "Untitled memory";
        return (
          <div key={id} className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">
              <Link to={`/memories?memory=${encodeURIComponent(id)}`} className="hover:underline">
                {title}
              </Link>
            </h3>
            <ul className="space-y-2" aria-label={`Conflicts in ${title}`}>
              {pending.conflicts
                .filter((c) => c.memoryId === id)
                .map((c) => (
                  <ConflictItem key={c.id} conflict={c} title={title} />
                ))}
            </ul>
          </div>
        );
      })}
      <InlineError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="check" loading={busy} disabled={unresolved > 0} onClick={() => void complete()}>
          Complete merge
        </Button>
        <Button size="sm" variant="outline" onClick={() => void abort()}>
          Abort merge
        </Button>
        {unresolved > 0 && (
          <span className="text-xs text-fg-muted" aria-live="polite">
            {unresolved} unresolved
          </span>
        )}
      </div>
    </section>
  );
}
