import { describe, expect, it } from "vitest";
import { archiveMemory, createMemory, restoreMemory, rollbackMemory, updateMemory } from "./memoryOps";
import { addRelation, createCollection, deleteCollection, listRelations, removeRelation } from "./relations";
import { commitDrafts, pendingChanges } from "./index";
import { getMemory, listMemories, memoryHistory } from "./queries";
import { A, seedCommitted, setup } from "./testUtils";
import { createSequentialContext } from "./context";

describe("memory CRUD as drafts", () => {
  it("creates a memory as a draft and never auto-commits", () => {
    const { ctx, state } = setup();
    const { state: s, value } = createMemory(state, ctx, { title: "  Hello ", tags: ["a", "a", " b "], author: A });
    expect(value.status).toBe("draft");
    expect(value.title).toBe("Hello");
    expect(value.tags).toEqual(["a", "b"]);
    expect(s.branches.main.headCommitId).toBeNull();
    expect(Object.keys(s.commits)).toHaveLength(0);
    expect(pendingChanges(s)).toHaveLength(1);
  });

  it("rejects empty titles and unknown collections", () => {
    const { ctx, state } = setup();
    expect(() => createMemory(state, ctx, { title: "  ", author: A })).toThrow(/title/);
    expect(() => createMemory(state, ctx, { title: "x", collectionId: "nope", author: A })).toThrow(/Collection/);
  });

  it("allows custom memory types", () => {
    const { ctx, state } = setup();
    const { value } = createMemory(state, ctx, { title: "x", type: "recipe", author: A });
    expect(value.type).toBe("recipe");
  });

  it("update creates a new draft revision and keeps committed state intact", () => {
    const base = seedCommitted(setup().state);
    const { state, value } = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { title: "New" }, author: A });
    expect(value.status).toBe("draft");
    expect(value.title).toBe("New");
    expect(Object.keys(state.commits)).toHaveLength(1);
    const committedRev = Object.values(state.revisions).find((r) => r.commitId);
    expect(committedRev?.snapshot.title).toBe("Base");
  });

  it("a no-op update creates no revision", () => {
    const base = seedCommitted(setup().state);
    const { state } = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { title: "Base" }, author: A });
    expect(state).toBe(base.state);
  });

  it("archives and restores as drafts", () => {
    const base = seedCommitted(setup().state);
    const archived = archiveMemory(base.state, base.ctx, { id: base.memory.id, author: A });
    expect(archived.value.archived).toBe(true);
    expect(archived.value.status).toBe("draft");
    expect(pendingChanges(archived.state)[0].kind).toBe("archive");
    expect(() => updateMemory(archived.state, base.ctx, { id: base.memory.id, patch: { title: "x" }, author: A })).toThrow(/Restore/);
    const c = commitDrafts(archived.state, base.ctx, { message: "archive", author: A });
    expect(getMemory(c.state, base.memory.id)?.status).toBe("archived");
    const r = restoreMemory(c.state, base.ctx, { id: base.memory.id, author: A });
    expect(pendingChanges(r.state)[0].kind).toBe("restore");
  });

  it("treats content as inert data", () => {
    const { ctx, state } = setup();
    const evil = "<script>alert(1)</script>${process.exit()}";
    const { value } = createMemory(state, ctx, { title: "x", content: evil, author: A });
    expect(value.content).toBe(evil);
  });

  it("state stays JSON-safe", () => {
    const base = seedCommitted(setup().state);
    expect(JSON.parse(JSON.stringify(base.state))).toEqual(base.state);
  });
});

