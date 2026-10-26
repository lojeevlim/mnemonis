import { useMemo } from "react";
import { Badge, Button, Radio, RadioGroup } from "lojee-ui";
import { parseTitlePrefix } from "../../domain/titlePrefix";
import { MAX_ATTRIBUTE_NODES, type AttributeKind, type GraphEdge, type GraphNode } from "./graphModel";
import { AMBER, NEUTRAL, accentFill, ATTRIBUTE_DASH, type ProjectAccent } from "./graphStyle";

/** Colour dot for a node's project (neutral when it has none). `data-accent` scopes the accent variable to the dot. */
function ProjectDot({ project, accents, size = "size-2" }: { project: string | null; accents: ReadonlyMap<string, ProjectAccent>; size?: string }) {
  const a = project === null ? undefined : accents.get(project);
  return (
    <span
      aria-hidden="true"
      data-accent={a?.accent}
      data-project-dot={project ?? ""}
      className={`${size} shrink-0 rounded-full`}
      style={{ background: a ? accentFill(a.shade) : NEUTRAL }}
    />
  );
}

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

/** Projects present among the shown nodes, sorted by display name. Name: the real Project's name, else the hub's title, else the first member's prefix, else the key. */
function legendProjects(nodes: GraphNode[]): { key: string; name: string; count: number }[] {
  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) if (n.project !== null) {
    const g = groups.get(n.project);
    if (g) g.push(n);
    else groups.set(n.project, [n]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const hub = members.find((n) => n.isProject && n.project === key && (n.virtual || n.title.trim().toLowerCase().replace(/\s+/g, " ") === key));
      const first = members.find((n) => !n.virtual && parseTitlePrefix(n.title) !== null);
      const name = members.find((n) => n.projectName)?.projectName ?? hub?.title ?? (first ? parseTitlePrefix(first.title)!.trim().replace(/\s+/g, " ") : key);
      return { key, name, count: members.filter((n) => !n.virtual).length };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : 1));
}

const KIND_TOGGLE: Record<AttributeKind, { label: string; legend: string; hint: string }> = {
  collection: { label: "Collections", legend: "Collection", hint: `Up to ${MAX_ATTRIBUTE_NODES} collections, most used first.` },
  type: { label: "Types", legend: "Type", hint: `Up to ${MAX_ATTRIBUTE_NODES} types, most used first.` },
  tag: { label: "Tags", legend: "Tag", hint: `Up to ${MAX_ATTRIBUTE_NODES} tags, most used first.` },
  status: { label: "Statuses", legend: "Status", hint: "Saved, waiting for review or archived." },
};

const NO_ACCENTS: ReadonlyMap<string, ProjectAccent> = new Map();

interface Props {
  nodes: GraphNode[];
  /** Project key -> accent (computed from the unfiltered graph). */
  projectAccents?: ReadonlyMap<string, ProjectAccent>;
  clusters: string[][];
  activeClusterIndex: number | null;
  isolated: GraphNode[];
  selectedEdge: { edge: GraphEdge; sourceTitle: string; targetTitle: string } | null;
  /** Selected virtual project hub and its member memories. */
  selectedHub?: { hub: GraphNode; members: GraphNode[] } | null;
  creatingHub?: boolean;
  hubNotice?: string | null;
  onCreateHub?: (hub: GraphNode) => void;
  /** Kinds that have at least one hub to show (others are not offered), the one currently drawn (null = none) and its setter. */
  availableKinds?: readonly AttributeKind[];
  attributeKind?: AttributeKind | null;
  onChooseKind?: (kind: AttributeKind | null) => void;
  /** Selected attribute node and its member memories. */
  selectedAttribute?: { node: GraphNode; members: GraphNode[] } | null;
  onFocusCluster: (index: number) => void;
  onOpenMemory: (id: string) => void;
  onRemoveEdge: (id: string) => void;
}

