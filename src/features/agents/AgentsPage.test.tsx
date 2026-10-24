import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { commitLog, getMemory, pendingChanges } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { RUN_LOG_KEY } from "./runLog";
import { AgentsPage } from "./AgentsPage";

const store = () => useWorkspace.getState();
const renderPage = () => renderAt("/agents", "/agents", <AgentsPage />);
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
  await store().commit("baseline");
});

describe("Agents page", () => {
  it("labels implemented vs planned agents and disables the planned run buttons", () => {
    renderPage();
    expect(screen.getAllByText("Implemented (deterministic)")).toHaveLength(2);
    expect(screen.getAllByText("Planned — needs backend / LLM")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Run Researcher" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run Sync Agent" })).toBeDisabled();
    expect(screen.getByText("Local only — nothing is synced")).toBeInTheDocument();
    expect(screen.getByText("Pending drafts")).toBeInTheDocument();
  });

  it("runs the Librarian, applies a proposal as a DRAFT (no commit, no delete) and records the run", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Librarian" }));
    const item = proposalItem(/Duplicate memories/);
    expect(within(item).getByText("high confidence")).toBeInTheDocument();
    const commitsBefore = commitLog(store().state!).length;
    expect(pendingChanges(store().state!)).toHaveLength(0);

    fireEvent.click(within(item).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(proposalItem(/Duplicate memories/)).getByText("Applied as draft")).toBeInTheDocument());

    const s = store().state!;
    expect(commitLog(s)).toHaveLength(commitsBefore);
    expect(pendingChanges(s)).toHaveLength(1);
    expect(pendingChanges(s)[0].kind).toBe("archive");
    expect(Object.keys(s.memories)).toHaveLength(2); // nothing deleted
    // The older one (m1) is archived as a draft.
    expect(getMemory(s, "m1")).toMatchObject({ archived: true, status: "draft" });
    expect(screen.getByRole("link", { name: /Review and save them as a version on Branches/ })).toHaveAttribute("href", "/branches");
    expect(JSON.parse(localStorage.getItem(RUN_LOG_KEY)!)[0]).toMatchObject({ agent: "librarian" });
    expect(screen.getByRole("region", { name: "Run history" })).toHaveTextContent("Librarian");
  });

  it("dismiss leaves state untouched", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Librarian" }));
    fireEvent.click(within(proposalItem(/Duplicate memories/)).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Dismissed")).toBeInTheDocument();
    expect(pendingChanges(store().state!)).toHaveLength(0);
  });

  it("applies a link proposal with process provenance", async () => {
    await store().createMemory({ id: "m3", title: "Alone", content: "zzz", tags: ["x"] });
    await store().createMemory({ id: "m4", title: "Alone again", content: "zzz yyy", tags: ["x"] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Librarian" }));
    fireEvent.click(within(proposalItem(/“Alone” is isolated/)).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(Object.keys(store().state!.relations).length).toBeGreaterThan(0));
    const rel = Object.values(store().state!.relations)[0];
    expect(rel.provenance).toMatchObject({ origin: "process", process: "librarian" });
  });

  it("runs the Reviewer with a configurable stale threshold", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Stale after (days)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Run Reviewer" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Stale after (days)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Reviewer" }));
    expect(await screen.findByText("Nothing to propose")).toBeInTheDocument(); // just created, not stale
  });
});
