import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assignProjectOrganization, createOrganization, listMemories, listRelations } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { GraphPage } from "./GraphPage";

const store = () => useWorkspace.getState();
/** Saved relations only: the seed also carries a pending agent link, which the graph must not draw. */
const savedRelations = () => listRelations(store().state!);
const renderPage = (path = "/graph") => renderAt(path, "/graph", <GraphPage />);
/** Real memories only: virtual project hubs and their derived edges are asserted separately. */
const nodeEls = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>("[data-node-id]:not([data-virtual]):not([data-attribute])")];
const edgeEls = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>("[data-edge-id]:not([data-edge-id*=':project:'])")];
const nodeEl = (c: HTMLElement, id: string) => c.querySelector<SVGGElement>(`[data-node-id="${id}"]`)!;

const realMatchMedia = window.matchMedia;
beforeEach(async () => {
  // Reduced motion: layout settles synchronously, no rAF updates outside act().
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  await resetWorkspace({ seed: true });
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("Graph: rendering the seed", () => {
  it("draws every memory and only stored relations", () => {
    const { container } = renderPage();
    expect(nodeEls(container)).toHaveLength(18);
    expect(edgeEls(container)).toHaveLength(savedRelations().length);
    expect(edgeEls(container)).toHaveLength(16);
    // The seed's repeated "Decision:", "Meeting:", ... prefixes add 7 virtual hubs (Decision 3, Meeting 2, Procedure 2, Research 2, Task 2, Project 1, Reference 1) and 13 derived edges.
    expect(container.querySelectorAll("[data-virtual]")).toHaveLength(7);
    expect(screen.getByText(/18 memories · 29 relations/)).toBeInTheDocument();
    // Clusters panel: one cluster of 16, two isolated.
    expect(screen.getByText("Cluster 1 · 16 memories")).toBeInTheDocument();
  });

  it("shows edge labels only for the selected or hovered edge", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll("[data-edge-label]")).toHaveLength(0);
    const edge = edgeEls(container)[0];
    fireEvent.click(edge);
    expect(container.querySelectorAll(`[data-edge-label="${edge.getAttribute("data-edge-id")}"]`)).toHaveLength(1);
    expect(screen.getByTestId("selected-edge")).toBeInTheDocument();
  });

  it("shows an empty state without memories", async () => {
    await resetWorkspace();
    renderPage();
    expect(screen.getByText("No memories to graph yet")).toBeInTheDocument();
  });

  it("hints when there are memories but no relations", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "Solo", content: "x", type: "fact", tags: [] });
    const { container } = renderPage();
    expect(nodeEls(container)).toHaveLength(1);
    expect(screen.getByText(/No relations yet/)).toBeInTheDocument();
  });
});

describe("Graph: project hubs", () => {
  it("draws a derived, read-only prefix edge to a project hub with a descriptive label", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "VT", content: "x", type: "project", tags: [] });
    await store().createMemory({ title: "VT: run build", content: "x", type: "fact", tags: [] });
    // Mimic memories saved before the feature: no stored relation between them.
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
    const { container } = renderPage();
    expect(screen.getByLabelText(/^VT, project with 1 memory,/)).toBeInTheDocument();
    expect(edgeEls(container)).toHaveLength(1);
    fireEvent.click(edgeEls(container)[0]);
    expect(within(screen.getByTestId("selected-edge")).getByText(/Derived from title prefix/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove relation" })).not.toBeInTheDocument();
  });
});

describe("Graph: removing prefix relations", () => {
  const removeDialog = async (container: HTMLElement) => {
    fireEvent.click(edgeEls(container)[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove relation" }));
    return within(await screen.findByRole("dialog"));
  };

  it("hints that a title-prefix relation reappears", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "VT", content: "x", type: "project", tags: [] });
    await store().createMemory({ title: "VT: run build", content: "x", type: "fact", tags: [] });
    const { container } = renderPage();
    expect((await removeDialog(container)).getByText(/will reappear while the titles still match/)).toBeInTheDocument();
  });

  it("does not hint for a manual relation", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "A", content: "x", type: "fact", tags: [] });
    await store().createMemory({ title: "B", content: "x", type: "fact", tags: [] });
    const [a, b] = Object.keys(store().state!.memories);
    await store().addRelation(a, b, "part of");
    const { container } = renderPage();
    expect((await removeDialog(container)).queryByText(/will reappear/)).not.toBeInTheDocument();
  });
});

