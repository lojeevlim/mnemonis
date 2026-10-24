import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getMemory, listPendingRelations, listRelations, memoryHistory, pendingChanges, pendingRevisionFor } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { RUN_LOG_KEY } from "./runLog";
import { HealthPage } from "./HealthPage";

const store = () => useWorkspace.getState();
const renderPage = () => renderAt("/health", "/health", <HealthPage />);
const proposalItem = (text: RegExp | string) => {
  const list = screen.getByRole("list", { name: "Proposals list" });
  return within(list).getAllByRole("listitem").find((li) => (typeof text === "string" ? li.textContent?.includes(text) : text.test(li.textContent ?? "")))!;
};

beforeEach(async () => {
  await resetWorkspace();
  await store().createCollection("Work");
  const col = Object.values(store().state!.collections)[0];
  await store().createMemory({ id: "m1", title: "Release process", content: "tag and ship", tags: ["ops"], collectionId: col.id });
  await store().createMemory({ id: "m2", title: "release process", content: "tag and ship it", tags: ["ops"], collectionId: col.id });
});

describe("Memory Health page", () => {
  it("labels the rule-based checks vs planned features and disables the planned run buttons", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Memory Health" })).toBeInTheDocument();
    expect(screen.getAllByText("Rule-based")).toHaveLength(2);
    expect(screen.getAllByText("Planned — needs backend / LLM")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Run Researcher" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run Sync" })).toBeDisabled();
    expect(screen.getByText("Local only — nothing is synced")).toBeInTheDocument();
    expect(screen.getByText("Waiting for review")).toBeInTheDocument();
  });

  it("runs Organize, sends a proposal to the Inbox as pending (not saved, no delete) and records the run", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Organize" }));
    const item = proposalItem(/Duplicate memories/);
    expect(within(item).getByText("high confidence")).toBeInTheDocument();
    const savedBefore = memoryHistory(store().state!, "m1").length;
    expect(pendingChanges(store().state!)).toHaveLength(0);

    fireEvent.click(within(item).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(proposalItem(/Duplicate memories/)).getByText("Sent to Inbox")).toBeInTheDocument());

    const s = store().state!;
    expect(pendingChanges(s)).toHaveLength(1);
    expect(pendingChanges(s)[0]).toMatchObject({
      kind: "archive",
      origin: "agent",
      author: "Memory Health: Organize",
    });
    expect(Object.keys(s.memories)).toHaveLength(2); // nothing deleted
    // Nothing was saved: the older one (m1) is still active in long-term memory, with an archive proposal waiting.
    expect(memoryHistory(s, "m1")).toHaveLength(savedBefore);
    expect(getMemory(s, "m1")).toMatchObject({ archived: false, status: "pending", hasPending: true });
    expect(pendingRevisionFor(s, "m1")!.snapshot.archived).toBe(true);
    expect(screen.getByRole("link", { name: /Review and approve the changes and links in your Inbox/ })).toHaveAttribute("href", "/inbox");
    expect(JSON.parse(localStorage.getItem(RUN_LOG_KEY)!)[0]).toMatchObject({ check: "organize" });
    expect(screen.getByRole("region", { name: "Run history" })).toHaveTextContent("Organize");
  });

  it("dismiss leaves state untouched", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Organize" }));
    fireEvent.click(within(proposalItem(/Duplicate memories/)).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Dismissed")).toBeInTheDocument();
    expect(pendingChanges(store().state!)).toHaveLength(0);
  });

  it("sends a link proposal to the Inbox as a pending relation (hidden from the graph and related lists until approved)", async () => {
    await store().createMemory({ id: "m3", title: "Alone", content: "zzz", tags: ["x"] });
    await store().createMemory({ id: "m4", title: "Alone again", content: "zzz yyy", tags: ["x"] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Organize" }));
    fireEvent.click(within(proposalItem(/“Alone” is isolated/)).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(listPendingRelations(store().state!).length).toBeGreaterThan(0));
    await waitFor(() => expect(within(proposalItem(/“Alone” is isolated/)).getByText("Sent to Inbox")).toBeInTheDocument());
    const s = store().state!;
    const rel = Object.values(s.relations)[0];
    expect(rel).toMatchObject({ status: "pending", provenance: { origin: "process", process: "Memory Health: Organize" } });
    // Not a real link yet.
    expect(listRelations(s)).toHaveLength(0);
    expect(listRelations(s, "m3")).toHaveLength(0);
    // Once approved it becomes a saved relation.
    expect(await store().approveRelation(rel.id)).toBe(true);
    expect(listRelations(store().state!)).toHaveLength(1);
  });

  it("runs Review with a configurable stale threshold", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Stale after (days)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Run Review" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Stale after (days)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
    expect(await screen.findByText("Nothing to propose")).toBeInTheDocument(); // just created, not stale
  });
});
