import { describe, expect, it } from "vitest";
import { createMemory, updateMemory } from "./memoryOps";
import { commitDrafts, createBranch, switchBranch } from "./versioning";
import { abortMerge, completeMerge, mergeBranch, resolveConflict } from "./merge";
import { commitLog, getMemory, listMemories, pendingChanges } from "./queries";
import { A, seedCommitted, setup } from "./testUtils";
import type { WorkspaceState } from "./types";
import type { DomainContext } from "./context";

function edit(s: WorkspaceState, ctx: DomainContext, id: string, patch: Parameters<typeof updateMemory>[2]["patch"], msg: string) {
  const u = updateMemory(s, ctx, { id, patch, author: A }).state;
  return commitDrafts(u, ctx, { message: msg, author: A }).state;
}

function diverge() {
  const base = seedCommitted(setup().state, undefined, { id: "m1", title: "Title", content: "a\nb\nc" });
  const s = createBranch(base.state, base.ctx, { name: "feature", id: "feature" }).state;
  return { s, ctx: base.ctx };
}

describe("merge", () => {
  it("merges cleanly when branches touch different fields/memories", () => {
    const { s: s0, ctx } = diverge();
    let s = switchBranch(s0, { branchId: "feature" }).state;
    s = edit(s, ctx, "m1", { title: "Feature title" }, "feat title");
    s = createMemory(s, ctx, { id: "m2", title: "Feature only", author: A }).state;
    s = commitDrafts(s, ctx, { message: "new memory", author: A }).state;
    s = switchBranch(s, { branchId: "main" }).state;
    s = edit(s, ctx, "m1", { content: "a\nb\nc\nd" }, "main content");

    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A });
    expect(r.value.status).toBe("merged");
    expect(r.state.pendingMerge).toBeNull();
    const m1 = getMemory(r.state, "m1");
    expect(m1?.title).toBe("Feature title");
    expect(m1?.content).toBe("a\nb\nc\nd");
    expect(getMemory(r.state, "m2")?.status).toBe("committed");
    const head = r.state.commits[r.state.branches.main.headCommitId as string];
    expect(head.parentIds).toHaveLength(2);
    expect(commitLog(r.state).length).toBeGreaterThanOrEqual(4);
    // source untouched
    expect(getMemory(r.state, "m1", "feature")?.content).toBe("a\nb\nc");
  });

  it("is up-to-date when source is already merged", () => {
    const { s, ctx } = diverge();
    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A });
    expect(r.value.status).toBe("up-to-date");
    expect(r.state).toBe(s);
  });

  it("fast-forward style merge applies source changes", () => {
    const { s: s0, ctx } = diverge();
    let s = switchBranch(s0, { branchId: "feature" }).state;
    s = edit(s, ctx, "m1", { title: "F" }, "f");
    s = switchBranch(s, { branchId: "main" }).state;
    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A });
    expect(r.value.status).toBe("merged");
    expect(getMemory(r.state, "m1")?.title).toBe("F");
  });

  it("refuses to merge into a target with uncommitted drafts", () => {
    const { s: s0, ctx } = diverge();
    let s = edit(switchBranch(s0, { branchId: "feature" }).state, ctx, "m1", { title: "F" }, "f");
    s = switchBranch(s, { branchId: "main" }).state;
    s = updateMemory(s, ctx, { id: "m1", patch: { content: "zzz" }, author: A }).state;
    expect(() => mergeBranch(s, ctx, { sourceBranchId: "feature", author: A })).toThrow(/Save a version or discard/);
  });

  function conflicting() {
    const { s: s0, ctx } = diverge();
    let s = edit(switchBranch(s0, { branchId: "feature" }).state, ctx, "m1", { content: "theirs" }, "f");
    s = switchBranch(s, { branchId: "main" }).state;
    s = edit(s, ctx, "m1", { content: "ours", tags: ["only-main"] }, "m");
    return { s, ctx };
  }

  it("detects field-level conflicts and leaves history untouched", () => {
    const { s, ctx } = conflicting();
    const commitsBefore = Object.keys(s.commits).length;
    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A });
    expect(r.value.status).toBe("conflicts");
    if (r.value.status !== "conflicts") return;
    expect(r.value.conflicts).toHaveLength(1);
    const c = r.value.conflicts[0];
    expect([c.field, c.base, c.ours, c.theirs]).toEqual(["content", "a\nb\nc", "ours", "theirs"]);
    expect(Object.keys(r.state.commits)).toHaveLength(commitsBefore);
    expect(getMemory(r.state, "m1")?.status).toBe("conflict");
    expect(() => completeMerge(r.state, ctx)).toThrow(/Resolve all/);
    expect(() => updateMemory(r.state, ctx, { id: "m1", patch: { title: "x" }, author: A })).toThrow(/merge/);
  });

  it.each([
    ["ours", undefined, "ours"],
    ["theirs", undefined, "theirs"],
    ["manual", "hand merged", "hand merged"],
  ] as const)("resolves with %s", (choice, value, expected) => {
    const { s, ctx } = conflicting();
    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A, message: "merge it" });
    const id = r.state.pendingMerge?.conflicts[0].id as string;
    const resolved = resolveConflict(r.state, { conflictId: id, choice, value });
    const done = completeMerge(resolved.state, ctx);
    const m = getMemory(done.state, "m1");
    expect(m?.content).toBe(expected);
    expect(m?.tags).toEqual(["only-main"]); // non-conflicting field auto-merged from ours
    expect(m?.status).toBe("committed");
    expect(done.value.message).toBe("merge it");
    expect(done.state.pendingMerge).toBeNull();
    expect(pendingChanges(done.state)).toHaveLength(0);
    expect(listMemories(done.state)).toHaveLength(1);
  });

  it("validates manual resolutions and supports abort", () => {
    const { s, ctx } = conflicting();
    const r = mergeBranch(s, ctx, { sourceBranchId: "feature", author: A });
    const id = r.state.pendingMerge?.conflicts[0].id as string;
    expect(() => resolveConflict(r.state, { conflictId: id, choice: "manual" })).toThrow(/value/);
    expect(() => resolveConflict(r.state, { conflictId: id, choice: "manual", value: ["x"] })).toThrow(/type/);
    expect(() => resolveConflict(r.state, { conflictId: "nope", choice: "ours" })).toThrow(/not found/);
    const aborted = abortMerge(r.state);
    expect(aborted.state.pendingMerge).toBeNull();
    expect(getMemory(aborted.state, "m1")?.status).toBe("committed");
  });
});
