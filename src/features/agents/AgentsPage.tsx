import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, EmptyState, Input } from "lojee-ui";
import { PageHeader } from "../../components/PageHeader";
import { useMemories } from "../../components/hooks";
import { formatDateTime } from "../../components/memoryMeta";
import { useToast } from "../../components/ToastProvider";
import { pendingChanges } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "../branches/InlineError";
import { applyProposal } from "./applyProposal";
import { useRunLog } from "./runLog";
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  DEFAULT_STALE_DAYS,
  runLibrarian,
  runReviewer,
  type AgentName,
  type Confidence,
  type Proposal,
} from "./workflows";

type Status = "applied" | "dismissed";

const AGENT_LABEL: Record<AgentName, string> = { librarian: "Librarian", reviewer: "Reviewer" };
const CONFIDENCE_COLOR: Record<Confidence, "emerald" | "amber" | "slate"> = { high: "emerald", medium: "amber", low: "slate" };

function ImplementedBadge() {
  return (
    <Badge variant="soft" color="emerald" size="sm" icon="check">
      Implemented (deterministic)
    </Badge>
  );
}
function PlannedBadge() {
  return (
    <Badge variant="soft" color="violet" size="sm" icon="clock">
      Future AI-powered
    </Badge>
  );
}

export function AgentsPage() {
  const memories = useMemories();
  const state = useWorkspace((s) => s.state);
  const toast = useToast();
  const { runs, record } = useRunLog();
  const [staleDays, setStaleDays] = useState(String(DEFAULT_STALE_DAYS));
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [lastAgent, setLastAgent] = useState<AgentName | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const staleId = useId();

  const pending = useMemo(() => (state ? pendingChanges(state).length : 0), [state]);
  const lastChange = useMemo(() => {
    if (!state) return null;
    const times = Object.values(state.revisions).map((r) => r.createdAt);
    return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }, [state]);
  const storageError = useWorkspace((s) => s.persistError);

  if (!state) return null;
  const staleN = Number(staleDays);
  const staleValid = Number.isFinite(staleN) && staleN >= 1;

  const input = () => ({
    memories,
    relations: Object.values(state.relations),
    collections: Object.values(state.collections).map((c) => ({ id: c.id, name: c.name })),
    now: Date.now(),
  });

  const run = (agent: AgentName) => {
    const result =
      agent === "librarian"
        ? runLibrarian(input(), { duplicateThreshold: DEFAULT_DUPLICATE_THRESHOLD })
        : runReviewer(input(), { staleDays: staleN });
    setProposals(result);
    setLastAgent(agent);
    setStatuses({});
    setError(null);
    record({
      agent,
      at: new Date().toISOString(),
      proposals: result.length,
      note: agent === "reviewer" ? `stale after ${staleN} days` : `duplicate threshold ${Math.round(DEFAULT_DUPLICATE_THRESHOLD * 100)}%`,
    });
  };

  const apply = async (p: Proposal) => {
    setBusyId(p.id);
    try {
      await applyProposal(p);
      const { error: storeError, clearError } = useWorkspace.getState();
      if (storeError) {
        setError(storeError);
        clearError();
        return;
      }
      setError(null);
      setStatuses((s) => ({ ...s, [p.id]: "applied" }));
      toast("Draft created. Review it on Branches & Versions.", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const appliedCount = Object.values(statuses).filter((s) => s === "applied").length;
  const open = proposals.filter((p) => !statuses[p.id]).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="Agents"
        description="Agents propose changes; you review them. Nothing is saved as a version or deleted automatically."
      />

      <Alert variant="info" title="No AI runs here">
        The Librarian and Reviewer are fixed, deterministic rules (text similarity and date checks) that run in your browser. They
        do not call any model and send nothing anywhere. Their findings can be wrong, so every proposal is reviewable.
      </Alert>

      <section aria-label="Agents" className="grid gap-3 md:grid-cols-2">
        <Card variant="outline" padding="sm" title="Librarian">
          <div className="space-y-3">
            <ImplementedBadge />
            <p className="text-sm text-fg-muted">
              Finds duplicate and near-duplicate memories, missing metadata (tags, collection, content, source) and isolated memories.
            </p>
            <Button size="sm" icon="play" onClick={() => run("librarian")}>
              Run Librarian
            </Button>
          </div>
        </Card>

        <Card variant="outline" padding="sm" title="Reviewer">
          <div className="space-y-3">
            <ImplementedBadge />
            <p className="text-sm text-fg-muted">
              Flags stale memories, possible contradictions (a rough heuristic) and incomplete provenance.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={staleId} className="text-xs font-medium text-fg-muted">
                  Stale after (days)
                </label>
                <Input
                  id={staleId}
                  size="sm"
                  type="number"
                  min={1}
                  value={staleDays}
                  invalid={!staleValid}
                  onChange={(e) => setStaleDays(e.target.value)}
                  className="w-28"
                />
              </div>
              <Button size="sm" icon="play" disabled={!staleValid} onClick={() => run("reviewer")}>
                Run Reviewer
              </Button>
            </div>
          </div>
        </Card>

        <Card variant="outline" padding="sm" title="Researcher">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <PlannedBadge />
              <Badge variant="soft" color="amber" size="sm">
                Planned — needs backend / LLM
              </Badge>
            </div>
            <p className="text-sm text-fg-muted">
              Would gather and summarize new information into proposed memories. Requires a model and a server, so it cannot run yet.
            </p>
            <Button size="sm" icon="play" disabled>
              Run Researcher
            </Button>
          </div>
        </Card>

        <Card variant="outline" padding="sm" title="Sync Agent">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <PlannedBadge />
              <Badge variant="soft" color="amber" size="sm">
                Planned — needs backend / LLM
              </Badge>
            </div>
            <dl className="space-y-1 text-sm" aria-label="Local sync status">
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Mode</dt>
                <dd>Local only — nothing is synced</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Last change recorded</dt>
                <dd>{lastChange ? formatDateTime(lastChange) : "None yet"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Pending drafts</dt>
                <dd>{pending}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-fg-muted">Browser storage</dt>
                <dd>{storageError ? "Write failed" : "OK"}</dd>
              </div>
            </dl>
            <Button size="sm" icon="refresh-cw" disabled>
              Run Sync Agent
            </Button>
          </div>
        </Card>
      </section>

      <section aria-label="Proposals" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Proposals{lastAgent ? ` from ${AGENT_LABEL[lastAgent]}` : ""}
          </h2>
          {lastAgent && (
            <span className="text-xs text-fg-muted">
              {open} open · {appliedCount} applied
            </span>
          )}
        </div>
        <InlineError message={error} />
        {appliedCount > 0 && (
          <Alert variant="success" title="Applied changes are drafts">
            Nothing has been saved as a version. <Link className="underline" to="/branches">Review and save them as a version on Branches &amp; Versions</Link>.
            Links are additive relations (not versioned) and can be removed from the Knowledge Graph.
          </Alert>
        )}
        {!lastAgent ? (
          <EmptyState icon="sparkles" title="No run yet">
            Run the Librarian or Reviewer to see proposed changes here.
          </EmptyState>
        ) : proposals.length === 0 ? (
          <EmptyState icon="check" title="Nothing to propose">
            {AGENT_LABEL[lastAgent]} found no issues in the current memories.
          </EmptyState>
        ) : (
          <ul aria-label="Proposals list" className="space-y-2">
            {proposals.map((p) => {
              const status = statuses[p.id];
              return (
                <li key={p.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{p.finding}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="soft" size="sm" color={CONFIDENCE_COLOR[p.confidence]}>
                          {p.confidence} confidence
                        </Badge>
                        {p.heuristic && (
                          <Badge variant="outline" size="sm" color="amber">
                            Heuristic guess
                          </Badge>
                        )}
                        {status && (
                          <Badge variant="soft" size="sm" color={status === "applied" ? "emerald" : "slate"}>
                            {status === "applied" ? "Applied as draft" : "Dismissed"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {!status && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          disabled={!p.action}
                          loading={busyId === p.id}
                          onClick={() => void apply(p)}
                        >
                          Apply
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setStatuses((s) => ({ ...s, [p.id]: "dismissed" }))}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                    {p.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    <span className="font-medium">Suggested change:</span> {p.suggestion}
                    {!p.action && <span className="text-fg-muted"> (manual edit needed)</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    {p.memoryIds.map((id) => (
                      <Link key={id} className="underline" to={`/memories?memory=${encodeURIComponent(id)}`}>
                        Open {memories.find((m) => m.id === id)?.title ?? id}
                      </Link>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Run history" className="space-y-2">
        <h2 className="text-sm font-semibold">Run history</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-fg-muted">No runs recorded in this browser yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {AGENT_LABEL[r.agent]} <span className="text-xs text-fg-muted">({r.note})</span>
                </span>
                <span className="text-xs text-fg-muted">
                  {r.proposals} {r.proposals === 1 ? "proposal" : "proposals"} · {formatDateTime(r.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
