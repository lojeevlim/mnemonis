import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button } from "lojee-ui";
import { STATUS_META, typeLabel } from "../../components/memoryMeta";
import type { GraphEdge, GraphNode } from "./graphModel";
import { AMBER, NEUTRAL, accentFill, assignProjectAccents, ATTRIBUTE_DASH, ATTRIBUTE_KIND_LABEL, nodeRadius, type ProjectAccent } from "./graphStyle";

/** Selection/focus colour. Resolved on the svg root (see `style` there) so a node's own data-accent cannot recolour it. */
const RING = "var(--mn-ring, #64748b)";
import {
  DEFAULT_LAYOUT,
  fitTransform,
  maxSpeed,
  reconcile,
  runToSettle,
  step,
  zoomAt,
  type Link,
  type SimNode,
  type ViewTransform,
} from "./layout";

const SEED = 7;
const DEFAULT_SIZE = { w: 800, h: 560 };
const DRAG_THRESHOLD = 3;

export interface FocusRequest {
  ids: string[];
  nonce: number;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Project key -> accent. Pass one computed from the unfiltered graph so colours survive filtering; defaults to the shown nodes. */
  projectAccents?: ReadonlyMap<string, ProjectAccent>;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** When set, nodes outside it are dimmed (search matches, active cluster, ...). */
  emphasisIds?: ReadonlySet<string> | null;
  /** Nodes drawn with a highlight ring (isolated memories). */
  highlightIds?: ReadonlySet<string> | null;
  /** Source node while creating a relation. */
  linkSourceId?: string | null;
  /** Pan/zoom to these nodes whenever `nonce` changes. */
  focusRequest?: FocusRequest | null;
  /** Settle the layout instantly instead of animating. */
  reducedMotion?: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
}

interface Layout {
  key: string;
  nodes: SimNode[];
  links: Link[];
  /** Simulation heat; 0 = at rest. */
  alpha: number;
}

function topologyKey(nodes: GraphNode[], edges: GraphEdge[]): string {
  return nodes.map((n) => n.id).join(",") + "|" + edges.map((e) => `${e.source}>${e.target}`).join(",");
}

function computeLayout(prev: SimNode[], nodes: GraphNode[], edges: GraphEdge[], reduced: boolean): Layout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const radiusOf = (id: string): number => {
    const n = byId.get(id);
    return n ? nodeRadius(n) : 0;
  };
  // Project -> child and hub -> member edges get a rest length that keeps the child just outside the (bigger) hub circle.
  const links: Link[] = edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) =>
      e.prefix || e.attribute ? [e.source, e.target, radiusOf(e.source) + radiusOf(e.target) + 45] : [e.source, e.target],
    );
  const placed = reconcile(prev, ids, links, SEED);
  if (reduced) return { key: topologyKey(nodes, edges), nodes: runToSettle(placed, links).nodes, links, alpha: 0 };
  return { key: topologyKey(nodes, edges), nodes: placed, links, alpha: ids.length > 0 ? 1 : 0 };
}

