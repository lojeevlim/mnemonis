/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate untrusted-shaped data */
import { describe, expect, it } from "vitest";
import { createMemory, updateMemory } from "./memoryOps";
import { commitDrafts, createBranch, switchBranch } from "./versioning";
import { completeMerge, mergeBranch, resolveConflict } from "./merge";
import { addRelation, createCollection } from "./relations";
import { getMemory, listMemories, memoryHistory, pendingChanges, pendingRevisionMap } from "./queries";
import { searchWorkspace } from "./search";
import { MAX_IMPORT_BYTES, validateWorkspaceState } from "./state";
import { A, seedCommitted, setup } from "./testUtils";
import type { WorkspaceState } from "./types";

const upd = (s: WorkspaceState, ctx: ReturnType<typeof setup>["ctx"], id: string, patch: Parameters<typeof updateMemory>[2]["patch"]) =>
  updateMemory(s, ctx, { id, patch, author: A }).state;

describe("MAJOR-1 leftover no-op draft vs merge", () => {
  function scenario() {
    const base = seedCommitted(setup().state, undefined, { id: "m1", title: "Title", content: "a" });
    const { ctx } = base;
    let s = createBranch(base.state, ctx, { name: "feature", id: "feature", switchTo: true }).state;
    s = commitDrafts(upd(s, ctx, "m1", { content: "merged content" }), ctx, { message: "feat", author: A }).state;
    s = switchBranch(s, { branchId: "main" }).state;
    // edit on the target and edit back -> draft equal to the committed snapshot
    s = upd(s, ctx, "m1", { content: "temporary" });
    s = upd(s, ctx, "m1", { content: "a" });
    return { s, ctx };
  }

  it("leaves a no-op draft that pendingChanges ignores", () => {
    const { s } = scenario();
    expect(pendingChanges(s)).toHaveLength(0);
    expect(Object.values(s.revisions).filter((r) => r.commitId === null && r.branchId === "main").length).toBeGreaterThan(0);
  });

  it("merge result shows merged content, not the stale draft, and the next commit does not revert it", () => {
    const { s: s0, ctx } = scenario();
    const r = mergeBranch(s0, ctx, { sourceBranchId: "feature", author: A });
    expect(r.value.status).toBe("merged");
    const s = r.state;
    expect(getMemory(s, "m1")?.content).toBe("merged content");
    expect(getMemory(s, "m1")?.status).toBe("committed");
    expect(pendingChanges(s)).toHaveLength(0);
    expect(Object.keys(pendingRevisionMap(s, "main"))).toHaveLength(0);
    expect(() => commitDrafts(s, ctx, { message: "x", author: A })).toThrow(/Nothing to save/);
    // editing afterwards builds on the merged revision
    const s2 = upd(s, ctx, "m1", { title: "T2" });
    expect(getMemory(s2, "m1")?.content).toBe("merged content");
    const c = commitDrafts(s2, ctx, { message: "after", author: A }).state;
    expect(getMemory(c, "m1")?.content).toBe("merged content");
  });

  it("history after the merge does not list the stale draft", () => {
    const { s: s0, ctx } = scenario();
    const s = mergeBranch(s0, ctx, { sourceBranchId: "feature", author: A }).state;
    expect(memoryHistory(s, "m1").every((rev) => rev.commitId !== null)).toBe(true);
  });
});

describe("MINOR-7 commit stamps only referenced revisions and their draft ancestors", () => {
  it("superseded drafts of a committed revision are stamped; unrelated no-op drafts are not", () => {
    const base = seedCommitted(setup().state, undefined, { id: "m1" });
    const { ctx } = base;
    let s = createMemory(base.state, ctx, { id: "m2", title: "Two", author: A }).state;
    s = commitDrafts(s, ctx, { message: "two", author: A }).state;
    s = upd(s, ctx, "m1", { title: "x" });
    s = upd(s, ctx, "m1", { title: "y" }); // superseded draft x
    s = upd(s, ctx, "m2", { title: "tmp" });
    s = upd(s, ctx, "m2", { title: "Two" }); // no-op chain equal to committed
    const c = commitDrafts(s, ctx, { message: "m1 only", author: A });
    expect(c.value.changes.map((x) => x.memoryId)).toEqual(["m1"]);
    const hist = memoryHistory(c.state, "m1");
    expect(hist.map((r) => r.snapshot.title)).toEqual(["y", "x", "Base"]);
    expect(hist.every((r) => r.commitId !== null)).toBe(true);
    const m2drafts = Object.values(c.state.revisions).filter((r) => r.memoryId === "m2" && r.commitId === null);
    expect(m2drafts.length).toBe(2);
  });
});

