import { Badge, Button } from "lojee-ui";
import { typeLabel } from "../../components/memoryMeta";
import type { GraphEdge, GraphNode } from "./graphModel";
import { AMBER, typeColor } from "./graphStyle";

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
        {count !== undefined && <span className="ml-1 font-normal normal-case">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

interface Props {
  nodes: GraphNode[];
  clusters: string[][];
  activeClusterIndex: number | null;
  isolated: GraphNode[];
  selectedEdge: { edge: GraphEdge; sourceTitle: string; targetTitle: string } | null;
  onFocusCluster: (index: number) => void;
  onOpenMemory: (id: string) => void;
  onRemoveEdge: (id: string) => void;
}

export function GraphSidePanel({
  nodes,
  clusters,
  activeClusterIndex,
  isolated,
  selectedEdge,
  onFocusCluster,
  onOpenMemory,
  onRemoveEdge,
}: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const types = [...new Set(nodes.map((n) => n.type))].sort();

  return (
    <aside aria-label="Graph details" className="space-y-4 text-sm">
      {selectedEdge && (
        <Section title="Selected relation">
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-2" data-testid="selected-edge">
            <p className="text-fg">
              <span className="font-medium">{selectedEdge.sourceTitle}</span>{" "}
              <span className="text-fg-muted">
                — {selectedEdge.edge.label} →
              </span>{" "}
              <span className="font-medium">{selectedEdge.targetTitle}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" size="xs">
                {selectedEdge.edge.origin}
              </Badge>
              {selectedEdge.edge.demo && (
                <Badge variant="outline" size="xs" color="violet">
                  Demo
                </Badge>
              )}
            </div>
            <Button size="xs" variant="outline" icon="trash-2" onClick={() => onRemoveEdge(selectedEdge.edge.id)}>
              Remove relation
            </Button>
          </div>
        </Section>
      )}

      <Section title="Clusters" count={clusters.length}>
        {clusters.length === 0 ? (
          <p className="text-xs text-fg-muted">No connected groups yet.</p>
        ) : (
          <ul className="space-y-1" aria-label="Clusters">
            {clusters.map((ids, i) => {
              const top = ids
                .map((id) => byId.get(id))
                .filter((n): n is GraphNode => !!n)
                .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
                .slice(0, 2)
                .map((n) => n.title);
              const active = activeClusterIndex === i;
              return (
                <li key={ids[0]}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onFocusCluster(i)}
                    className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 ${
                      active ? "border-accent-500 bg-surface-muted" : "border-border"
                    }`}
                  >
                    <span className="block text-xs font-medium text-fg">
                      Cluster {i + 1} · {ids.length} memories
                    </span>
                    <span className="block truncate text-xs text-fg-muted">{top.join(", ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Isolated memories" count={isolated.length}>
        {isolated.length === 0 ? (
          <p className="text-xs text-fg-muted">Every memory has at least one relation.</p>
        ) : (
          <ul className="space-y-1" aria-label="Isolated memories">
            {isolated.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpenMemory(n.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg hover:bg-surface-muted focus-visible:outline-2"
                >
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: typeColor(n.type) }} />
                  <span className="min-w-0 truncate">{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Legend">
        <ul className="space-y-1 text-xs text-fg-muted" aria-label="Legend">
          {types.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: typeColor(t) }} />
              {typeLabel(t)}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="4" fill="var(--color-fg-subtle)" />
              <circle cx="7" cy="7" r="6" fill="none" stroke={AMBER} strokeWidth="1.5" />
            </svg>
            Waiting for review (amber ring)
          </li>
          <li className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="var(--color-fg-subtle)" fillOpacity="0.35" stroke="var(--color-fg-subtle)" strokeDasharray="3 2" />
            </svg>
            Archived (dashed, dim)
          </li>
          <li>Node size grows with the number of relations.</li>
        </ul>
      </Section>
    </aside>
  );
}
