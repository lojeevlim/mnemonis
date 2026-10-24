import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, EmptyState } from "lojee-ui";
import { diffPending, listPendingRelations, pendingChanges, pendingCount, timeline } from "../../domain";
import { FieldDiff } from "../../components/FieldDiff";
import { InlineError } from "../../components/InlineError";
import { OriginBadge } from "../../components/OriginBadge";
import { PageHeader } from "../../components/PageHeader";
import { formatDateTime, KIND_META } from "../../components/memoryMeta";
import { useBulkReview } from "../../components/useBulkReview";
import { useInlineAction } from "../../components/useInlineAction";
import { useWorkspace } from "../../stores/workspaceStore";

const TIMELINE_LIMIT = 50;
const memoryLink = (id: string) => `/memories?memory=${encodeURIComponent(id)}`;

function InboxSection() {
  const state = useWorkspace((s) => s.state);
  const approve = useWorkspace((s) => s.approve);
  const reject = useWorkspace((s) => s.reject);
  const approveRelation = useWorkspace((s) => s.approveRelation);
  const rejectRelation = useWorkspace((s) => s.rejectRelation);
  const review = useBulkReview();
  const { run, error } = useInlineAction();
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useMemo(() => (state ? pendingChanges(state) : []), [state]);
  const links = useMemo(() => (state ? listPendingRelations(state) : []), [state]);
  // Computed once per state change, not for every item on every render.
  const diffs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof diffPending>>();
    if (state) for (const p of pending) map.set(p.revisionId, diffPending(state, p.revisionId));
    return map;
  }, [state, pending]);
  if (!state) return null;

  // Act on exactly what is on screen, never on proposals that arrived after this render.
  const shown = { revisionIds: pending.map((p) => p.revisionId), relationIds: links.map((l) => l.relationId) };
  const bulk = async (kind: "approve" | "reject") => {
    const r = await review(kind, shown);
    setBulkError(r.error);
    setNotice(r.notice);
  };
  const total = pendingCount(state);
  const count = `${total} ${total === 1 ? "change" : "changes"}`;

  return (
    <section aria-label="Inbox" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">Inbox</h2>
        {total > 0 && (
          <Badge variant="soft" color="amber" size="sm">
            {count} waiting for review
          </Badge>
        )}
        {total > 0 && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" icon="check" onClick={() => void bulk("approve")}>
              Approve all
            </Button>
            <Button size="sm" variant="outline" onClick={() => void bulk("reject")}>
              Reject all
            </Button>
          </span>
        )}
      </div>
      <InlineError message={bulkError ?? error} />
      {notice && (
        <p role="status" className="text-xs text-fg-muted">
          {notice}
        </p>
      )}

      {total === 0 ? (
        <EmptyState icon="inbox" title="Your inbox is empty">
          Changes proposed by agents and Memory Health checks wait here as short-term memory until you approve them.
          Your own edits are saved straight to long-term memory.
        </EmptyState>
      ) : pending.length > 0 ? (
        <ul className="space-y-3" aria-label="Changes waiting for review">
          {pending.map((p) => {
            const kind = KIND_META[p.kind];
            const diff = diffs.get(p.revisionId);
            return (
              <li key={p.revisionId} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="soft" size="xs" color={kind.color}>
                    {kind.label}
                  </Badge>
                  <Link to={memoryLink(p.memoryId)} className="min-w-0 truncate text-sm font-medium text-fg hover:underline">
                    {p.title}
                  </Link>
                  <OriginBadge origin={p.origin} />
                  {p.origin === "agent" && <span className="text-xs text-fg-muted">{p.author}</span>}
                  <span className="ml-auto flex gap-2">
                    <Button
                      size="xs"
                      icon="check"
                      onClick={() => void run(() => approve(p.revisionId), "Approved")}
                    >
                      <span aria-hidden="true">Approve</span>
                      <span className="sr-only">Approve {p.title}</span>
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void run(() => reject(p.revisionId), "Rejected")}
                    >
                      <span aria-hidden="true">Reject</span>
                      <span className="sr-only">Reject {p.title}</span>
                    </Button>
                  </span>
                </div>
                <p className="text-xs text-fg-muted">
                  {p.origin !== "agent" && `${p.author} · `}
                  {p.note ? `${p.note} · ` : ""}
                  {formatDateTime(p.createdAt)}
                </p>
                <FieldDiff changes={diff?.fields ?? []} collections={state.collections} />
              </li>
            );
          })}
        </ul>
      ) : null}

      {links.length > 0 && (
        <section aria-label="Links" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Links</h3>
          <ul className="space-y-2" aria-label="Links waiting for review">
            {links.map((l) => {
              const name = `${l.fromTitle} ${l.label} ${l.toTitle}`;
              return (
                <li key={l.relationId} className="space-y-1 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="soft" size="xs" color="blue">
                      Link
                    </Badge>
                    <span className="min-w-0 truncate text-sm font-medium text-fg">
                      <Link to={memoryLink(l.fromId)} className="hover:underline">
                        {l.fromTitle}
                      </Link>{" "}
                      <span className="text-fg-muted">{l.label}</span>{" "}
                      <Link to={memoryLink(l.toId)} className="hover:underline">
                        {l.toTitle}
                      </Link>
                    </span>
                    <OriginBadge origin="agent" />
                    <span className="ml-auto flex gap-2">
                      <Button
                        size="xs"
                        icon="check"
                        disabled={!l.ready}
                        onClick={() => void run(() => approveRelation(l.relationId), "Approved")}
                      >
                        <span aria-hidden="true">Approve</span>
                        <span className="sr-only">Approve link {name}</span>
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void run(() => rejectRelation(l.relationId), "Rejected")}
                      >
                        <span aria-hidden="true">Reject</span>
                        <span className="sr-only">Reject link {name}</span>
                      </Button>
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {l.author} · {formatDateTime(l.createdAt)}
                    {!l.ready && " · Approve the linked memories first"}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

function TimelineSection() {
  const state = useWorkspace((s) => s.state);
  const saved = useMemo(() => (state ? timeline(state, TIMELINE_LIMIT) : []), [state]);
  if (!state) return null;

  return (
    <section aria-label="Timeline" className="space-y-3">
      <h2 className="text-sm font-semibold text-fg">Timeline</h2>
      {saved.length === 0 ? (
        <EmptyState icon="clock" title="Nothing saved yet">
          Every saved change to a memory shows up here, newest first.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border" aria-label="Saved changes">
          {saved.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <Link to={memoryLink(r.memoryId)} className="min-w-0 truncate text-sm font-medium text-fg hover:underline">
                  {r.snapshot.title}
                </Link>
                <OriginBadge origin={r.origin} />
              </span>
              <span className="text-xs text-fg-muted">
                {r.note ? `${r.note} · ` : ""}
                {r.author} · {formatDateTime(r.savedAt ?? r.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function InboxPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <PageHeader
        title="Inbox"
        description="Changes proposed by agents and Memory Health checks wait here as short-term memory. Approve to keep them in long-term memory, or reject to discard them. Your own edits are saved immediately and can be rolled back from a memory's history. Everything stays in this browser."
      />
      <InboxSection />
      <TimelineSection />
    </div>
  );
}