describe("MINOR-6 manual conflict resolution validation", () => {
  function conflicted(field: "tags" | "collectionId" | "metadata" | "type" | "title") {
    const base = seedCommitted(setup().state, undefined, { id: "m1" });
    const { ctx } = base;
    let s = createCollection(base.state, ctx, { name: "C", id: "col1" }).state;
    s = createBranch(s, ctx, { name: "f", id: "f" }).state;
    const patches = {
      tags: [{ tags: ["a"] }, { tags: ["b"] }],
      collectionId: [{ collectionId: "col1" }, { collectionId: null, tags: ["z"] }],
      metadata: [{ metadata: { a: 1 } }, { metadata: { a: 2 } }],
      type: [{ type: "task" }, { type: "project" }],
      title: [{ title: "ours" }, { title: "theirs" }],
    }[field] as Parameters<typeof updateMemory>[2]["patch"][];
    if (field === "collectionId") patches[1] = { collectionId: "col1" }; // placeholder, replaced below
    s = switchBranch(s, { branchId: "f" }).state;
    s = commitDrafts(upd(s, ctx, "m1", patches[1]), ctx, { message: "t", author: A }).state;
    s = switchBranch(s, { branchId: "main" }).state;
    s = commitDrafts(upd(s, ctx, "m1", patches[0]), ctx, { message: "o", author: A }).state;
    const m = mergeBranch(s, ctx, { sourceBranchId: "f", author: A });
    return { s: m.state, ctx, conflict: m.state.pendingMerge?.conflicts.find((c) => c.field === field) };
  }
  const manual = (s: WorkspaceState, id: string, value: unknown) =>
    resolveConflict(s, { conflictId: id, choice: "manual", value: value as never });

  it("normalises tags", () => {
    const { s, conflict } = conflicted("tags");
    const r = manual(s, conflict!.id, [" x ", "x", "y", ""]);
    expect(r.state.pendingMerge?.conflicts.find((c) => c.id === conflict!.id)?.resolution?.value).toEqual(["x", "y"]);
    expect(() => manual(s, conflict!.id, ["ok", 3])).toThrow(/wrong type/);
  });
  it("rejects empty title/type and trims", () => {
    for (const f of ["title", "type"] as const) {
      const { s, conflict } = conflicted(f);
      expect(() => manual(s, conflict!.id, "  ")).toThrow(/required/);
      expect(() => manual(s, conflict!.id, 5)).toThrow(/wrong type/);
      const r = manual(s, conflict!.id, " v ");
      expect(r.state.pendingMerge?.conflicts.find((c) => c.id === conflict!.id)?.resolution?.value).toBe("v");
    }
  });
  it("metadata must be a JSON-safe plain object", () => {
    const { s, conflict } = conflicted("metadata");
    expect(() => manual(s, conflict!.id, [1])).toThrow(/wrong type/);
    expect(() => manual(s, conflict!.id, "x")).toThrow(/wrong type/);
    expect(() => manual(s, conflict!.id, { a: undefined })).toThrow(/wrong type/);
    expect(() => manual(s, conflict!.id, { a: () => 1 })).toThrow(/wrong type/);
    expect(() => manual(s, conflict!.id, { a: Number.NaN })).toThrow(/wrong type/);
    expect(manual(s, conflict!.id, { a: { b: [1, "x", null] } }).state.pendingMerge).not.toBeNull();
  });
  it("collectionId must exist or be null", () => {
    const base = seedCommitted(setup().state, undefined, { id: "m1" });
    const { ctx } = base;
    let s = createCollection(base.state, ctx, { name: "C", id: "col1" }).state;
    s = createCollection(s, ctx, { name: "D", id: "col2" }).state;
    s = createBranch(s, ctx, { name: "f", id: "f", switchTo: true }).state;
    s = commitDrafts(upd(s, ctx, "m1", { collectionId: "col1" }), ctx, { message: "t", author: A }).state;
    s = switchBranch(s, { branchId: "main" }).state;
    s = commitDrafts(upd(s, ctx, "m1", { collectionId: "col2" }), ctx, { message: "o", author: A }).state;
    const m = mergeBranch(s, ctx, { sourceBranchId: "f", author: A }).state;
    const id = m.pendingMerge!.conflicts[0].id;
    expect(() => manual(m, id, "nope")).toThrow(/Collection not found/);
    expect(() => manual(m, id, 3)).toThrow(/wrong type/);
    const ok = manual(manual(m, id, null).state, id, "col1").state;
    expect(completeMerge(ok, ctx).value.changes).toHaveLength(1);
  });
});

