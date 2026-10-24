import { describe, expect, it } from "vitest";
import { createMemory, updateMemory } from "./memoryOps";
import { commitDrafts, createBranch, switchBranch } from "./versioning";
import { commitLog, commitTree, getMemory, listMemories, pendingChanges, snapshotAtCommit } from "./queries";
import { A, seedCommitted, setup } from "./testUtils";

describe("commit", () => {
  it("requires a message and pending changes", () => {
    const { ctx, state } = setup();
    expect(() => commitDrafts(state, ctx, { message: "x", author: A })).toThrow(/Nothing to save/);
    const s = createMemory(state, ctx, { title: "t", author: A }).state;
    expect(() => commitDrafts(s, ctx, { message: "  ", author: A })).toThrow(/version note/);
  });

  it("commits every pending draft and marks them committed", () => {
    const { ctx, state } = setup();
    let s = createMemory(state, ctx, { title: "one", author: A }).state;
    s = createMemory(s, ctx, { title: "two", author: A }).state;
    const { state: c, value } = commitDrafts(s, ctx, { message: "two memories", author: A });
    expect(value.changes.map((x) => x.kind)).toEqual(["create", "create"]);
    expect(value.parentIds).toEqual([]);
    expect(c.branches.main.headCommitId).toBe(value.id);
    expect(listMemories(c).every((m) => m.status === "committed")).toBe(true);
    expect(pendingChanges(c)).toHaveLength(0);
  });

  it("is atomic: a failing commit leaves state untouched", () => {
    const { ctx, state } = setup();
    const s = createMemory(state, ctx, { title: "one", author: A }).state;
    const snapshot = JSON.stringify(s);
    expect(() => commitDrafts(s, ctx, { message: "", author: A })).toThrow();
    expect(() => commitDrafts(s, ctx, { message: "ok", author: A, branchId: "ghost" })).toThrow();
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(Object.keys(s.commits)).toHaveLength(0);
    for (const r of Object.values(s.revisions)) expect(r.commitId).toBeNull();
  });

  it("reconstructs snapshots at any commit and logs history", () => {
    const base = seedCommitted(setup().state, undefined, { title: "v1" });
    let s = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { title: "v2" }, author: A }).state;
    const c2 = commitDrafts(s, base.ctx, { message: "second", author: A });
    s = c2.state;
    const first = c2.value.parentIds[0];
    expect(snapshotAtCommit(s, first)[base.memory.id].title).toBe("v1");
    expect(snapshotAtCommit(s, c2.value.id)[base.memory.id].title).toBe("v2");
    expect(Object.keys(commitTree(s, null))).toHaveLength(0);
    expect(commitLog(s).map((c) => c.message)).toEqual(["second", "init"]);
  });
});

describe("branches", () => {
  it("creates a branch from a specific commit, isolated afterwards", () => {
    const base = seedCommitted(setup().state, undefined, { title: "v1" });
    const firstCommit = base.state.branches.main.headCommitId as string;
    let s = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { title: "v2" }, author: A }).state;
    s = commitDrafts(s, base.ctx, { message: "v2", author: A }).state;
    const br = createBranch(s, base.ctx, { name: "old", fromCommitId: firstCommit, switchTo: true });
    s = br.state;
    expect(br.value.baseCommitId).toBe(firstCommit);
    expect(s.currentBranchId).toBe(br.value.id);
    expect(getMemory(s, base.memory.id)?.title).toBe("v1");
    // draft + commit on the branch doesn't leak into main
    s = createMemory(s, base.ctx, { title: "only on branch", author: A }).state;
    s = updateMemory(s, base.ctx, { id: base.memory.id, patch: { title: "branch-title" }, author: A }).state;
    s = commitDrafts(s, base.ctx, { message: "b", author: A }).state;
    s = switchBranch(s, { branchId: "main" }).state;
    expect(getMemory(s, base.memory.id)?.title).toBe("v2");
    expect(listMemories(s)).toHaveLength(1);
  });

  it("drafts are per branch and not carried into new branches", () => {
    const base = seedCommitted(setup().state);
    const s1 = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { title: "draft" }, author: A }).state;
    const br = createBranch(s1, base.ctx, { name: "x", switchTo: true });
    expect(getMemory(br.state, base.memory.id)?.title).toBe("Base");
    expect(pendingChanges(br.state)).toHaveLength(0);
    expect(pendingChanges(br.state, "main")).toHaveLength(1);
  });

  it("rejects duplicate names and unknown commits/branches", () => {
    const base = seedCommitted(setup().state);
    const b = createBranch(base.state, base.ctx, { name: "f" });
    expect(() => createBranch(b.state, base.ctx, { name: "f" })).toThrow(/exists/);
    expect(() => createBranch(b.state, base.ctx, { name: "g", fromCommitId: "nope" })).toThrow(/Version/);
    expect(() => switchBranch(b.state, { branchId: "nope" })).toThrow(/Branch/);
  });
});
