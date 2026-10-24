import { describe, expect, it } from "vitest";
import { diffBranches, diffCommits, diffLines, diffRevisions, diffWorkingTree } from "./diff";
import { createMemory, updateMemory } from "./memoryOps";
import { commitDrafts, createBranch } from "./versioning";
import { A, seedCommitted } from "./testUtils";
import { setup } from "./testUtils";

describe("diffLines", () => {
  it("handles equal, add, remove, replace", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.type === "equal")).toBe(true);
    expect(diffLines("", "x\ny").map((l) => l.type)).toEqual(["add", "add"]);
    expect(diffLines("x\ny", "").map((l) => l.type)).toEqual(["remove", "remove"]);
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "equal", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "B" },
      { type: "equal", text: "c" },
    ]);
  });
  it("finds an LCS in the middle", () => {
    const d = diffLines("1\n2\n3\n4\n5", "1\n3\n4\nX\n5");
    expect(d.filter((l) => l.type === "remove").map((l) => l.text)).toEqual(["2"]);
    expect(d.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["X"]);
  });
});

describe("domain diffs", () => {
  it("diffs revisions field-by-field with line diff for content", () => {
    const base = seedCommitted(setup().state);
    const s = updateMemory(base.state, base.ctx, {
      id: base.memory.id,
      patch: { title: "T2", content: "line1\nlineX\nline3", tags: ["z"] },
      author: A,
    }).state;
    const newRev = Object.keys(s.revisions).at(-1) as string;
    const d = diffRevisions(s, base.memory.revisionId, newRev);
    expect(d.map((f) => f.field).sort()).toEqual(["content", "tags", "title"]);
    const content = d.find((f) => f.field === "content");
    expect(content?.lines?.filter((l) => l.type !== "equal")).toHaveLength(2);
  });

  it("diffs commits, branches and the working tree", () => {
    const base = seedCommitted(setup().state);
    const c1 = base.state.branches.main.headCommitId;
    let s = createBranch(base.state, base.ctx, { name: "f", switchTo: true }).state;
    s = createMemory(s, base.ctx, { title: "New", author: A }).state;
    s = updateMemory(s, base.ctx, { id: base.memory.id, patch: { title: "Edited" }, author: A }).state;
    const working = diffWorkingTree(s);
    expect(working.map((d) => d.kind).sort()).toEqual(["added", "modified"]);
    const c = commitDrafts(s, base.ctx, { message: "f", author: A });
    const dc = diffCommits(c.state, c1, c.value.id);
    expect(dc).toHaveLength(2);
    const branchId = c.state.currentBranchId;
    expect(diffBranches(c.state, "main", branchId)).toHaveLength(2);
    expect(diffBranches(c.state, "main", "main")).toEqual([]);
    expect(diffWorkingTree(c.state)).toEqual([]);
  });
});