function validState(): WorkspaceState {
  const base = seedCommitted(setup().state, undefined, { id: "m1" });
  const { ctx } = base;
  let s = createMemory(base.state, ctx, { id: "m2", title: "Two", author: A }).state;
  s = commitDrafts(s, ctx, { message: "two", author: A }).state;
  s = addRelation(s, ctx, { fromId: "m1", toId: "m2", label: "rel", provenance: { origin: "user", createdBy: A } }).state;
  return JSON.parse(JSON.stringify(s));
}
const mutate = (fn: (s: any) => void) => {
  const s = validState();
  fn(s);
  return validateWorkspaceState(s);
};

describe("MAJOR-3 deep validation", () => {
  it("accepts a valid state", () => {
    expect(validateWorkspaceState(validState()).ok).toBe(true);
  });

  const cases: [string, (s: any) => void][] = [
    ["snapshot content not string", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.content = 5)],
    ["snapshot type not string", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.type = null)],
    ["tags with non-string", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.tags = ["a", 1])],
    ["collectionId number", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.collectionId = 3)],
    ["archived not boolean", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.archived = "no")],
    ["metadata array", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.metadata = [])],
    ["metadata nested non-json", (s) => (s.revisions[Object.keys(s.revisions)[0]].snapshot.metadata = { a: Number.POSITIVE_INFINITY })],
    ["revision createdAt", (s) => (s.revisions[Object.keys(s.revisions)[0]].createdAt = 1)],
    ["revision author", (s) => delete s.revisions[Object.keys(s.revisions)[0]].author],
    ["revision parent dangling", (s) => (s.revisions[Object.keys(s.revisions)[0]].parentRevisionId = "ghost")],
    ["revision parent undefined", (s) => delete s.revisions[Object.keys(s.revisions)[0]].parentRevisionId],
    ["revision commit dangling", (s) => (s.revisions[Object.keys(s.revisions)[0]].commitId = "ghost")],
    ["commit timestamp", (s) => (s.commits[Object.keys(s.commits)[0]].timestamp = 5)],
    ["commit parentIds null entry", (s) => (s.commits[Object.keys(s.commits)[0]].parentIds = [null])],
    ["commit changes shape", (s) => (s.commits[Object.keys(s.commits)[0]].changes = [{ memoryId: "m1" }])],
    ["commit change kind", (s) => (s.commits[Object.keys(s.commits)[0]].changes[0].kind = "explode")],
    ["commit change memory mismatch", (s) => (s.commits[Object.keys(s.commits)[0]].changes[0].memoryId = "m2")],
    ["commit branch dangling", (s) => (s.commits[Object.keys(s.commits)[0]].branchId = "ghost")],
    ["map key != id", (s) => (s.memories.m1.id = "other")],
    ["memory provenance", (s) => (s.memories.m1.provenance = "x")],
    ["memory createdAt", (s) => (s.memories.m1.createdAt = null)],
    ["relation label", (s) => (s.relations[Object.keys(s.relations)[0]].label = 1)],
    ["relation provenance origin", (s) => (s.relations[Object.keys(s.relations)[0]].provenance.origin = "alien")],
    ["relation dangling", (s) => (s.relations[Object.keys(s.relations)[0]].toId = "ghost")],
    ["branch name", (s) => (s.branches.main.name = 1)],
    ["branch base dangling", (s) => (s.branches.main.baseCommitId = "ghost")],
    ["branch head dangling", (s) => (s.branches.main.headCommitId = "ghost")],
    ["pendingMerge not object", (s) => (s.pendingMerge = 5)],
    ["pendingMerge shape", (s) => (s.pendingMerge = { sourceBranchId: "main", targetBranchId: "main", baseCommitId: null, message: "", author: "", merged: {}, conflicts: "x" })],
    ["pendingMerge conflict bad field", (s) => (s.pendingMerge = { sourceBranchId: "main", targetBranchId: "main", baseCommitId: null, message: "", author: "", merged: {}, conflicts: [{ id: "c", memoryId: "m1", field: "zzz", ours: 1, theirs: 1, resolution: null }] })],
    ["collection shape", (s) => (s.collections.c = { id: "c", name: 1 })],
    ["currentBranchId missing", (s) => (s.currentBranchId = "ghost")],
  ];
  it.each(cases)("rejects: %s", (_n, fn) => {
    expect(mutate(fn)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("accepts a well-formed pendingMerge", () => {
    const r = mutate((s) => {
      s.pendingMerge = {
        sourceBranchId: "main",
        targetBranchId: "main",
        baseCommitId: null,
        message: "m",
        author: "a",
        merged: { m1: s.revisions[Object.keys(s.revisions)[0]].snapshot },
        conflicts: [{ id: "c1", memoryId: "m1", field: "title", ours: "a", theirs: "b", resolution: { choice: "ours", value: "a" } }],
      };
    });
    expect(r.ok).toBe(true);
  });

  it("rejects cycles in commit parentIds and revision parents", () => {
    expect(mutate((s) => {
      const ids = Object.keys(s.commits);
      s.commits[ids[0]].parentIds = [ids[1]];
      s.commits[ids[1]].parentIds = [ids[0]];
    }).ok).toBe(false);
    expect(mutate((s) => {
      const id = Object.keys(s.commits)[0];
      s.commits[id].parentIds = [id];
    }).ok).toBe(false);
    expect(mutate((s) => {
      const r = Object.values(s.revisions).filter((x: any) => x.memoryId === "m1") as any[];
      r[0].parentRevisionId = r[0].id;
    }).ok).toBe(false);
  });

  it("exposes a size cap constant", () => {
    expect(MAX_IMPORT_BYTES).toBeGreaterThan(1024);
  });
});

describe("MAJOR-4 prototype-pollution hardening", () => {
  it("rejects __proto__ / constructor / prototype keys and ids from a malicious import, without crashing", () => {
    const base = JSON.stringify(validState());
    for (const key of ["__proto__", "constructor", "prototype"]) {
      for (const map of ["memories", "revisions", "commits", "branches", "relations", "collections"]) {
        const s = JSON.parse(base);
        const entry = (Object.values(s[map])[0] ?? {}) as Record<string, unknown>;
        const body = JSON.stringify(s[map]);
        const evil = `${JSON.stringify(key)}:${JSON.stringify({ ...entry, id: key })}`;
        const json = JSON.stringify(s).replace(`"${map}":${body}`, `"${map}":{${evil}${body === "{}" ? "" : ","}${body.slice(1)}`);
        expect(validateWorkspaceState(JSON.parse(json))).toEqual({ ok: false, reason: "corrupt" });
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a JSON.parse-created own __proto__ key and dangling refs", () => {
    const evil = JSON.parse(
      `{"schemaVersion":1,"currentBranchId":"main","memories":{"__proto__":{"id":"__proto__","createdAt":"t","source":"s","provenance":{"origin":"o","createdBy":"c"}}},"revisions":{},"commits":{},"branches":{"main":{"id":"main","name":"main","headCommitId":"toString","baseCommitId":null}},"relations":{},"collections":{},"pendingMerge":null}`,
    );
    expect(validateWorkspaceState(evil).ok).toBe(false);
    const dangling = validState() as any;
    dangling.branches.main.headCommitId = "constructor";
    expect(validateWorkspaceState(dangling).ok).toBe(false);
  });

  it("domain lookups never return Object.prototype members", () => {
    const base = seedCommitted(setup().state, undefined, { id: "m1" });
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(getMemory(base.state, id)).toBeUndefined();
      expect(() => updateMemory(base.state, base.ctx, { id, patch: { title: "x" }, author: A })).toThrow(/not found/);
      expect(() => addRelation(base.state, base.ctx, { fromId: id, toId: "m1", label: "l", provenance: { origin: "user", createdBy: A } })).toThrow(/not found/);
    }
    expect(() => switchBranch(base.state, { branchId: "__proto__" })).toThrow(/not found/);
    expect(() => switchBranch(base.state, { branchId: "toString" })).toThrow(/not found/);
  });

  it("refuses to create entities with reserved ids", () => {
    const { state, ctx } = setup();
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(() => createMemory(state, ctx, { id, title: "t", author: A })).toThrow(/reserved/);
      expect(() => createBranch(state, ctx, { name: "n" + id, id })).toThrow(/reserved/);
      expect(() => createCollection(state, ctx, { name: "c", id })).toThrow(/reserved/);
    }
    const s = createMemory(createMemory(state, ctx, { title: "a", id: "a", author: A }).state, ctx, { title: "b", id: "b", author: A }).state;
    expect(() => addRelation(s, ctx, { id: "__proto__", fromId: "a", toId: "b", label: "l", provenance: { origin: "user", createdBy: A } })).toThrow(/reserved/);
    expect(listMemories(s)).toHaveLength(2);
  });
});

describe("search punctuation fallback", () => {
  it("falls back to substring match for punctuation-only and symbol queries", () => {
    const { state, ctx } = setup();
    let s = createMemory(state, ctx, { id: "a", title: "Use # for headings", content: "markdown", author: A }).state;
    s = createMemory(s, ctx, { id: "b", title: "Languages", content: "I like c++ and rust", author: A }).state;
    s = createMemory(s, ctx, { id: "c", title: "Unrelated", content: "nothing", author: A }).state;
    expect(searchWorkspace(s, { query: "#" }).items.map((i) => i.memory.id)).toEqual(["a"]);
    expect(searchWorkspace(s, { query: "++" }).items.map((i) => i.memory.id)).toEqual(["b"]);
    expect(searchWorkspace(s, { query: "c++" }).items.map((i) => i.memory.id)).toContain("b");
    expect(searchWorkspace(s, { query: "!!!" }).total).toBe(0);
  });
});
