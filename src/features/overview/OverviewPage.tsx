import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, EmptyState, Stat, Timeline, type TimelineItem } from "lojee-ui";
import { DemoBadge } from "../../components/DemoBadge";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { formatDateTime, formatRelative, isDemoMemory } from "../../components/memoryMeta";
import { DEMO_TAG } from "../../data/seed";
import { useWorkspace } from "../../stores/workspaceStore";
import { frequentTopics, overviewStats, recentChanges, recentCommits } from "./selectors";

export function OverviewPage() {
  const state = useWorkspace((s) => s.state);
  const data = useMemo(
    () =>
      state
        ? {
            stats: overviewStats(state),
            changes: recentChanges(state, 6),
            commits: recentCommits(state, 5),
            topics: frequentTopics(state, { limit: 10, exclude: [DEMO_TAG] }),
            hasDemo: Object.values(state.memories).some(isDemoMemory),
          }
        : null,
    [state],
  );
  if (!data) return null;
  const { stats, changes, commits, topics, hasDemo } = data;

  const commitItems: TimelineItem[] = commits.map(({ commit, changeCount, demo }) => ({
    title: (
      <span className="inline-flex items-center gap-2">
        {commit.message}
        {demo && <DemoBadge />}
      </span>
    ),
    description: `${commit.author} · ${changeCount} ${changeCount === 1 ? "change" : "changes"}`,
    timestamp: formatDateTime(commit.timestamp),
    icon: "circle-dot",
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="Overview"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Branch <Badge variant="outline" size="sm" icon="git-branch">{stats.branchName}</Badge>
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
        <Link to="/memories?status=draft" className="rounded-lg focus-visible:outline-2" aria-label="Unsaved drafts, open in Memories">
          <Stat label="Drafts (unsaved)" value={stats.drafts} icon="pencil" color="amber" />
        </Link>
        <Stat label="Active branches" value={stats.branches} icon="git-branch" />
        <Stat label="Versions" value={stats.commits} icon="circle-dot" />
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

        <Card title="Recent versions" variant="outline" padding="sm">
          {commitItems.length === 0 ? (
            <EmptyState icon="circle-dot" title="No versions yet">
              Save your drafts as a version from the Memories page to record history.
            </EmptyState>
          ) : (
            <Timeline items={commitItems} />
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
