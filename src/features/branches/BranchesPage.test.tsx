import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { BranchesPage } from "./BranchesPage";

const store = () => useWorkspace.getState();
const state = () => store().state!;
const renderPage = () => renderAt("/branches", "/branches", <BranchesPage />);
const openTab = (name: RegExp | string) => fireEvent.click(screen.getByRole("tab", { name }));
const branchByName = (name: string) => Object.values(state().branches).find((b) => b.name === name)!;
const currentName = () => state().branches[state().currentBranchId].name;

/** main: one committed memory "Doc" with content "line1\nline2". */
async function seedBase() {
  const m = await store().createMemory({ title: "Doc", content: "line1\nline2", type: "fact", tags: [] });
  await store().commit("Add doc");
  return m!;
}

beforeEach(async () => {
  await resetWorkspace();
});

describe("Branches: list and switching", () => {
  it("shows an empty-ish state with only main", () => {
    renderPage();
    expect(screen.getByText(/Only/)).toHaveTextContent("Only main exists");
    expect(screen.getByText("No versions yet", { selector: "span" })).toBeInTheDocument();
    openTab("Compare");
    expect(screen.getByText("Only one branch")).toBeInTheDocument();
    openTab("Merge");
    expect(screen.getByText("Nothing to merge")).toBeInTheDocument();
  });

  it("switching branches isolates drafts", async () => {
    await seedBase();
    await store().createBranch("feature");
    await store().updateMemory(Object.keys(state().memories)[0], { title: "Doc (main draft)" });
    renderPage();
    expect(screen.getByText("1 memory changed on main")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to feature" }));
    await waitFor(() => expect(currentName()).toBe("feature"));
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to main" }));
    await waitFor(() => expect(currentName()).toBe("main"));
    expect(await screen.findByText("1 memory changed on main")).toBeInTheDocument();
  });
});

describe("Branches: create branch", () => {
  it("surfaces validation errors, then creates and switches", async () => {
    await seedBase();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New branch" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create branch" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/branch name/i);

    fireEvent.change(within(dialog).getByLabelText("Branch name"), { target: { value: "main" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create branch" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already exists/i);

    fireEvent.change(within(dialog).getByLabelText("Branch name"), { target: { value: "feature" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create branch" }));
    await waitFor(() => expect(currentName()).toBe("feature"));
    expect(branchByName("feature").headCommitId).toBe(branchByName("main").headCommitId);
  });

  it("creates a branch from an earlier commit in History", async () => {
    const m = await seedBase();
    await store().updateMemory(m.id, { title: "Doc v2" });
    await store().commit("Rename doc");
    const first = Object.values(state().commits).find((c) => c.message === "Add doc")!;
    renderPage();
    openTab("History");

    const list = screen.getByRole("list", { name: "Version history" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByText(/local-user/).length).toBe(2);
    fireEvent.click(within(list).getByRole("button", { name: /Add doc/ }));

    const details = screen.getByRole("region", { name: "Version details" });
    const link = within(details).getByRole("link", { name: "Doc" });
    expect(link).toHaveAttribute("href", `/memories?memory=${m.id}`);

    fireEvent.click(within(details).getByRole("button", { name: "Branch from this version" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Branch name"), { target: { value: "old" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create branch" }));
    await waitFor(() => expect(branchByName("old")).toBeDefined());
    expect(branchByName("old").headCommitId).toBe(first.id);
    expect(currentName()).toBe("old");
  });
});

describe("Branches: working changes and commit", () => {
  it("shows a line diff and requires a message to commit", async () => {
    const m = await seedBase();
    await store().updateMemory(m.id, { content: "line1\nline2 changed" });
    renderPage();
    const diff = screen.getByRole("list", { name: "Working changes" });
    expect(within(diff).getByText("Modified")).toBeInTheDocument();
    expect(diff.querySelector('[data-diff="add"]')).toHaveTextContent("line2 changed");
    expect(diff.querySelector('[data-diff="remove"]')).toHaveTextContent("line2");

    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Version note"), { target: { value: "Tweak" } });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(await screen.findByText("No unsaved changes")).toBeInTheDocument();
    expect(Object.values(state().commits).map((c) => c.message)).toContain("Tweak");
  });
});

/** main and feature both edit Doc; returns memory id. Ends on main. */
async function divergeSameField(conflict: boolean) {
  const m = await seedBase();
  await store().createBranch("feature", undefined, true);
  await store().updateMemory(m.id, { content: "line1\nfeature line" });
  await store().commit("Feature edit");
  await store().switchBranch(branchByName("main").id);
  await store().updateMemory(m.id, conflict ? { content: "line1\nmain line" } : { title: "Doc renamed" });
  await store().commit("Main edit");
  return m;
}

describe("Branches: merge", () => {
  it("merges cleanly and shows the merge commit", async () => {
    const m = await divergeSameField(false);
    renderPage();
    openTab("Merge");
    fireEvent.change(nativeSelect(document.body, "Merge from"), { target: { value: branchByName("feature").id } });
    fireEvent.click(screen.getByRole("button", { name: "Merge into main" }));
    expect(await screen.findByText("Merged feature into main")).toBeInTheDocument();
    expect(state().pendingMerge).toBeNull();
    const head = state().commits[branchByName("main").headCommitId!];
    expect(head.parentIds).toHaveLength(2);
    const mem = Object.values(state().revisions).filter((r) => r.memoryId === m.id && r.branchId === "main").pop()!;
    expect(mem.snapshot.title).toBe("Doc renamed");
    expect(mem.snapshot.content).toBe("line1\nfeature line");
  });

  it("blocks merging when the target has uncommitted drafts", async () => {
    const m = await divergeSameField(false);
    await store().updateMemory(m.id, { title: "Dirty" });
    renderPage();
    openTab("Merge");
    expect(screen.getByText("Unsaved changes on this branch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge into main" })).toBeDisabled();
    // The store itself also rejects it.
    await store().merge(branchByName("feature").id);
    expect(store().error).toMatch(/uncommitted|drafts/i);
    expect(state().pendingMerge).toBeNull();
  });

  it("resolves conflicts and completes the merge", async () => {
    const m = await divergeSameField(true);
    renderPage();
    openTab("Merge");
    fireEvent.change(nativeSelect(document.body, "Merge from"), { target: { value: branchByName("feature").id } });
    fireEvent.click(screen.getByRole("button", { name: "Merge into main" }));

    const panel = await screen.findByRole("region", { name: "Merge conflicts" });
    expect(state().pendingMerge!.conflicts).toHaveLength(1);
    expect(Object.values(state().memories).length).toBe(1);
    expect(screen.queryByText("Merged feature into main")).not.toBeInTheDocument();
    // The memory is flagged as a conflict in the data model.
    const { listMemories } = await import("../../domain");
    expect(listMemories(state()).find((x) => x.id === m.id)?.status).toBe("conflict");

    const complete = within(panel).getByRole("button", { name: "Complete merge" });
    expect(complete).toBeDisabled();
    const group = within(panel).getByRole("group", { name: "Conflict: content of Doc" });
    expect(within(group).getByText("Unresolved")).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "Edit manually" }));
    fireEvent.change(within(group).getByLabelText("Manual value"), { target: { value: "line1\nboth lines" } });
    fireEvent.click(within(group).getByRole("button", { name: "Use this value" }));
    expect(await within(group).findByText("Resolved: manual")).toBeInTheDocument();
    await waitFor(() => expect(complete).toBeEnabled());
    fireEvent.click(complete);

    await waitFor(() => expect(state().pendingMerge).toBeNull());
    expect(screen.queryByRole("region", { name: "Merge conflicts" })).not.toBeInTheDocument();
    const rev = Object.values(state().revisions).filter((r) => r.memoryId === m.id && r.branchId === "main").pop()!;
    expect(rev.snapshot.content).toBe("line1\nboth lines");
    expect(listMemories(state()).find((x) => x.id === m.id)?.status).toBe("committed");
  });

  it("supports choosing theirs", async () => {
    const m = await divergeSameField(true);
    await store().merge(branchByName("feature").id);
    renderPage();
    const group = screen.getByRole("group", { name: "Conflict: content of Doc" });
    fireEvent.click(within(group).getByRole("button", { name: "Take theirs" }));
    await within(group).findByText("Resolved: theirs");
    fireEvent.click(screen.getByRole("button", { name: "Complete merge" }));
    await waitFor(() => expect(state().pendingMerge).toBeNull());
    const rev = Object.values(state().revisions).filter((r) => r.memoryId === m.id && r.branchId === "main").pop()!;
    expect(rev.snapshot.content).toBe("line1\nfeature line");
  });

  it("aborts a merge without changing the target", async () => {
    await divergeSameField(true);
    const before = branchByName("main").headCommitId;
    await store().merge(branchByName("feature").id);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Abort merge" }));
    await waitFor(() => expect(state().pendingMerge).toBeNull());
    expect(branchByName("main").headCommitId).toBe(before);
    expect(screen.queryByRole("region", { name: "Merge conflicts" })).not.toBeInTheDocument();
  });
});

describe("Branches: compare", () => {
  it("compares two branches and two commits", async () => {
    await divergeSameField(false);
    renderPage();
    openTab("Compare");
    expect(screen.getByText(/Choose two to see/)).toBeInTheDocument();

    fireEvent.change(nativeSelect(document.body, "From"), { target: { value: branchByName("main").id } });
    fireEvent.change(nativeSelect(document.body, "To"), { target: { value: branchByName("feature").id } });
    const list = screen.getByRole("list", { name: "Comparison" });
    expect(within(list).getByText("Modified")).toBeInTheDocument();
    expect(list.querySelector('[data-diff="add"]')).toHaveTextContent("feature line");

    fireEvent.change(nativeSelect(document.body, "Compare"), { target: { value: "commits" } });
    expect(screen.getByText(/Choose two to see/)).toBeInTheDocument();
    const [base, feat] = ["Add doc", "Feature edit"].map((m) => Object.values(state().commits).find((c) => c.message === m)!);
    fireEvent.change(nativeSelect(document.body, "From"), { target: { value: base.id } });
    fireEvent.change(nativeSelect(document.body, "To"), { target: { value: feat.id } });
    expect(screen.getByRole("list", { name: "Comparison" }).querySelector('[data-diff="add"]')).toHaveTextContent("feature line");

    fireEvent.change(nativeSelect(document.body, "To"), { target: { value: base.id } });
    expect(screen.getByText("No differences between these two.")).toBeInTheDocument();
  });
});