describe("revisions are append-only", () => {
  it("only grows; existing snapshots never change; commitId stamped once", () => {
    const base = seedCommitted(setup().state);
    let s = base.state;
    const before = JSON.parse(JSON.stringify(s.revisions));
    for (const t of ["v1", "v2", "v3"]) {
      s = updateMemory(s, base.ctx, { id: base.memory.id, patch: { title: t }, author: A }).state;
    }
    expect(Object.keys(s.revisions)).toHaveLength(4);
    for (const [id, rev] of Object.entries(before)) expect(s.revisions[id]).toEqual(rev);
    const c = commitDrafts(s, base.ctx, { message: "m", author: A });
    expect(Object.keys(c.state.revisions)).toHaveLength(4);
    for (const r of Object.values(c.state.revisions)) expect(r.commitId).not.toBeNull();
    expect(c.state.commits[c.value.id].changes).toHaveLength(1);
    const hist = memoryHistory(c.state, base.memory.id);
    expect(hist.map((r) => r.snapshot.title)).toEqual(["v3", "v2", "v1", "Base"]);
  });
});

describe("rollback", () => {
  it("creates a NEW revision restoring earlier content, history intact", () => {
    const base = seedCommitted(setup().state, undefined, { content: "original" });
    const origRev = base.memory.revisionId;
    let s = updateMemory(base.state, base.ctx, { id: base.memory.id, patch: { content: "changed" }, author: A }).state;
    s = commitDrafts(s, base.ctx, { message: "edit", author: A }).state;
    const count = Object.keys(s.revisions).length;
    const rb = rollbackMemory(s, base.ctx, { memoryId: base.memory.id, toRevisionId: origRev, author: A });
    expect(Object.keys(rb.state.revisions)).toHaveLength(count + 1);
    expect(rb.value.content).toBe("original");
    expect(rb.value.status).toBe("draft");
    expect(rb.value.revisionId).not.toBe(origRev);
    expect(rb.state.revisions[origRev]).toEqual(s.revisions[origRev]);
    const hist = memoryHistory(rb.state, base.memory.id);
    expect(hist).toHaveLength(3);
    expect(hist[0].parentRevisionId).toBe(hist[1].id);
  });

  it("rejects revisions of another memory", () => {
    const a = seedCommitted(setup().state, undefined, { id: "m1" });
    const b = seedCommitted(a.state, a.ctx, { id: "m2" });
    expect(() => rollbackMemory(b.state, b.ctx, { memoryId: "m1", toRevisionId: b.memory.revisionId, author: A })).toThrow();
  });
});

describe("relations and collections", () => {
  it("adds and removes relations with validation", () => {
    const a = seedCommitted(setup().state, undefined, { id: "m1" });
    const b = seedCommitted(a.state, a.ctx, { id: "m2" });
    const prov = { origin: "user" as const, createdBy: A };
    const r = addRelation(b.state, b.ctx, { fromId: "m1", toId: "m2", label: "supports", provenance: prov });
    expect(listRelations(r.state, "m1")).toHaveLength(1);
    expect(() => addRelation(r.state, b.ctx, { fromId: "m1", toId: "m2", label: "supports", provenance: prov })).toThrow(/exists/);
    expect(() => addRelation(r.state, b.ctx, { fromId: "m1", toId: "zzz", label: "x", provenance: prov })).toThrow(/not found/);
    expect(() => addRelation(r.state, b.ctx, { fromId: "m1", toId: "m1", label: "x", provenance: prov })).toThrow();
    const removed = removeRelation(r.state, { id: r.value.id });
    expect(listRelations(removed.state)).toHaveLength(0);
    expect(() => removeRelation(removed.state, { id: r.value.id })).toThrow();
  });

  it("collections: delete refused while in use", () => {
    const ctx = createSequentialContext();
    let { state } = setup();
    const col = createCollection(state, ctx, { name: "Work" });
    state = col.state;
    state = createMemory(state, ctx, { title: "x", collectionId: col.value.id, author: A }).state;
    expect(listMemories(state)[0].collectionId).toBe(col.value.id);
    expect(() => deleteCollection(state, { id: col.value.id })).toThrow(/memories/);
    const empty = createCollection(state, ctx, { name: "Empty" });
    expect(Object.keys(deleteCollection(empty.state, { id: empty.value.id }).state.collections)).toHaveLength(1);
  });
});
