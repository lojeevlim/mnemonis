import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { GraphPage } from "./GraphPage";

const store = () => useWorkspace.getState();
const renderPage = (path = "/graph") => renderAt(path, "/graph", <GraphPage />);
const nodeEls = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>("[data-node-id]")];
const edgeEls = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>("[data-edge-id]")];
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
    expect(edgeEls(container)).toHaveLength(Object.keys(store().state!.relations).length);
    expect(edgeEls(container)).toHaveLength(16);
    expect(screen.getByText(/18 memories · 16 relations/)).toBeInTheDocument();
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
    const before = Object.keys(store().state!.relations).length;
    fireEvent.click(screen.getByRole("button", { name: "Link mode" }));
    fireEvent.click(nodeEl(container, "mem_profile"));
    expect(screen.getByText(/Now click the target memory/)).toBeInTheDocument();
    fireEvent.click(nodeEl(container, "mem_pref_writing"));
    // Link mode never opens the drawer.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Relation label"), { target: { value: "writes like" } });
    fireEvent.click(screen.getByRole("button", { name: "Create relation" }));

    await waitFor(() => expect(Object.keys(store().state!.relations)).toHaveLength(before + 1));
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
    expect(Object.keys(store().state!.relations)).toHaveLength(16);
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
