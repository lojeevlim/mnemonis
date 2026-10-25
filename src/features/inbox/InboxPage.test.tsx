import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { listRelations, memoryHistory, pendingChanges, pendingCount, timeline } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { InboxPage } from "./InboxPage";

const store = () => useWorkspace.getState();
const agent = { kind: "agent", name: "Memory Health: Organize" } as const;
const renderPage = () => renderAt("/inbox", "/inbox", <InboxPage />);
const inboxItem = (title: string) => {
  const list = screen.getByRole("list", { name: "Changes waiting for review" });
  return within(list)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(title))!;
};

beforeEach(async () => {
  await resetWorkspace();
});

describe("Inbox page: empty state and timeline", () => {
  it("shows an empty inbox and an empty timeline for a fresh workspace", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Inbox", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Your inbox is empty")).toBeInTheDocument();
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject all" })).not.toBeInTheDocument();
  });

  it("lists saved changes newest first with a link to the memory", async () => {
    const a = await store().createMemory({ title: "First memory" });
    await store().createMemory({ title: "Second memory" });
    await store().updateMemory(a!.id, { content: "more" });
    renderPage();
    const items = within(screen.getByRole("list", { name: "Saved changes" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("First memory");
    expect(items[0]).toHaveTextContent("Edited content");
    expect(items[2]).toHaveTextContent("First memory");
    expect(items[2]).toHaveTextContent("Created");
    expect(within(items[1]).getByRole("link", { name: "Second memory" })).toHaveAttribute(
      "href",
      `/memories?memory=${encodeURIComponent(Object.keys(store().state!.memories)[1])}`,
    );
    expect(timeline(store().state!)).toHaveLength(3);
  });
});

describe("Inbox page: review", () => {
  let editedId: string;
  beforeEach(async () => {
    const m = await store().createMemory({ title: "Alpha", content: "line one" });
    editedId = m!.id;
    await store().updateMemory(editedId, { content: "line one\nline two" }, { actor: agent });
    await store().createMemory({ title: "Brand new", content: "hello" }, { actor: agent });
  });

  it("shows each pending change with kind, origin, author, note and a diff against the saved memory", () => {
    renderPage();
    expect(screen.getByText("2 changes waiting for review")).toBeInTheDocument();
    const edit = inboxItem("Alpha");
    expect(within(edit).getByText("Edited")).toBeInTheDocument();
    expect(within(edit).getByText("Agent")).toBeInTheDocument();
    expect(edit).toHaveTextContent("Memory Health: Organize");
    expect(edit).toHaveTextContent("Edited content");
    const diff = within(edit).getByLabelText("Content diff");
    expect(diff.querySelector('[data-diff="add"]')?.textContent).toContain("line two");
    expect(diff.querySelector('[data-diff="equal"]')?.textContent).toContain("line one");

    const created = inboxItem("Brand new");
    expect(within(created).getByText("New")).toBeInTheDocument();
    expect(within(created).getByRole("link", { name: "Brand new" })).toBeInTheDocument();
  });

  it("approves one change: it becomes saved long-term memory and leaves the inbox", async () => {
    renderPage();
    fireEvent.click(within(inboxItem("Alpha")).getByRole("button", { name: "Approve Alpha" }));
    await waitFor(() => expect(pendingChanges(store().state!)).toHaveLength(1));
    const saved = memoryHistory(store().state!, editedId)[0];
    expect(saved).toMatchObject({ status: "saved", origin: "agent", author: "Memory Health: Organize" });
    expect(saved.snapshot.content).toBe("line one\nline two");
    expect(screen.getByText("1 change waiting for review")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Changes waiting for review" })).queryByText("Alpha")).not.toBeInTheDocument();
    // It now shows up in the timeline.
    const list = screen.getByRole("list", { name: "Saved changes" });
    expect(within(list).getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  it("rejects one change: nothing is saved and the change is kept as rejected", async () => {
    renderPage();
    const savedBefore = timeline(store().state!).length;
    fireEvent.click(within(inboxItem("Brand new")).getByRole("button", { name: "Reject Brand new" }));
    await waitFor(() => expect(pendingChanges(store().state!)).toHaveLength(1));
    expect(timeline(store().state!)).toHaveLength(savedBefore);
    expect(Object.values(store().state!.revisions).filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(screen.queryByText("Brand new")).not.toBeInTheDocument();
    expect(screen.getByText("1 change waiting for review")).toBeInTheDocument();
  });

  it("approves all changes at once and then shows the empty state", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(pendingChanges(store().state!)).toHaveLength(0);
    expect(memoryHistory(store().state!, editedId)[0].snapshot.content).toBe("line one\nline two");
    const list = screen.getByRole("list", { name: "Saved changes" });
    expect(within(list).getAllByText("Brand new").length).toBeGreaterThan(0);
  });

  it("rejects all changes at once and keeps the saved memory untouched", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(pendingChanges(store().state!)).toHaveLength(0);
    expect(memoryHistory(store().state!, editedId)[0].snapshot.content).toBe("line one");
    expect(Object.values(store().state!.revisions).filter((r) => r.status === "rejected")).toHaveLength(2);
  });

  it("drops a proposal from the inbox when the user edits the same memory meanwhile (user edit wins)", async () => {
    renderPage();
    await store().updateMemory(editedId, { title: "Alpha edited" });
    await waitFor(() => expect(screen.getByText("1 change waiting for review")).toBeInTheDocument());
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
    expect(Object.values(store().state!.revisions).some((r) => r.status === "superseded")).toBe(true);
  });
});

describe("Inbox page: links", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    a = (await store().createMemory({ title: "Alpha" }))!.id;
    b = (await store().createMemory({ title: "Beta" }))!.id;
    await store().addRelation(a, b, "supports", undefined, { actor: agent });
  });
  const linkItem = () => within(screen.getByRole("list", { name: "Links waiting for review" })).getAllByRole("listitem")[0];

  it("lists a pending link, counts it in the inbox, and keeps it out of the real links", () => {
    renderPage();
    expect(screen.getByText("1 change waiting for review")).toBeInTheDocument();
    expect(pendingCount(store().state!)).toBe(1);
    expect(listRelations(store().state!)).toHaveLength(0);
    expect(linkItem()).toHaveTextContent("Alpha");
    expect(linkItem()).toHaveTextContent("supports");
    expect(linkItem()).toHaveTextContent("Beta");
    expect(linkItem()).toHaveTextContent("Memory Health: Organize");
    expect(screen.queryByText("Your inbox is empty")).not.toBeInTheDocument();
  });

  it("approves a link: it becomes a saved relation", async () => {
    renderPage();
    fireEvent.click(within(linkItem()).getByRole("button", { name: /Approve link/ }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(listRelations(store().state!)).toHaveLength(1);
  });

  it("rejects a link: no relation is saved", async () => {
    renderPage();
    fireEvent.click(within(linkItem()).getByRole("button", { name: /Reject link/ }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(listRelations(store().state!)).toHaveLength(0);
    expect(Object.values(store().state!.relations)[0].status).toBe("rejected");
  });

  it("disables Approve while a linked memory is still waiting for review", async () => {
    const c = (await store().createMemory({ title: "Gamma" }, { actor: agent }))!.id;
    await store().addRelation(a, c, "extends", undefined, { actor: agent });
    renderPage();
    const item = within(screen.getByRole("list", { name: "Links waiting for review" }))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Gamma"))!;
    expect(within(item).getByRole("button", { name: /Approve link/ })).toBeDisabled();
    expect(item).toHaveTextContent("Approve the linked memories first");
    // Approve all handles the memory and its link together.
    expect(screen.getByText("3 changes waiting for review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(listRelations(store().state!)).toHaveLength(2);
  });

  it("Reject all also rejects links", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(await screen.findByText("Your inbox is empty")).toBeInTheDocument();
    expect(listRelations(store().state!)).toHaveLength(0);
    expect(pendingChanges(store().state!)).toHaveLength(0);
  });
});

describe("Inbox page: actor name and collection names", () => {
  it("shows the Memory Health actor name on the item and the collection name in the diff", async () => {
    await store().createCollection("Projects");
    const col = Object.values(store().state!.collections)[0];
    const m = await store().createMemory({ title: "Plan" });
    await store().updateMemory(m!.id, { collectionId: col.id }, { actor: agent });
    renderPage();
    const item = inboxItem("Plan");
    expect(within(item).getByText("Agent")).toBeInTheDocument();
    expect(within(item).getByText("Memory Health: Organize")).toBeInTheDocument();
    expect(within(item).getByText("Projects")).toBeInTheDocument();
    expect(item.textContent).not.toContain(col.id);
  });
});

describe("Inbox page: target collection", () => {
  it("names the collection a pending new memory will be filed in (by title prefix)", async () => {
    await store().createCollection("Finance");
    await store().createMemory({ title: "Finance: budget" }, { actor: agent });
    renderPage();
    const item = inboxItem("Finance: budget");
    expect(within(item).getByText("Collection: Finance")).toBeInTheDocument();
    expect(item.textContent).not.toMatch(/col_|collectionId/);
  });

  it("shows Unsorted for a new memory with no matching collection, and No collection for an explicit none", async () => {
    await store().createMemory({ title: "Loose idea" }, { actor: agent });
    await store().createMemory({ title: "Bare note", collectionId: null }, { actor: agent });
    renderPage();
    expect(within(inboxItem("Loose idea")).getByText("Collection: Unsorted")).toBeInTheDocument();
    expect(within(inboxItem("Bare note")).getByText("Collection: No collection")).toBeInTheDocument();
  });

  it("shows the target name for a pending collection change and none when the collection is untouched", async () => {
    await store().createCollection("Projects");
    const col = Object.values(store().state!.collections).find((c) => c.name === "Projects")!;
    const m = await store().createMemory({ title: "Plan" });
    const n = await store().createMemory({ title: "Other" });
    await store().updateMemory(m!.id, { collectionId: col.id }, { actor: agent });
    await store().updateMemory(n!.id, { content: "edited" }, { actor: agent });
    renderPage();
    expect(within(inboxItem("Plan")).getByText("Collection: Projects")).toBeInTheDocument();
    expect(within(inboxItem("Other")).queryByText(/^Collection:/)).not.toBeInTheDocument();
  });
});

describe("Inbox page: bulk actions act only on what is displayed", () => {
  it("Approve all leaves a proposal that arrived after render pending and says so", async () => {
    await store().createMemory({ title: "Seen" }, { actor: agent });
    renderPage();
    expect(screen.getByText("1 change waiting for review")).toBeInTheDocument();
    // A new proposal lands in the same tick as the click, before the page can re-render.
    await act(async () => {
      const arrival = store().createMemory({ title: "Unseen" }, { actor: agent });
      fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
      await arrival;
    });
    await waitFor(() => expect(screen.getByText(/1 new item arrived/)).toBeInTheDocument());
    const pending = pendingChanges(store().state!);
    expect(pending.map((p) => p.title)).toEqual(["Unseen"]);
    expect(screen.getByText(/review it in the Inbox/)).toBeInTheDocument();
  });

  it("Reject all leaves a proposal that arrived after render pending", async () => {
    await store().createMemory({ title: "Seen" }, { actor: agent });
    renderPage();
    await act(async () => {
      const arrival = store().createMemory({ title: "Unseen" }, { actor: agent });
      fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
      await arrival;
    });
    await waitFor(() => expect(screen.getByText(/1 new item arrived/)).toBeInTheDocument());
    expect(pendingChanges(store().state!).map((p) => p.title)).toEqual(["Unseen"]);
  });

  it("tells the user how many links need their memories approved first", async () => {
    const a = (await store().createMemory({ title: "Alpha" }))!.id;
    const b = (await store().createMemory({ title: "Beta" }, { actor: agent }))!.id;
    await store().addRelation(a, b, "supports", undefined, { actor: agent });
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
});