export function GraphSidePanel({
  nodes,
  projectAccents = NO_ACCENTS,
  clusters,
  activeClusterIndex,
  isolated,
  selectedEdge,
  selectedHub = null,
  creatingHub = false,
  hubNotice = null,
  onCreateHub,
  availableKinds = [],
  attributeKind = null,
  onChooseKind,
  selectedAttribute = null,
  onFocusCluster,
  onOpenMemory,
  onRemoveEdge,
}: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const projects = useMemo(() => legendProjects(nodes), [nodes]);
  const unassigned = useMemo(() => nodes.filter((n) => n.project === null).length, [nodes]);

  return (
    <aside aria-label="Graph details" className="space-y-4 text-sm">
      {onChooseKind && availableKinds.length > 0 && (
        <Section title="Show as nodes">
          <div role="group" aria-label="Show as nodes">
            <RadioGroup orientation="horizontal">
              <Radio name="graph-attribute-kind" label="None" checked={attributeKind === null} onChange={() => onChooseKind(null)} />
              {availableKinds.map((k) => (
                <span key={k} title={KIND_TOGGLE[k].hint}>
                  <Radio name="graph-attribute-kind" label={KIND_TOGGLE[k].label} checked={attributeKind === k} onChange={() => onChooseKind(k)} />
                </span>
              ))}
            </RadioGroup>
          </div>
        </Section>
      )}

      {selectedHub && (
        <Section title="Selected project">
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-2" data-testid="selected-hub">
            <p className="text-fg">
              <span className="font-medium">Project {selectedHub.hub.title}</span> · {selectedHub.members.length}{" "}
              {selectedHub.members.length === 1 ? "memory" : "memories"} · no memory titled {selectedHub.hub.title} yet
            </p>
            <ul className="space-y-1" aria-label="Project memories">
              {selectedHub.members.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMemory(m.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg hover:bg-surface-raised focus-visible:outline-2"
                  >
                    <ProjectDot project={m.project} accents={projectAccents} />
                    <span className="min-w-0 truncate">{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {onCreateHub && (
              <Button size="xs" variant="outline" icon="plus" disabled={creatingHub} onClick={() => onCreateHub(selectedHub.hub)}>
                {`Create '${selectedHub.hub.title}' memory`}
              </Button>
            )}
            {hubNotice && (
              <p role="status" className="text-xs text-fg-muted">
                {hubNotice}
              </p>
            )}
          </div>
        </Section>
      )}

      {selectedAttribute && (
        <Section title={`Selected ${selectedAttribute.node.attr}`}>
          <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-2" data-testid="selected-attribute">
            <p className="text-fg">
              <span className="font-medium">{selectedAttribute.node.title}</span> · {selectedAttribute.members.length}{" "}
              {selectedAttribute.members.length === 1 ? "memory" : "memories"}
            </p>
            <ul className="space-y-1" aria-label="Attribute memories">
              {selectedAttribute.members.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onOpenMemory(m.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg hover:bg-surface-raised focus-visible:outline-2"
                  >
                    <ProjectDot project={m.project} accents={projectAccents} />
                    <span className="min-w-0 truncate">{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

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
              {selectedEdge.edge.derived && (
                <Badge variant="outline" size="xs">
                  Derived
                </Badge>
              )}
              {selectedEdge.edge.demo && (
                <Badge variant="outline" size="xs" color="violet">
                  Demo
                </Badge>
              )}
            </div>
            {selectedEdge.edge.derived ? (
              <p className="text-xs text-fg-muted">Derived from title prefix. It is not stored, so there is nothing to remove.</p>
            ) : (
              <Button size="xs" variant="outline" icon="trash-2" onClick={() => onRemoveEdge(selectedEdge.edge.id)}>
                Remove relation
              </Button>
            )}
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
                      Cluster {i + 1} · {ids.filter((id) => !byId.get(id)?.virtual).length} memories
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
                  <ProjectDot project={n.project} accents={projectAccents} />
                  <span className="min-w-0 truncate">{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Legend">
        <ul className="space-y-1 text-xs text-fg-muted" aria-label="Legend">
          {projects.map((p) => (
            <li key={p.key} className="flex items-center gap-2" data-legend-project={p.key}>
              <ProjectDot project={p.key} accents={projectAccents} size="size-2.5" />
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="ml-auto shrink-0">{p.count}</span>
            </li>
          ))}
          {unassigned > 0 && (
            <li className="flex items-center gap-2" data-legend-project="">
              <ProjectDot project={null} accents={projectAccents} size="size-2.5" />
              <span className="min-w-0 truncate">No project</span>
              <span className="ml-auto shrink-0">{unassigned}</span>
            </li>
          )}
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
          {attributeKind && (
            <li className="flex items-center gap-2" data-legend-attribute={attributeKind}>
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <circle r="6.5" fill={NEUTRAL} fillOpacity="0.12" stroke={NEUTRAL} strokeWidth="1.5" strokeDasharray={ATTRIBUTE_DASH[attributeKind]} />
              </svg>
              Biggest circle: a {KIND_TOGGLE[attributeKind].legend.toLowerCase()}, with its memories around it (dotted line)
            </li>
          )}
          <li>Node size grows with the number of relations.</li>
          <li>Big circle: a project, with its &ldquo;&lt;project&gt;: ...&rdquo; memories around it (dashed line: derived from the title).</li>
          <li className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="4" fill="var(--color-fg-subtle)" fillOpacity="0.6" />
              <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-fg-subtle)" strokeWidth="1.5" strokeDasharray="3 2" />
            </svg>
            Dashed big circle: a project found in a &ldquo;&lt;project&gt;: ...&rdquo; title that has no memory of that name yet.
          </li>
        </ul>
      </Section>
    </aside>
  );
}
