import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, EmptyState, Stat, Timeline, type TimelineItem } from "lojee-ui";
import { DemoBadge } from "../../components/DemoBadge";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatDateTime, formatRelative, isDemoMemory } from "../../components/memoryMeta";
import { DEMO_TAG } from "../../data/seed";
import { useWorkspace } from "../../stores/workspaceStore";
import { frequentTopics, overviewStats, recentActivity, recentChanges } from "./selectors";

export function OverviewPage() {
  const state = useWorkspace((s) => s.state);
  const data = useMemo(
    () =>
      state
        ? {
            stats: overviewStats(state),
            changes: recentChanges(state, 6),
            activity: recentActivity(state, 5),
            topics: frequentTopics(state, { limit: 10, exclude: [DEMO_TAG] }),
            hasDemo: Object.values(state.memories).some(isDemoMemory),
          }
        : null,
    [state],
  );
  if (!data) return null;
  const { stats, changes, activity, topics, hasDemo } = data;

  const activityItems: TimelineItem[] = activity.map(({ revision, demo }) => ({
    title: (
      <span className="inline-flex items-center gap-2">
        {revision.snapshot.title}
        {demo && <DemoBadge />}
      </span>
    ),
    description: `${revision.note || "Saved"} · ${revision.author}`,
    timestamp: formatDateTime(revision.savedAt ?? revision.createdAt),
    icon: "circle-dot",
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="Overview"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Your memories at a glance.
            {hasDemo && (
              <>
                <DemoBadge /> <span className="text-xs">Includes seeded demo memories.</span>
              </>
            )}
          </span>
        }
      />

      <section aria-label="Workspace stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Memories" value={stats.memories} icon="book-open" />
        <Link to="/inbox" className="rounded-lg focus-visible:outline-2" aria-label="Changes waiting for review, open Inbox">
          <Stat label="Short Term Memory" value={stats.pending} icon="inbox" color="amber" />
        </Link>
        <Stat label="Archived" value={stats.archived} icon="folder" />
        <Stat label="Saved changes" value={stats.saves} icon="circle-dot" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent changes" variant="outline" padding="sm">
          {changes.length === 0 ? (
            <EmptyState icon="inbox" title="No memories yet">
              Create your first memory from the Memories page.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {changes.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <Link
                    to={`/memories?memory=${encodeURIComponent(m.id)}`}
                    className="min-w-0 flex-1 truncate text-fg hover:underline"
                  >
                    {m.title}
                  </Link>
                  {isDemoMemory(m) && <DemoBadge />}
                  <StatusBadge status={m.status} />
                  <span className="w-16 text-right text-xs text-fg-subtle">{formatRelative(m.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" variant="outline" padding="sm">
          {activityItems.length === 0 ? (
            <EmptyState icon="circle-dot" title="Nothing saved yet">
              Edits you make are saved to long-term memory and show up here.
            </EmptyState>
          ) : (
            <Timeline items={activityItems} />
          )}
        </Card>

        <Card title="Frequently connected topics" variant="outline" padding="sm">
          {topics.length === 0 ? (
            <p className="text-sm text-fg-muted">Tag memories and link them to see topics here.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <li key={t.tag}>
                  <Link
                    to={`/memories?tag=${encodeURIComponent(t.tag)}`}
                    title={`${t.memories} memories, ${t.connections} connections`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-fg hover:bg-surface-muted"
                  >
                    #{t.tag}
                    <span className="text-fg-subtle">
                      {t.memories} · {t.connections} links
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="MCP status" variant="outline" padding="sm">
          <div className="flex items-start gap-3">
            <Badge variant="soft" color="slate" size="sm">
              Not connected
            </Badge>
            <p className="text-sm text-fg-muted">Not connected — backend not built yet. AI clients will connect here over MCP once it ships.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