function truncate(s: string, n = 24): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function GraphCanvas({
  nodes,
  edges,
  projectAccents: accentsProp,
  selectedNodeId = null,
  selectedEdgeId = null,
  emphasisIds = null,
  highlightIds = null,
  linkSourceId = null,
  focusRequest = null,
  reducedMotion = false,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
}: GraphCanvasProps) {
  const accents = useMemo(
    () => accentsProp ?? assignProjectAccents(nodes.flatMap((n) => (n.project === null ? [] : [n.project]))),
    [accentsProp, nodes],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [view, setView] = useState<ViewTransform | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [seenNonce, setSeenNonce] = useState(0);
  const [layout, setLayout] = useState<Layout>(() => computeLayout([], nodes, edges, reducedMotion));

  // Re-layout (keeping existing positions) whenever the node/edge set changes.
  const key = topologyKey(nodes, edges);
  if (layout.key !== key) setLayout(computeLayout(layout.nodes, nodes, edges, reducedMotion));

  const fit = useMemo(() => fitTransform(layout.nodes, size.w, size.h), [layout.nodes, size]);
  const current = view ?? fit;
  const fitRef = useRef(fit);
  const viewRef = useRef(current);
  useEffect(() => {
    fitRef.current = fit;
    viewRef.current = current;
  });

  // Focus request: derived during render so no effect/setState cascade is needed.
  if (focusRequest && focusRequest.nonce !== seenNonce) {
    setSeenNonce(focusRequest.nonce);
    const subset = layout.nodes.filter((n) => focusRequest.ids.includes(n.id));
    if (subset.length > 0) setView(fitTransform(subset, size.w, size.h, 140, 1.2));
  }

  // Measure the container (ResizeObserver is stubbed in jsdom, so a default size is used there).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animate the simulation until it cools down.
  const animating = layout.alpha > 0;
  useEffect(() => {
    if (!animating) return;
    let raf = 0;
    const tick = () => {
      setLayout((l) => {
        if (l.alpha <= 0) return l;
        const next = step(step(l.nodes, l.links, DEFAULT_LAYOUT, l.alpha), l.links, DEFAULT_LAYOUT, l.alpha);
        const alpha = l.alpha * 0.97;
        return { ...l, nodes: next, alpha: alpha < 0.03 || (alpha < 0.3 && maxSpeed(next) < 0.05) ? 0 : alpha };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animating]);

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView(zoomAt(viewRef.current, factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- dragging (window listeners so click events still reach the node) ----
  const suppressClick = useRef(false);
  const cleanupDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupDrag.current?.(), []);

  const beginDrag = (e: React.PointerEvent, nodeId: string | null) => {
    if (e.button !== 0) return;
    cleanupDrag.current?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const startView = viewRef.current;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (nodeId === null) {
        setView({ ...startView, x: startView.x + dx, y: startView.y + dy });
        return;
      }
      const rect = svgRef.current?.getBoundingClientRect();
      const wx = (ev.clientX - (rect?.left ?? 0) - startView.x) / startView.k;
      const wy = (ev.clientY - (rect?.top ?? 0) - startView.y) / startView.k;
      setView(startView); // freeze auto-fit while dragging
      setLayout((l) => ({
        ...l,
        nodes: l.nodes.map((n) => (n.id === nodeId ? { ...n, x: wx, y: wy, vx: 0, vy: 0, pinned: true } : n)),
        alpha: reducedMotion ? l.alpha : Math.max(l.alpha, 0.3),
      }));
    };
    const onUp = () => {
      cleanup();
      suppressClick.current = moved;
      if (moved) setTimeout(() => (suppressClick.current = false), 0);
      if (moved && nodeId !== null && reducedMotion) {
        setLayout((l) => ({ ...l, nodes: runToSettle(l.nodes, l.links).nodes }));
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cleanupDrag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    cleanupDrag.current = cleanup;
    if (nodeId !== null) e.stopPropagation();
  };

  const zoomBy = (factor: number) => setView(zoomAt(viewRef.current, factor, size.w / 2, size.h / 2));
  const panBy = (dx: number, dy: number) => setView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy });
  const resetView = () => setView(null);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    switch (e.key) {
      case "+":
      case "=":
        return handled(() => zoomBy(1.25));
      case "-":
      case "_":
        return handled(() => zoomBy(0.8));
      case "0":
        return handled(resetView);
      case "ArrowLeft":
        return handled(() => panBy(40, 0));
      case "ArrowRight":
        return handled(() => panBy(-40, 0));
      case "ArrowUp":
        return handled(() => panBy(0, 40));
      case "ArrowDown":
        return handled(() => panBy(0, -40));
    }
  };

  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const titles = nodeById;
  const showEdgeLabel = (e: GraphEdge) =>
    e.id === selectedEdgeId ||
    e.id === hoverEdge ||
    (selectedNodeId !== null && (e.source === selectedNodeId || e.target === selectedNodeId));

  const activate = (e: ReactKeyboardEvent, fn: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  };

  return (
    <div
      ref={wrapRef}
      role="group"
      aria-label="Knowledge graph canvas. Use plus and minus to zoom, arrow keys to pan, zero to fit."
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full min-h-[24rem] w-full overflow-hidden rounded-lg border border-border bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="block touch-none select-none"
        data-testid="graph-svg"
        // Resolved here, outside any data-accent element, so selection rings stay neutral on project-coloured nodes.
        style={{ "--mn-ring": "var(--color-accent-500, #64748b)" } as CSSProperties}
        role="presentation"
      >
        <rect
          width="100%"
          height="100%"
          fill="transparent"
          className="cursor-grab active:cursor-grabbing"
          data-testid="graph-background"
          onPointerDown={(e) => beginDrag(e, null)}
          onClick={() => {
            if (suppressClick.current) return;
            onClearSelection();
          }}
        />
        <g transform={`translate(${current.x} ${current.y}) scale(${current.k})`}>
          <g>
            {edges.map((e) => {
              const a = pos.get(e.source);
              const b = pos.get(e.target);
              const na = nodeById.get(e.source);
              const nb = nodeById.get(e.target);
              if (!a || !b || !na || !nb) return null;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const d = Math.hypot(dx, dy) || 1;
              const ux = dx / d;
              const uy = dy / d;
              const x1 = a.x + ux * nodeRadius(na);
              const y1 = a.y + uy * nodeRadius(na);
              const x2 = b.x - ux * (nodeRadius(nb) + 2);
              const y2 = b.y - uy * (nodeRadius(nb) + 2);
              if (e.attribute) {
                const dimAttr = emphasisIds && !(emphasisIds.has(e.source) && emphasisIds.has(e.target));
                return (
                  <line
                    key={e.id}
                    data-attr-edge={e.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--color-fg-subtle, #7c8aa0)"
                    strokeOpacity={dimAttr ? 0.08 : 0.35}
                    strokeWidth={1}
                    strokeDasharray="1.5 3.5"
                    strokeLinecap="round"
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                );
              }
              const selected = e.id === selectedEdgeId;
              const touching = selectedNodeId !== null && (e.source === selectedNodeId || e.target === selectedNodeId);
              const active = selected || touching || e.id === hoverEdge;
              const dim = emphasisIds && !(emphasisIds.has(e.source) && emphasisIds.has(e.target));
              const labelVisible = showEdgeLabel(e);
              const edgeProject = e.prefix ? nodeById.get(e.target)?.project ?? null : null;
              const edgeAccent = edgeProject === null ? undefined : accents.get(edgeProject);
              const description = `Relation: ${titles.get(e.source)?.title} ${e.label} ${titles.get(e.target)?.title}${e.derived ? " (derived from title prefix)" : ""}`;
              return (
                <g
                  key={e.id}
                  data-edge-id={e.id}
                  data-accent={edgeAccent?.accent}
                  data-selected={selected || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={description}
                  aria-pressed={selected}
                  opacity={dim ? 0.15 : 1}
                  className="cursor-pointer focus-visible:outline-none"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectEdge(e.id);
                  }}
                  onKeyDown={(ev) => activate(ev, () => onSelectEdge(e.id))}
                  onPointerEnter={() => setHoverEdge(e.id)}
                  onPointerLeave={() => setHoverEdge((h) => (h === e.id ? null : h))}
                  onFocus={() => setHoverEdge(e.id)}
                  onBlur={() => setHoverEdge((h) => (h === e.id ? null : h))}
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={active ? RING : edgeAccent ? accentFill(edgeAccent.shade) : "var(--color-fg-subtle, #7c8aa0)"}
                    strokeOpacity={active ? 1 : edgeAccent ? 0.55 : 0.45}
                    strokeWidth={selected ? 2.5 : active ? 1.8 : 1.2}
                    strokeDasharray={e.derived ? "4 3" : undefined}
                  />
                  {labelVisible && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--color-fg, #f1f5f9)"
                      stroke="var(--color-surface-raised, #111a2b)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      pointerEvents="none"
                      data-edge-label={e.id}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <g>
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const r = nodeRadius(n);
              const selected = n.id === selectedNodeId;
              const isLinkSource = n.id === linkSourceId;
              const highlighted = !!highlightIds?.has(n.id);
              const dim = emphasisIds ? !emphasisIds.has(n.id) : false;
              const accent = n.project === null ? undefined : accents.get(n.project);
              const color = accent ? accentFill(accent.shade) : NEUTRAL;
              const project = n.isProject ? `project with ${n.childCount} ${n.childCount === 1 ? "memory" : "memories"}, ` : "";
              const relations = `${n.degree} ${n.degree === 1 ? "relation" : "relations"}`;
              const label = n.attr
                ? `${n.title}, ${n.attr} node, ${n.degree} ${n.degree === 1 ? "memory" : "memories"}`
                : n.virtual
                ? `${n.title}, ${project.replace(/, $/, "")} (no memory titled ${n.title} yet), ${relations}`
                : `${n.title}, ${project}${typeLabel(n.type)}, ${STATUS_META[n.status].label}, ${relations}`;
              return (
                <g
                  key={n.id}
                  data-node-id={n.id}
                  data-accent={accent?.accent}
                  data-selected={selected || undefined}
                  data-virtual={n.virtual || undefined}
                  data-attribute={n.attr}
                  data-highlighted={highlighted || undefined}
                  data-dimmed={dim || undefined}
                  data-pinned={p.pinned || undefined}
                  transform={`translate(${p.x} ${p.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selected}
                  opacity={dim ? 0.2 : n.archived ? 0.6 : 1}
                  className="cursor-pointer focus-visible:outline-none [&:focus-visible>circle.mn-focus]:opacity-100"
                  onPointerDown={(e) => beginDrag(e, n.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClick.current) return;
                    onSelectNode(n.id);
                  }}
                  onKeyDown={(e) => activate(e, () => onSelectNode(n.id))}
                >
                  <circle className="mn-focus opacity-0" r={r + 8} fill="none" stroke={RING} strokeWidth={2} />
                  {(selected || isLinkSource) && (
                    <circle r={r + 6} fill="none" stroke={RING} strokeWidth={2} strokeDasharray={isLinkSource && !selected ? "4 3" : undefined} />
                  )}
                  {n.attr && (
                    <>
                      <circle
                        r={r}
                        fill={NEUTRAL}
                        fillOpacity={0.12}
                        stroke={NEUTRAL}
                        strokeWidth={2}
                        strokeDasharray={ATTRIBUTE_DASH[n.attr]}
                        strokeLinecap="round"
                      />
                      <text y={4} textAnchor="middle" fontSize={10} fill={NEUTRAL} pointerEvents="none" data-attr-kind-label={n.attr}>
                        {ATTRIBUTE_KIND_LABEL[n.attr]}
                      </text>
                    </>
                  )}
                  {highlighted && <circle r={r + 5} fill="none" stroke={AMBER} strokeWidth={1.5} strokeDasharray="2 3" />}
                  {n.status === "pending" && !n.attr && <circle r={r + 3} fill="none" stroke={AMBER} strokeWidth={2} />}
                  {n.virtual && (
                    <circle r={r + 3} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" data-virtual-ring="true" />
                  )}
                  {!n.attr && <circle
                    r={r}
                    fill={color}
                    fillOpacity={n.archived ? 0.35 : n.virtual ? 0.6 : 0.9}
                    stroke={color}
                    strokeWidth={n.virtual ? 2 : n.archived ? 1.5 : 1}
                    strokeDasharray={n.virtual ? "6 4" : n.archived ? "3 2" : undefined}
                  />}
                  {(current.k >= 0.5 || selected || n.isProject || n.attr) && (
                    <text
                      y={r + 13}
                      textAnchor="middle"
                      fontSize={n.isProject || n.attr ? 13 : 11}
                      fontWeight={n.isProject || n.attr ? 600 : undefined}
                      fill="var(--color-fg, #f1f5f9)"
                      stroke="var(--color-surface-raised, #111a2b)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {truncate(n.title)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <Button size="sm" variant="outline" icon="plus" iconOnly label="Zoom in" onClick={() => zoomBy(1.25)} />
        <Button size="sm" variant="outline" icon="minus" iconOnly label="Zoom out" onClick={() => zoomBy(0.8)} />
        <Button size="sm" variant="outline" icon="scan" iconOnly label="Fit to view" onClick={resetView} />
      </div>
    </div>
  );
}