describe("Graph: selection", () => {
  it("opens the memory detail drawer when a node is selected (Enter or click)", async () => {
    const { container } = renderPage();
    fireEvent.click(nodeEl(container, "mem_proj_mnemonis"));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Project: Mnemonis", { selector: "h3" })).toBeInTheDocument();
    expect(within(drawer).getByRole("list", { name: "Related memories" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("memory=mem_proj_mnemonis");
    expect(nodeEl(container, "mem_proj_mnemonis")).toHaveAttribute("data-selected", "true");
  });

  it("selects with the keyboard", async () => {
    const { container } = renderPage();
    const n = nodeEl(container, "mem_profile");
    expect(n).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(n, { key: "Enter" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("memory=mem_profile");
  });

  it("zooms with + / - and the buttons, and fits the view", () => {
    const { container } = renderPage();
    const group = screen.getByRole("group", { name: /Knowledge graph canvas/ });
    const transform = () => container.querySelector("svg > g")!.getAttribute("transform");
    const before = transform();
    fireEvent.keyDown(group, { key: "+" });
    const zoomed = transform();
    expect(zoomed).not.toBe(before);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(transform()).not.toBe(zoomed);
    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(transform()).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(transform()).not.toBe(before);
  });
});

describe("Graph: dragging", () => {
  it("pins a dragged node without selecting it", () => {
    const { container } = renderPage();
    const n = nodeEl(container, "mem_profile");
    fireEvent.pointerDown(n, { button: 0, clientX: 100, clientY: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 160, clientY: 140 }));
    fireEvent(window, new MouseEvent("pointerup", { clientX: 160, clientY: 140 }));
    expect(nodeEl(container, "mem_profile")).toHaveAttribute("data-pinned", "true");
    fireEvent.click(nodeEl(container, "mem_profile")); // click right after a drag is swallowed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Graph: filters and search", () => {
  it("reduces the nodes when filtering by collection, tag and type", () => {
    const { container } = renderPage();
    const col = Object.values(store().state!.collections).find((c) => c.name === "Personal")!;
    fireEvent.change(nativeSelect(container, "Filter by collection"), { target: { value: col.id } });
    expect(nodeEls(container).map((n) => n.getAttribute("data-node-id")).sort()).toEqual([
      "mem_pref_dark",
      "mem_pref_writing",
      "mem_profile",
    ]);
    expect(edgeEls(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(nodeEls(container)).toHaveLength(18);

    fireEvent.change(nativeSelect(container, "Filter by type"), { target: { value: "task" } });
    expect(nodeEls(container)).toHaveLength(2);
    fireEvent.change(nativeSelect(container, "Filter by type"), { target: { value: "" } });
    fireEvent.change(nativeSelect(container, "Filter by tag"), { target: { value: "mcp" } });
    expect(nodeEls(container).map((n) => n.getAttribute("data-node-id")).sort()).toEqual(["mem_fact_mcp", "mem_task_mcp"]);
    expect(edgeEls(container)).toHaveLength(1);
  });

  it("shows an empty state when filters match nothing", () => {
    const { container } = renderPage("/graph?type=task&tag=profile");
    expect(nodeEls(container)).toHaveLength(0);
    expect(screen.getByText("No memories match")).toBeInTheDocument();
  });

  it("dims non-matches when searching", () => {
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText("Search graph"), { target: { value: "zustand" } });
    expect(screen.getByText(/1 match/)).toBeInTheDocument();
    expect(nodeEl(container, "mem_dec_zustand")).not.toHaveAttribute("data-dimmed");
    expect(nodeEl(container, "mem_profile")).toHaveAttribute("data-dimmed", "true");
  });

  it("highlights isolated memories and lists them", () => {
    const { container } = renderPage();
    const list = screen.getByRole("list", { name: "Isolated memories" });
    expect(within(list).getByText("About me")).toBeInTheDocument();
    expect(within(list).getByText("Writing style preferences")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelectorAll("[data-highlighted]")).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("Highlight isolated memories"));
    const highlighted = [...container.querySelectorAll("[data-highlighted]")].map((n) => n.getAttribute("data-node-id")).sort();
    expect(highlighted).toEqual(["mem_pref_writing", "mem_profile"]);
    expect(nodeEl(container, "mem_proj_mnemonis")).toHaveAttribute("data-dimmed", "true");
  });

  it("focuses a cluster from the summary list", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Cluster 1/ }));
    expect(screen.getByRole("button", { name: /Cluster 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(nodeEl(container, "mem_profile")).toHaveAttribute("data-dimmed", "true");
    expect(nodeEl(container, "mem_proj_mnemonis")).not.toHaveAttribute("data-dimmed");
  });
});

describe("Graph: relations", () => {
  it("creates a relation in link mode and persists it", async () => {
    const { container } = renderPage();
    const before = savedRelations().length;
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(nodeEl(container, "mem_profile"));
    expect(screen.getByText(/Now click the target memory/)).toBeInTheDocument();
    fireEvent.click(nodeEl(container, "mem_pref_writing"));
    // Link mode never opens the drawer.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Relation label"), { target: { value: "writes like" } });
    fireEvent.click(screen.getByRole("button", { name: "Create relation" }));

    await waitFor(() => expect(savedRelations()).toHaveLength(before + 1));
    const rel = Object.values(store().state!.relations).find((r) => r.label === "writes like")!;
    expect(rel).toMatchObject({ fromId: "mem_profile", toId: "mem_pref_writing", provenance: { origin: "user" } });
    await waitFor(() => expect(edgeEls(container)).toHaveLength(before + 1));
    expect(container.querySelector(`[data-edge-id="${rel.id}"]`)).not.toBeNull();
    // Both nodes are no longer isolated.
    expect(screen.getByText("Every memory has at least one relation.")).toBeInTheDocument();
  });

  it("shows a duplicate-relation error inline and keeps the form", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(nodeEl(container, "mem_proj_mnemonis"));
    fireEvent.click(nodeEl(container, "mem_dec_zustand"));
    fireEvent.change(screen.getByLabelText("Relation label"), { target: { value: "decided" } });
    fireEvent.click(screen.getByRole("button", { name: "Create relation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Relation already exists");
    expect(savedRelations()).toHaveLength(16);
  });

  it("cancels a pending link by clicking the source again", () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(nodeEl(container, "mem_profile"));
    fireEvent.click(nodeEl(container, "mem_profile"));
    expect(screen.getByText(/click the source memory/)).toBeInTheDocument();
  });

  it("removes a selected relation after confirmation", async () => {
    const { container } = renderPage();
    const edge = edgeEls(container)[0];
    const id = edge.getAttribute("data-edge-id")!;
    fireEvent.click(edge);
    fireEvent.click(screen.getByRole("button", { name: "Remove relation" }));
    const dialog = await screen.findByRole("dialog");
    expect(store().state!.relations[id]).toBeDefined(); // not removed until confirmed
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store().state!.relations[id]).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove relation" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(store().state!.relations[id]).toBeUndefined());
    await waitFor(() => expect(edgeEls(container)).toHaveLength(15));
    expect(screen.queryByTestId("selected-edge")).not.toBeInTheDocument();
  });
});

describe("Graph: virtual project hubs", () => {
  const userTitles = [
    "vt: ticket selling feature flow and gotchas",
    "vt: conductor payout flow (Stripe Connect)",
    "VT run, build, test",
    "VT project overview",
    "VT coding conventions",
    "VT new-developer first steps",
  ];
  const seedVt = async () => {
    await resetWorkspace();
    for (const title of userTitles) await store().createMemory({ title, content: "x", type: "fact", tags: [] });
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
  };
  const hubEl = (c: HTMLElement) => c.querySelector<SVGGElement>('[data-node-id="project:vt"]')!;

  it("draws a hub for a single colon memory with the singular label", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "VT: only one", content: "x", type: "fact", tags: [] });
    const { container } = renderPage();
    expect(hubEl(container)).toHaveAttribute("aria-label", "VT, project with 1 memory (no memory titled VT yet), 1 relation");
    expect(container.querySelectorAll('[data-edge-id="prefix:' + Object.keys(store().state!.memories)[0] + ':project:vt"]')).toHaveLength(1);
  });

  it("draws one dashed hub with a descriptive label and six derived edges", async () => {
    await seedVt();
    const { container } = renderPage();
    const hub = hubEl(container);
    expect(hub).toHaveAttribute("aria-label", "VT, project with 6 memories (no memory titled VT yet), 6 relations");
    expect(hub).toHaveAttribute("data-virtual", "true");
    expect(hub.querySelector("[data-virtual-ring]")).toHaveAttribute("stroke-dasharray");
    expect(hub).toHaveTextContent("VT");
    expect(container.querySelectorAll("[data-edge-id*=':project:vt']")).toHaveLength(6);
    expect(screen.getByText(/6 memories · 6 relations/)).toBeInTheDocument();
  });

  it("shows the hub in the side panel with its members, without opening the memory drawer", async () => {
    await seedVt();
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    const panel = screen.getByTestId("selected-hub");
    expect(panel).toHaveTextContent("Project VT · 6 memories · no memory titled VT yet");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("memory=project%3Avt");
    fireEvent.click(within(panel).getByRole("button", { name: "VT project overview" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("selected-hub")).not.toBeInTheDocument();
  });

  it("does not open a drawer for a hub id in the URL", async () => {
    await seedVt();
    renderPage("/graph?memory=project%3Avt");
    expect(screen.getByTestId("selected-hub")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates the real memory as the user and replaces the hub", async () => {
    await resetWorkspace();
    await store().createMemory({ title: "vt: one", content: "x", type: "fact", tags: [] });
    await store().createMemory({ title: "vt: two", content: "x", type: "fact", tags: [] });
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    fireEvent.click(screen.getByRole("button", { name: "Create 'vt' memory" }));
    await waitFor(() => expect(hubEl(container)).toBeNull());
    expect(container.querySelectorAll("[data-virtual]")).toHaveLength(0);
    expect(nodeEls(container)).toHaveLength(3);
    // Two stored relations only: no derived duplicates.
    expect(savedRelations()).toHaveLength(2);
    expect(edgeEls(container)).toHaveLength(2);
    expect(screen.getByLabelText(/^vt, project with 2 memories, project, Long Term Memory, 2 relations$/)).toBeInTheDocument();
  });

  const twoVt = async () => {
    await resetWorkspace();
    await store().createMemory({ title: "vt: one", content: "x", type: "fact", tags: [] });
    await store().createMemory({ title: "vt: two", content: "x", type: "fact", tags: [] });
  };
  const listTitles = () => listMemories(store().state!, { includePending: true }).map((m) => m.title);
  const countTitled = (t: string) => listTitles().filter((x) => x === t).length;

  it("tags the created hub memory with the project name", async () => {
    await twoVt();
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    fireEvent.click(screen.getByRole("button", { name: "Create 'vt' memory" }));
    await waitFor(() => expect(hubEl(container)).toBeNull());
    const hub = listMemories(store().state!).find((m) => m.title === "vt")!;
    expect(hub.tags).toContain("vt");
  });

  it("does not create a duplicate when an archived memory has the hub title", async () => {
    await twoVt();
    const m = await store().createMemory({ title: "VT", content: "x", type: "project", tags: [] });
    await store().archiveMemory(m!.id);
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    fireEvent.click(screen.getByRole("button", { name: /^Create '/ }));
    expect(await screen.findByText(/already exists \(archived\)/)).toBeInTheDocument();
    expect(listTitles().filter((t) => t.toLowerCase() === "vt")).toHaveLength(1);
  });

  it("does not create a duplicate when a pending memory has the hub title", async () => {
    await twoVt();
    await store().createMemory(
      { title: "VT", content: "x", type: "project", tags: [] },
      { actor: { kind: "agent", name: "bot" } },
    );
    expect(listMemories(store().state!).some((m) => m.title === "VT")).toBe(false);
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    fireEvent.click(screen.getByRole("button", { name: /^Create '/ }));
    expect(await screen.findByText(/already exists \(pending\)/)).toBeInTheDocument();
    expect(listTitles().filter((t) => t.toLowerCase() === "vt")).toHaveLength(1);
  });

  it("creates only one memory on a double click", async () => {
    await twoVt();
    const { container } = renderPage();
    fireEvent.click(hubEl(container));
    const btn = screen.getByRole("button", { name: "Create 'vt' memory" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(hubEl(container)).toBeNull());
    expect(countTitled("vt")).toBe(1);
  });

  it("clears a stale project: id from the URL", async () => {
    await twoVt();
    renderPage("/graph?memory=project%3Agone");
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("memory="));
  });

  it("refuses to link a virtual hub in link mode", async () => {
    await seedVt();
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(hubEl(container));
    expect(screen.getByRole("status")).toHaveTextContent(/not a memory yet, so it cannot be linked/);
    expect(screen.getByText(/click the source memory/)).toBeInTheDocument();
    fireEvent.click(nodeEls(container)[0]);
    fireEvent.click(hubEl(container));
    expect(screen.getByText(/Now click the target memory/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Relation label")).not.toBeInTheDocument();
    expect(savedRelations()).toHaveLength(0);
  });
});

describe("Graph: colours per project", () => {
  const mk = async (titles: string[]) => {
    await resetWorkspace();
    for (const title of titles) await store().createMemory({ title, content: "x", type: "fact", tags: [] });
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
  };
  const accentOf = (c: HTMLElement, id: string) => nodeEl(c, id).getAttribute("data-accent");

  it("gives members, hub and edges of a project one accent, and other projects another", async () => {
    await mk(["VT: one", "VT: two", "Mnemo: a", "Mnemo: b", "Loose note"]);
    const { container } = renderPage();
    const ids = Object.fromEntries(listMemories(store().state!).map((m) => [m.title, m.id]));
    const vt = accentOf(container, "project:vt");
    const mn = accentOf(container, "project:mnemo");
    expect(vt).toBeTruthy();
    expect(mn).toBeTruthy();
    expect(vt).not.toBe(mn);
    expect(accentOf(container, ids["VT: one"])).toBe(vt);
    expect(accentOf(container, ids["VT: two"])).toBe(vt);
    expect(accentOf(container, ids["Mnemo: a"])).toBe(mn);
    expect(container.querySelector(`[data-edge-id="prefix:${ids["VT: one"]}:project:vt"]`)).toHaveAttribute("data-accent", vt!);
    expect(container.querySelector(`[data-edge-id="prefix:${ids["Mnemo: b"]}:project:mnemo"]`)).toHaveAttribute("data-accent", mn!);
    expect(nodeEl(container, ids["Loose note"])).not.toHaveAttribute("data-accent");
    expect(nodeEl(container, ids["Loose note"]).querySelector("circle:not(.mn-focus)")).toHaveAttribute("fill", expect.stringContaining("slate-400"));
    expect(nodeEl(container, "project:vt").querySelector("circle[fill^='var(--color-accent-']")).not.toBeNull();
  });

  it("lists projects with colour dots and a No project entry in the legend", async () => {
    await mk(["VT: one", "VT: two", "Mnemo: a", "Loose note"]);
    renderPage();
    const legend = screen.getByRole("list", { name: "Legend" });
    const rows = [...legend.querySelectorAll<HTMLElement>("[data-legend-project]")];
    expect(rows.map((r) => r.getAttribute("data-legend-project"))).toEqual(["mnemo", "vt", ""]);
    expect(rows[0]).toHaveTextContent("Mnemo");
    expect(rows[1]).toHaveTextContent("VT");
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[2]).toHaveTextContent("No project");
    const dot = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-project-dot]")!;
    expect(dot(rows[1]).getAttribute("data-accent")).toBeTruthy();
    expect(dot(rows[1]).getAttribute("data-accent")).not.toBe(dot(rows[0]).getAttribute("data-accent"));
    expect(dot(rows[1]).style.background).toContain("--color-accent-");
    expect(dot(rows[2])).not.toHaveAttribute("data-accent");
  });

  it("keeps project colours when a filter hides other projects", async () => {
    await resetWorkspace();
    for (const [title, tags] of [["VT: one", ["k"]], ["Mnemo: a", []], ["Zed: z", []], ["Abc: z", []]] as const)
      await store().createMemory({ title, content: "x", type: "fact", tags: [...tags] });
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
    const first = renderPage();
    const before = accentOf(first.container, "project:vt");
    first.unmount();
    renderPage("/graph?tag=k");
    expect(document.querySelector('[data-node-id="project:mnemo"]')).toBeNull();
    expect(document.querySelector('[data-node-id="project:vt"]')!.getAttribute("data-accent")).toBe(before);
  });

  it("keeps project colours when 'Show archived' is toggled, even with archived-only projects", async () => {
    await resetWorkspace();
    for (const title of ["VT: one", "Mnemo: a", "Stripe: s"]) await store().createMemory({ title, content: "x", type: "fact", tags: [] });
    for (const p of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Omega"]) {
      const m = await store().createMemory({ title: `${p}: x`, content: "x", type: "fact", tags: [] });
      await store().archiveMemory(m!.id);
    }
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
    const { container } = renderPage();
    const keys = ["project:vt", "project:mnemo", "project:stripe"];
    const before = keys.map((k) => accentOf(container, k));
    expect(document.querySelector('[data-node-id="project:alpha"]')).toBeNull();
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(document.querySelector('[data-node-id="project:alpha"]')).not.toBeNull();
    expect(keys.map((k) => accentOf(container, k))).toEqual(before);
    expect(before.every(Boolean)).toBe(true);
  });
});

describe("Graph: auto-fit", () => {
  const vp = (c: HTMLElement) => c.querySelector<SVGGElement>("[data-testid=graph-viewport]")!;

  it("fits the view including the category nodes, stops after a manual zoom and resumes on Fit to view", () => {
    const { container } = renderPage();
    expect(vp(container)).toHaveAttribute("data-auto-fit", "true");
    expect(container.querySelector("[data-attribute]")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("group", { name: /Knowledge graph canvas/ }), { key: "+" });
    expect(vp(container)).toHaveAttribute("data-auto-fit", "false");
    const manual = vp(container).getAttribute("transform");

    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(vp(container)).toHaveAttribute("data-auto-fit", "true");
    expect(vp(container).getAttribute("transform")).not.toBe(manual);
  });

  it("jumps instead of easing under reduced motion", () => {
    const { container } = renderPage();
    expect(vp(container).style.transition).toBe("none");
  });
});

describe("Graph: category hubs and value nodes", () => {
  const attrEls = (c: HTMLElement, kind?: string, role?: string) =>
    [...c.querySelectorAll<SVGGElement>(`[data-attribute${kind ? `="${kind}"` : ""}]${role ? `[data-attribute-role="${role}"]` : ""}`)];
  const radius = (el: Element) => Number(el.querySelector("circle:not(.mn-focus)")!.getAttribute("r"));

  it("has no \"Show as nodes\" config and draws every category by default", () => {
    const { container } = renderPage();
    expect(screen.queryByText("Show as nodes")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Show as nodes" })).not.toBeInTheDocument();
    for (const k of ["Collections", "Types", "Statuses", "Tags"]) expect(screen.queryByLabelText(k)).not.toBeInTheDocument();
    expect(attrEls(container, undefined, "category").map((n) => n.getAttribute("data-node-id")).sort()).toEqual([
      "category:collection",
      "category:status",
      "category:tag",
      "category:type",
    ]);
    expect(container.querySelectorAll("[data-attr-edge]").length).toBeGreaterThan(0);
  });

  it("shows a big category hub (bigger than a project hub) with small value nodes (smaller than a memory) around it", () => {
    const { container } = renderPage();
    const hubs = attrEls(container, "collection", "category");
    const values = attrEls(container, "collection", "value");
    expect(hubs.map((h) => h.getAttribute("data-node-id"))).toEqual(["category:collection"]);
    expect(values.length).toBeGreaterThan(0);
    expect(hubs[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Collections, \d+ values?$/));
    // big circle: the label sits inside it (name, then the count)
    expect(hubs[0].textContent).toMatch(/^Collections\d+ values?$/);
    expect(hubs[0].querySelector("[data-label-inside]")).toBeInTheDocument();
    for (const v of values) expect(v.querySelector("[data-label-inside]")).toBeInTheDocument();
    const projectHub = container.querySelector<SVGGElement>("[data-virtual][data-node-id^='project:']")!;
    expect(radius(hubs[0])).toBeGreaterThan(radius(projectHub));
    const smallestMemory = Math.min(...nodeEls(container).filter((n) => !n.hasAttribute("data-attribute")).map(radius));
    // a collection node is as big as an organization hub (so smaller than its Collections hub), unlike tag / type / status nodes
    for (const v of values) expect(radius(v)).toBeGreaterThan(smallestMemory);
    for (const v of values) expect(radius(v)).toBeLessThan(radius(hubs[0]));
    // value -> category edges (solid) and memory -> value links (dotted).
    expect(container.querySelectorAll("[data-attr-edge^=\"cat:collection:\"][data-category-edge]")).toHaveLength(values.length);
    const memoryLinks = [...container.querySelectorAll("[data-attr-edge]:not([data-category-edge]):not([data-project-link])")];
    expect(memoryLinks.length).toBeGreaterThan(0);
    expect(memoryLinks[0]).toHaveAttribute("stroke-dasharray");
    expect(container.querySelector("[data-attr-edge][data-category-edge]")).not.toHaveAttribute("stroke-dasharray");
    expect(container.querySelector("[data-legend-attribute=collection]")).toBeInTheDocument();
  });

  it("lists one legend entry per shown category; memory and relation counts are unchanged", () => {
    const { container } = renderPage();
    for (const k of ["collection", "type", "status", "tag"]) expect(container.querySelector(`[data-legend-attribute=${k}]`)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-legend-attribute]")).toHaveLength(4);
    expect(screen.getByText(/18 memories · 29 relations/)).toBeInTheDocument();
    expect(nodeEls(container).filter((n) => !n.hasAttribute("data-attribute"))).toHaveLength(18);
  });

  it("highlights the memories of a clicked value node and lists them without opening a memory", () => {
    const { container } = renderPage();
    fireEvent.click(nodeEl(container, "type:task"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const panel = screen.getByTestId("selected-attribute");
    expect(within(panel).getAllByRole("button")).toHaveLength(2);
    expect(nodeEls(container).filter((n) => n.getAttribute("data-dimmed") === "true").length).toBeGreaterThan(0);
    expect(nodeEl(container, "mem_task_mcp").hasAttribute("data-dimmed")).toBe(false);
    expect(nodeEl(container, "type:task").hasAttribute("data-dimmed")).toBe(false); // the clicked node itself stays lit
  });

  it("highlights the value nodes of a clicked category hub", () => {
    const { container } = renderPage();
    const valueIds = attrEls(container, "type", "value").map((n) => n.getAttribute("data-node-id")!);
    fireEvent.click(nodeEl(container, "category:type"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const panel = screen.getByTestId("selected-attribute");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(valueIds.length);
    for (const id of valueIds) expect(nodeEl(container, id).hasAttribute("data-dimmed")).toBe(false);
    expect(nodeEl(container, "mem_task_mcp")).toHaveAttribute("data-dimmed", "true");
  });

  it("shows only the values whose memories pass the filters", () => {
    const { container } = renderPage("/graph?type=task");
    expect(attrEls(container, "type", "value").map((n) => n.getAttribute("data-node-id"))).toEqual(["type:task"]);
    expect(attrEls(container, "type", "category")).toHaveLength(1);
  });

  it("has no Tags category (nor legend entry) when no memory has a tag", async () => {
    for (const m of listMemories(store().state!)) {
      if (m.tags.length > 0) await store().updateMemory(m.id, { tags: [] });
    }
    const { container } = renderPage();
    expect(attrEls(container, "tag")).toHaveLength(0);
    expect(container.querySelector("[data-legend-attribute=tag]")).not.toBeInTheDocument();
    expect(attrEls(container, "type", "category")).toHaveLength(1);
  });

  it("draws no category when the filters leave no memory", () => {
    const { container } = renderPage("/graph?tag=no-such-tag");
    expect(attrEls(container)).toHaveLength(0);
    expect(container.querySelector("[data-legend-attribute]")).not.toBeInTheDocument();
  });
});

describe("Graph: organization hubs", () => {
  const radius = (el: Element) => Number(el.querySelector("circle:not(.mn-focus)")!.getAttribute("r"));
  const user = { kind: "user", name: "ada" } as const;

  /** ROK contains VT (2 memories); Personal contains Mnemo (2); Loose has no project and no organization. */
  const mk = async () => {
    await resetWorkspace();
    const vtP = await store().createProject({ name: "VT" });
    const mnP = await store().createProject({ name: "Mnemo" });
    for (const title of ["VT: one", "VT: two"]) await store().createMemory({ title, content: "x", type: "fact", tags: [], projectId: vtP!.id });
    for (const title of ["Mnemo: a", "Mnemo: b"]) await store().createMemory({ title, content: "x", type: "fact", tags: [], projectId: mnP!.id });
    for (const title of ["Loose: x", "Loose: y"]) await store().createMemory({ title, content: "x", type: "fact", tags: [], projectId: null });
    useWorkspace.setState({ state: { ...store().state!, relations: {} } });
    const ctx = { now: () => "2030-01-01T00:00:00.000Z", newId: (p: string) => `${p}_t${Math.random().toString(36).slice(2, 8)}` };
    let s = store().state!;
    const rok = createOrganization(s, ctx, { name: "ROK", actor: user });
    s = rok.state;
    const personal = createOrganization(s, ctx, { name: "Personal", actor: user });
    s = personal.state;
    s = assignProjectOrganization(s, { projectId: vtP!.id, organizationId: rok.value.id, actor: user }).state;
    s = assignProjectOrganization(s, { projectId: mnP!.id, organizationId: personal.value.id, actor: user }).state;
    useWorkspace.setState({ state: s });
    return { rok: rok.value, personal: personal.value, vt: vtP!.id, mnemo: mnP!.id };
  };
  const orgEls = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>("[data-organization]")];

  it("draws one big hub per organization, labelled with its name and project count, bigger than a project hub", async () => {
    const { rok, personal, vt } = await mk();
    const { container } = renderPage();
    expect(orgEls(container).map((e) => e.getAttribute("data-node-id")).sort()).toEqual([`org:${personal.id}`, `org:${rok.id}`].sort());
    const hub = nodeEl(container, `org:${rok.id}`);
    expect(hub).toHaveAttribute("aria-label", "ROK, organization with 1 project");
    expect(hub.textContent).toBe("ROK1 project");
    expect(hub.querySelector("[data-label-inside]")).toBeInTheDocument();
    expect(radius(hub)).toBeGreaterThan(radius(nodeEl(container, `project:${vt}`)));
    // coloured with its own hue (not a project's), and not an attribute node
    expect(hub).toHaveAttribute("data-accent");
    expect(hub.querySelector("[data-organization-ring]")).toBeInTheDocument();
    expect(hub).not.toHaveAttribute("data-attribute");
    expect(container.querySelector("[data-legend-organization]")).toBeInTheDocument();
  });

  it("links each organization hub only to the collection nodes of its projects; never to project hubs or memories", async () => {
    const { rok } = await mk();
    const { container } = renderPage();
    const links = [...container.querySelectorAll("[data-organization-edge]")].map((e) => e.getAttribute("data-organization-edge")!).sort();
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.includes(":collection:"))).toBe(true);
    expect(links.some((l) => l.startsWith(`org:${rok.id}:collection:`))).toBe(true);
    expect(links.some((l) => l.includes(":project:") || l.includes("mem_") || l.includes("loose"))).toBe(false);
    // a decorative line, not a selectable relation
    expect(container.querySelector("[data-edge-id^='org:']")).toBeNull();
  });

  it("is not a memory: memory, relation and cluster counts are unchanged, and search ignores it", async () => {
    await mk();
    const { container } = renderPage();
    expect(screen.getByText(/6 memories · 6 relations/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search graph"), { target: { value: "ROK" } });
    expect(screen.getByText(/0 matches/)).toBeInTheDocument();
    expect(nodeEl(container, `org:${Object.keys(store().state!.organizations)[0]}`)).toBeDefined();
  });

  it("clicking an organization highlights its projects and their memories and lists them without opening a memory", async () => {
    const { rok, vt } = await mk();
    const { container } = renderPage();
    const ids = Object.fromEntries(listMemories(store().state!).map((m) => [m.title, m.id]));
    fireEvent.click(nodeEl(container, `org:${rok.id}`));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const panel = screen.getByTestId("selected-organization");
    expect(panel).toHaveTextContent("ROK · 1 project · 2 memories");
    expect(within(within(panel).getByRole("list", { name: "Organization projects" })).getAllByRole("listitem")).toHaveLength(1);
    expect(within(panel).getByRole("list", { name: "Organization projects" })).toHaveTextContent("VT");
    expect(within(within(panel).getByRole("list", { name: "Organization memories" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["VT: one", "VT: two"]);
    for (const lit of [`org:${rok.id}`, `project:${vt}`, ids["VT: one"], ids["VT: two"]]) expect(nodeEl(container, lit).hasAttribute("data-dimmed")).toBe(false);
    for (const dim of [ids["Mnemo: a"], ids["Loose: x"]]) expect(nodeEl(container, dim)).toHaveAttribute("data-dimmed", "true");
    // clicking a listed memory opens it
    fireEvent.click(within(panel).getByRole("button", { name: "VT: one" }));
    expect(screen.queryByTestId("selected-organization")).not.toBeInTheDocument();
  });

  it("refuses to link an organization in link mode", async () => {
    const { rok } = await mk();
    const { container } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(nodeEl(container, `org:${rok.id}`));
    expect(screen.getByText(/is an organization, not a memory, so it cannot be linked/)).toBeInTheDocument();
  });

  it("draws nothing extra (no hub, edge or legend entry) without organizations", async () => {
    await resetWorkspace({ seed: true });
    const { container } = renderPage();
    expect(orgEls(container)).toHaveLength(0);
    expect(container.querySelector("[data-organization-edge]")).toBeNull();
    expect(container.querySelector("[data-legend-organization]")).toBeNull();
  });
});
