import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { MemoriesPage } from "./MemoriesPage";

const store = () => useWorkspace.getState();
const renderPage = (path = "/memories") => renderAt(path, "/memories", <MemoriesPage />);

beforeEach(async () => {
  await resetWorkspace();
});

describe("Memories: create and commit", () => {
  it("creates a draft, then commits it", async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "New memory" })[0]);

    // Empty title is rejected inline.
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Use Postgres" } });
    fireEvent.change(screen.getByLabelText("Content (Markdown)"), { target: { value: "We chose **Postgres**." } });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));

    // Opens the detail drawer; memory is a draft and the commit bar appears.
    await screen.findByText("Use Postgres", { selector: "h3" });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getAllByText("Draft").length).toBeGreaterThan(0);
    expect(within(drawer).getByText("Postgres").tagName).toBe("STRONG");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(Object.values(store().state!.revisions)).toHaveLength(1);

    // Commit requires a message.
    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Version note"), { target: { value: "Add DB decision" } });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(screen.queryByText("1 unsaved change")).not.toBeInTheDocument());
    expect(within(screen.getByRole("dialog")).getAllByText("Saved").length).toBeGreaterThan(0);
    expect(Object.values(store().state!.commits).map((c) => c.message)).toContain("Add DB decision");
  });

  it("supports a custom type and tags", async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "New memory" })[0]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pasta" } });
    fireEvent.change(nativeSelect(container, "Type"), { target: { value: "__custom__" } });
    fireEvent.change(await screen.findByLabelText("Custom type"), { target: { value: "recipe" } });
    const tagInput = screen.getByPlaceholderText("Add a tag");
    fireEvent.change(tagInput, { target: { value: "food" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    await waitFor(() => expect(store().state && Object.keys(store().state!.memories)).toHaveLength(1));
    const m = Object.values(store().state!.revisions)[0].snapshot;
    expect(m.type).toBe("recipe");
    expect(m.tags).toEqual(["food"]);
  });
});

describe("Memories: search and filters", () => {
  beforeEach(async () => {
    const s = store();
    await s.createCollection("Work");
    const col = Object.values(store().state!.collections)[0];
    await s.createMemory({ title: "Alpha plan", content: "roadmap", type: "project", tags: ["plan"], collectionId: col.id });
    await s.createMemory({ title: "Beta fact", content: "water is wet", type: "fact", tags: ["science"] });
    await s.commit("seed");
    await s.createMemory({ title: "Gamma draft", content: "wip", type: "fact", tags: ["plan"] });
  });

  it("searches with debounce", async () => {
    renderPage();
    expect(screen.getByText("3 memories")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "alpha" } });
    expect(await screen.findByText("1 memory match")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Memories" });
    expect(within(list).getByText("Alpha plan")).toBeInTheDocument();
    expect(within(list).queryByText("Beta fact")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "zzzz" } });
    expect(await screen.findByText("No memories match")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(await screen.findByText("3 memories")).toBeInTheDocument();
  });

  it("filters by type, status, tag and collection via query params", () => {
    const col = Object.values(store().state!.collections)[0];
    const { unmount } = renderPage("/memories?type=fact");
    expect(screen.getByText("2 memories match")).toBeInTheDocument();
    unmount();

    const r2 = renderPage("/memories?status=draft");
    expect(screen.getByText("1 memory match")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Memories" })).getByText("Gamma draft")).toBeInTheDocument();
    r2.unmount();

    const r3 = renderPage("/memories?tag=plan");
    expect(screen.getByText("2 memories match")).toBeInTheDocument();
    r3.unmount();

    renderPage(`/memories?collection=${col.id}`);
    expect(screen.getByText("1 memory match")).toBeInTheDocument();
    expect(screen.getByText(/In collection/)).toBeInTheDocument();
  });

  it("changing a filter select updates the results", async () => {
    const { container } = renderPage();
    fireEvent.change(nativeSelect(container, "Filter by type"), { target: { value: "project" } });
    expect(await screen.findByText("1 memory match")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toContain("type=project");
  });

  it("paginates", async () => {
    for (let i = 0; i < 12; i++) await store().createMemory({ title: `Bulk ${i}`, type: "task" });
    renderPage("/memories?type=task");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(10);
    fireEvent.click(screen.getByRole("button", { name: /^2$|page 2/i }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Memories" })).getAllByRole("listitem")).toHaveLength(2));
  });
});

describe("Memories: edit, history, rollback, relations, archive", () => {
  async function seedOne() {
    const m = await store().createMemory({ title: "Original", content: "line one", type: "fact" });
    await store().commit("init");
    await store().createMemory({ title: "Other", content: "x", type: "fact" });
    await store().commit("other");
    return m!.id;
  }

  it("edits (draft), shows a line diff, then rolls back to the first revision", async () => {
    const id = await seedOne();
    renderPage(`/memories?memory=${id}`);
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited" } });
    fireEvent.change(screen.getByLabelText("Content (Markdown)"), { target: { value: "line one\nline two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await within(screen.getByRole("dialog")).findByText("Edited", { selector: "h3" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    // Diff for the newest revision.
    fireEvent.click(screen.getByRole("button", { name: "Changes in revision 2" }));
    const diff = await screen.findByLabelText("Content diff");
    expect(diff.querySelector('[data-diff="add"]')?.textContent).toContain("line two");
    expect(diff.querySelector('[data-diff="equal"]')?.textContent).toContain("line one");

    // Per-revision view of the first revision.
    fireEvent.click(screen.getByRole("button", { name: "View revision 1" }));
    expect((await within(screen.getByRole("list", { name: "Revision history" })).findAllByText("Original")).length).toBeGreaterThan(0);

    // Rollback creates a NEW revision rather than rewriting history.
    const before = Object.keys(store().state!.revisions).length;
    fireEvent.click(screen.getByRole("button", { name: "Roll back to revision 1" }));
    await waitFor(() => expect(Object.keys(store().state!.revisions).length).toBe(before + 1));
    expect(await within(screen.getByRole("dialog")).findByText("Original", { selector: "h3" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Revision history" })).getAllByRole("listitem")).toHaveLength(3);
    // Back to the committed content, so nothing is pending any more.
    await waitFor(() => expect(screen.queryByText("1 unsaved change")).not.toBeInTheDocument());
  });

  it("adds and removes a user relation", async () => {
    const id = await seedOne();
    const { container } = renderPage(`/memories?memory=${id}`);
    await screen.findByRole("dialog");
    const other = Object.values(store().state!.memories).find((m) => m.id !== id)!.id;
    fireEvent.change(nativeSelect(container, "Memory to relate"), { target: { value: other } });
    fireEvent.click(screen.getByRole("button", { name: "Add relation" }));
    const list = await screen.findByRole("list", { name: "Related memories" });
    expect(within(list).getByText("Other")).toBeInTheDocument();
    expect(Object.values(store().state!.relations)[0].provenance.origin).toBe("user");

    fireEvent.click(screen.getByRole("button", { name: "Remove relation to Other" }));
    await waitFor(() => expect(Object.keys(store().state!.relations)).toHaveLength(0));
    expect(await screen.findByText("No related memories yet.")).toBeInTheDocument();
  });

  it("archives and restores", async () => {
    const id = await seedOne();
    renderPage(`/memories?memory=${id}`);
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Archive" }));
    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore" }));
    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown memory id", async () => {
    renderPage("/memories?memory=nope");
    expect(await screen.findByText("Memory not found")).toBeInTheDocument();
  });
});
