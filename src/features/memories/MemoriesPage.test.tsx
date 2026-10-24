import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { memoryHistory, pendingChanges } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { MemoriesPage } from "./MemoriesPage";

const store = () => useWorkspace.getState();
const renderPage = (path = "/memories") => renderAt(path, "/memories", <MemoriesPage />);

beforeEach(async () => {
  await resetWorkspace();
});

describe("Memories: create (auto-saved)", () => {
  it("saves the user's own new memory straight to long-term memory, with an automatic note", async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "New memory" })[0]);

    // Empty title is rejected inline.
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    expect(await screen.findByText("Title is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Use Postgres" } });
    fireEvent.change(screen.getByLabelText("Content (Markdown)"), { target: { value: "We chose **Postgres**." } });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));

    // Opens the detail drawer; the memory is long-term at once and nothing waits for review.
    await screen.findByText("Use Postgres", { selector: "h3" });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getAllByText("Long Term Memory").length).toBeGreaterThan(0);
    expect(within(drawer).getByText("Postgres").tagName).toBe("STRONG");
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve all" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Version note")).not.toBeInTheDocument();
    const revisions = Object.values(store().state!.revisions);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ status: "saved", origin: "user", note: "Created" });
    expect(revisions[0].savedAt).not.toBeNull();
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
    // An agent proposal (waiting for review) on a saved memory marks it "pending".
    const gamma = await s.createMemory({ title: "Gamma", content: "wip", type: "fact", tags: ["plan"] });
    await s.updateMemory(gamma!.id, { content: "wip, proposed" }, { actor: { kind: "agent", name: "bot" } });
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

    const r2 = renderPage("/memories?status=pending");
    expect(screen.getByText("1 memory match")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Memories" })).getByText("Gamma")).toBeInTheDocument();
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
    await store().createMemory({ title: "Other", content: "x", type: "fact" });
    return m!.id;
  }

  it("edits (auto-saved), shows a line diff, then rolls back to the first revision", async () => {
    const id = await seedOne();
    renderPage(`/memories?memory=${id}`);
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited" } });
    fireEvent.change(screen.getByLabelText("Content (Markdown)"), { target: { value: "line one\nline two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await within(screen.getByRole("dialog")).findByText("Edited", { selector: "h3" })).toBeInTheDocument();
    // The edit is saved at once: still long-term, nothing waits for review, history gained a saved revision.
    expect(within(screen.getByRole("dialog")).getAllByText("Long Term Memory").length).toBeGreaterThan(0);
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Revision history" })).getAllByRole("listitem")).toHaveLength(2);
    const latest = memoryHistory(store().state!, id)[0];
    expect(latest).toMatchObject({ status: "saved", origin: "user", note: "Edited title, content" });

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
    expect(memoryHistory(store().state!, id)[0].note).toMatch(/^Rolled back to /);
    expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument();
  });

  it("shows an agent proposal on a saved memory; the user can approve it from the drawer", async () => {
    const id = await seedOne();
    await store().updateMemory(id, { title: "Agent title" }, { actor: { kind: "agent", name: "bot" } });
    renderPage(`/memories?memory=${id}`);
    const drawer = await screen.findByRole("dialog");
    const banner = within(drawer).getByRole("region", { name: "Waiting for review" });
    expect(banner).toHaveTextContent("bot");
    expect(within(drawer).getByText("Original", { selector: "h3" })).toBeInTheDocument(); // saved content is still shown
    fireEvent.click(within(banner).getByRole("button", { name: "Approve" }));
    expect(await within(screen.getByRole("dialog")).findByText("Agent title", { selector: "h3" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByRole("region", { name: "Waiting for review" })).not.toBeInTheDocument();
    expect(pendingChanges(store().state!)).toHaveLength(0);
  });

  it("lets the user reject an agent proposal from the drawer, keeping the saved memory", async () => {
    const id = await seedOne();
    await store().updateMemory(id, { title: "Agent title" }, { actor: { kind: "agent", name: "bot" } });
    renderPage(`/memories?memory=${id}`);
    const banner = await screen.findByRole("region", { name: "Waiting for review" });
    fireEvent.click(within(banner).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(pendingChanges(store().state!)).toHaveLength(0));
    expect(await within(screen.getByRole("dialog")).findByText("Original", { selector: "h3" })).toBeInTheDocument();
    expect(Object.values(store().state!.revisions).some((r) => r.status === "rejected")).toBe(true);
  });

  it("hides Edit for a memory that only exists as a pending proposal", async () => {
    const created = await store().createMemory({ title: "Proposed only" }, { actor: { kind: "agent", name: "bot" } });
    renderPage(`/memories?memory=${created!.id}`);
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByRole("region", { name: "Waiting for review" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(within(drawer).getByText("No saved versions yet.")).toBeInTheDocument();
  });

  it("InboxBar links to the Inbox and approves everything at once", async () => {
    const id = await seedOne();
    await store().updateMemory(id, { title: "Agent title" }, { actor: { kind: "agent", name: "bot" } });
    await store().createMemory({ title: "Proposed only" }, { actor: { kind: "agent", name: "bot" } });
    renderPage();
    expect(screen.getByText("2 changes waiting for review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Inbox" })).toHaveAttribute("href", "/inbox");
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await waitFor(() => expect(screen.queryByText(/waiting for review/)).not.toBeInTheDocument());
    expect(pendingChanges(store().state!)).toHaveLength(0);
    expect(await screen.findByText("Agent title")).toBeInTheDocument();
  });

  it("InboxBar approves only what was displayed and flags items that arrived since", async () => {
    const bot = { kind: "agent", name: "bot" } as const;
    await store().createMemory({ title: "Seen" }, { actor: bot });
    renderPage();
    await act(async () => {
      const arrival = store().createMemory({ title: "Unseen" }, { actor: bot });
      fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
      await arrival;
    });
    await waitFor(() => expect(screen.getByText(/1 new item arrived/)).toBeInTheDocument());
    expect(pendingChanges(store().state!).map((p) => p.title)).toEqual(["Unseen"]);
  });

  it("InboxBar says when links were skipped", async () => {
    const bot = { kind: "agent", name: "bot" } as const;
    const a = (await store().createMemory({ title: "Alpha" }))!.id;
    const b = (await store().createMemory({ title: "Beta" }, { actor: bot }))!.id;
    await store().addRelation(a, b, "supports", undefined, { actor: bot });
    // The domain only skips links in corrupt states, so stub the store result to exercise the message.
    const relationIds = Object.keys(store().state!.relations);
    const approveAllDetailed = vi.fn(async () => ({
      approvedRevisionIds: [],
      approvedRelationIds: [],
      skippedRelationIds: relationIds,
      ignoredIds: [],
    }));
    const original = store().approveAllDetailed;
    useWorkspace.setState({ approveAllDetailed });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    expect(await screen.findByText(/1 link needs their memories approved first/)).toBeInTheDocument();
    expect(approveAllDetailed).toHaveBeenCalledWith({
      revisionIds: pendingChanges(store().state!).map((p) => p.revisionId),
      relationIds,
    });
    useWorkspace.setState({ approveAllDetailed: original });
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

  it("does not show a pending agent link as related until approved, and blocks linking an unsaved memory", async () => {
    const id = await seedOne();
    const other = Object.values(store().state!.memories).find((m) => m.id !== id)!.id;
    await store().addRelation(id, other, "supports", undefined, { actor: { kind: "agent", name: "bot" } });
    const { unmount } = renderPage(`/memories?memory=${id}`);
    await screen.findByRole("dialog");
    expect(screen.getByText("No related memories yet.")).toBeInTheDocument();
    unmount();

    const created = await store().createMemory({ title: "Proposed only" }, { actor: { kind: "agent", name: "bot" } });
    renderPage(`/memories?memory=${created!.id}`);
    expect(await screen.findByText("Approve this memory before linking it to others.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add relation" })).not.toBeInTheDocument();
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
