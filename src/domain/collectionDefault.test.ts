import { describe, expect, it } from "vitest";
import { resolveCollection, UNSORTED_NAME } from "./collectionDefault";
import { createMemory, updateMemory } from "./memoryOps";
import { getMemory, pendingRevisionFor } from "./queries";
import { createCollection, deleteCollection, updateCollection } from "./relations";
import { LIMITS } from "./limits";
import { AGENT, USER, setup } from "./testUtils";
import { approveRevision, rejectRevision } from "./versioning";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

const names = (s: { collections: Record<string, { name: string }> }) => Object.values(s.collections).map((c) => c.name);

describe("resolveCollection", () => {
  it("respects an explicit collectionId and an explicit null", () => {
    const { ctx, state } = setup();
    const s = createCollection(state, ctx, { id: "c1", name: "Work" }).state;
    expect(resolveCollection(s, ctx, { collectionId: "c1", title: "x", actor: USER }).collectionId).toBe("c1");
    const none = resolveCollection(s, ctx, { collectionId: null, title: "x", actor: USER });
    expect(none.collectionId).toBeNull();
    expect(none.state).toBe(s); // no Unsorted created
    expect(codeOf(() => resolveCollection(s, ctx, { collectionId: "nope", title: "x", actor: USER }))).toBe("collection_not_found");
  });

  it("matches an explicit `collection` by id, then by case-insensitive name", () => {
    const { ctx, state } = setup();
    const s = createCollection(state, ctx, { id: "c1", name: "  Home   Lab " }).state;
    expect(resolveCollection(s, ctx, { collection: "c1", title: "x", actor: AGENT }).collectionId).toBe("c1");
    expect(resolveCollection(s, ctx, { collection: "home lab", title: "x", actor: AGENT }).collectionId).toBe("c1");
  });

  it("an unknown name is an error for an agent (never created) and creates the collection for a user", () => {
    const { ctx, state } = setup();
    expect(codeOf(() => resolveCollection(state, ctx, { collection: "Brand New", title: "x", actor: AGENT }))).toBe("collection_not_found");
    const r = resolveCollection(state, ctx, { collection: "Brand New", title: "x", actor: USER });
    expect(names(r.state)).toEqual(["Brand New"]);
    expect(resolveCollection(r.state, ctx, { collection: "BRAND new", title: "x", actor: USER }).state).toBe(r.state);
  });

  it("matches the `<project>:` title prefix against existing collections only", () => {
    const { ctx, state } = setup();
    const s = createCollection(state, ctx, { id: "c1", name: "Mnemonis" }).state;
    expect(resolveCollection(s, ctx, { title: "mnemonis: decision", actor: AGENT }).collectionId).toBe("c1");
    const other = resolveCollection(s, ctx, { title: "Other: thing", actor: USER });
    expect(names(other.state).sort()).toEqual(["Mnemonis", UNSORTED_NAME]); // no collection created for the prefix
  });

  it("creates Unsorted once and finds it again by normalized name", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "One", actor: USER });
    const b = createMemory(a.state, ctx, { title: "Two", actor: AGENT });
    expect(names(b.state)).toEqual([UNSORTED_NAME]);
    expect(a.value.collectionId).toBe(Object.keys(b.state.collections)[0]);
    const renamed = updateCollection(b.state, { id: a.value.collectionId as string, name: "  unSORTED " }).state;
    const c = createMemory(renamed, ctx, { title: "Three", actor: USER });
    expect(Object.keys(c.state.collections)).toHaveLength(1);
  });

  it("does not default for import/system origins or migrations, nor when applyDefault is false", () => {
    const { ctx, state } = setup();
    for (const extra of [{ origin: "import" as const }, { origin: "system" as const }, { migrating: true }, { applyDefault: false }]) {
      const r = resolveCollection(state, ctx, { title: "x", actor: USER, ...extra });
      expect(r).toEqual({ state, collectionId: null });
    }
    const m = createMemory(state, ctx, { title: "Imported", actor: USER, provenance: { origin: "import", createdBy: "u" } });
    expect(m.value.collectionId).toBeNull();
    expect(Object.keys(m.state.collections)).toHaveLength(0);
  });

  it("enforces name length, control characters and type checks", () => {
    const { ctx, state } = setup();
    const go = (collection: unknown) =>
      codeOf(() => resolveCollection(state, ctx, { collection: collection as string, title: "x", actor: USER }));
    expect(go("a".repeat(LIMITS.collectionName + 1))).toBe("too_large");
    expect(go("bad\u0000name")).toBe("invalid_input");
    expect(go("tab\there")).toBe("invalid_input");
    expect(go("   ")).toBe("invalid_input");
    expect(go("")).toBe("invalid_input");
    expect(go(42)).toBe("invalid_input");
    expect(go("a".repeat(LIMITS.collectionName))).toBeUndefined();
  });

  it("rejects reserved ids, but treats reserved words as ordinary names", () => {
    const { ctx, state } = setup();
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      expect(codeOf(() => resolveCollection(state, ctx, { collectionId: bad, title: "x", actor: USER }))).toBe("invalid_input");
      // As a name: unknown is not-found for an agent, created (with a fresh safe id) for a user.
      expect(codeOf(() => resolveCollection(state, ctx, { collection: bad, title: "x", actor: AGENT }))).toBe("collection_not_found");
      const made = resolveCollection(state, ctx, { collection: bad, title: "x", actor: USER });
      expect(names(made.state)).toEqual([bad]);
      expect(made.collectionId).not.toBe(bad);
      // ...and an existing collection with that name is matched by name, also for an agent.
      expect(resolveCollection(made.state, ctx, { collection: bad, title: "x", actor: AGENT }).collectionId).toBe(made.collectionId);
    }
    expect(codeOf(() => resolveCollection(state, ctx, { collectionId: "toString", title: "x", actor: USER }))).toBe("collection_not_found");
  });

  it("breaks name collisions deterministically: oldest createdAt, then smallest id, not insertion order", () => {
    const { ctx, state } = setup();
    const col = (id: string, name: string, createdAt: string) => ({ id, name, description: "", createdAt });
    const build = (list: ReturnType<typeof col>[]) => ({
      ...state,
      collections: Object.fromEntries(list.map((c) => [c.id, c])),
    });
    const newer = col("c_a", "Work", "2026-02-01T00:00:00.000Z");
    const older = col("c_z", "work", "2026-01-01T00:00:00.000Z");
    for (const order of [[newer, older], [older, newer]]) {
      const s = build(order);
      expect(resolveCollection(s, ctx, { collection: "WORK", title: "x", actor: AGENT }).collectionId).toBe("c_z");
      expect(resolveCollection(s, ctx, { title: "Work: note", actor: AGENT }).collectionId).toBe("c_z");
    }
    const t1 = col("c_b", "Dup", "2026-01-01T00:00:00.000Z");
    const t2 = col("c_a", "dup", "2026-01-01T00:00:00.000Z");
    for (const order of [[t1, t2], [t2, t1]]) {
      expect(resolveCollection(build(order), ctx, { collection: "dup", title: "x", actor: AGENT }).collectionId).toBe("c_a");
    }
  });

  it("title prefixes: only a real `<project>:` prefix naming an existing collection matches", () => {
    const { ctx, state } = setup();
    let s = createCollection(state, ctx, { id: "c1", name: "Note" }).state;
    s = createCollection(s, ctx, { id: "c2", name: "http" }).state;
    const of = (title: string) => resolveCollection(s, ctx, { title, actor: AGENT }).collectionId;
    expect(of("Note: x")).toBe("c1");
    expect(of("note:x")).toBe("c1");
    expect(of("http://x")).toBe("c2"); // "http" is the prefix before the first colon
    expect(names(resolveCollection(s, ctx, { title: "ftp://x", actor: USER }).state)).toContain(UNSORTED_NAME);
    expect(of("Notes: x")).not.toBe("c1");
    expect(of("No colon here")).not.toBe("c1");
    expect(of(":leading colon")).not.toBe("c1");
  });

  it("rejects control characters in a caller-supplied collection, for users and agents", () => {
    const { ctx, state } = setup();
    for (const actor of [USER, AGENT]) {
      for (const bad of ["a\u0000b", "a\nb", "a\u007fb", "a\u0085b"]) {
        expect(codeOf(() => resolveCollection(state, ctx, { collection: bad, title: "x", actor }))).toBe("invalid_input");
      }
    }
  });

  it("rejects collection and collectionId together (collectionId null counts), on create and update", () => {
    const { ctx, state } = setup();
    const s = createCollection(state, ctx, { id: "c1", name: "Work" }).state;
    expect(codeOf(() => resolveCollection(s, ctx, { collectionId: "c1", collection: "Work", title: "x", actor: USER }))).toBe("invalid_input");
    expect(codeOf(() => createMemory(s, ctx, { title: "t", collectionId: null, collection: "Work", actor: USER }))).toBe("invalid_input");
    const m = createMemory(s, ctx, { id: "m1", title: "t", actor: USER });
    expect(codeOf(() => updateMemory(m.state, ctx, { id: "m1", patch: { collectionId: null, collection: "Work" }, actor: AGENT }))).toBe("invalid_input");
    expect(codeOf(() => updateMemory(m.state, ctx, { id: "m1", patch: { collectionId: "c1", collection: "Work" }, actor: USER }))).toBe("invalid_input");
  });

  it("caps the number of collections (explicit creation errors, the Unsorted default just falls back to none)", () => {
    const { ctx, state } = setup();
    let s = state;
    for (let i = 0; i < LIMITS.maxCollections; i++) s = createCollection(s, ctx, { name: `C${i}` }).state;
    expect(codeOf(() => createCollection(s, ctx, { name: "one more" }))).toBe("too_large");
    expect(codeOf(() => resolveCollection(s, ctx, { collection: "one more", title: "x", actor: USER }))).toBe("too_large");
    expect(resolveCollection(s, ctx, { title: "x", actor: USER }).collectionId).toBeNull();
    expect(resolveCollection(s, ctx, { collection: "c3", title: "x", actor: USER }).collectionId).not.toBeNull();
  });

  it("caps names in createCollection/updateCollection but keeps old long names editable", () => {
    const { ctx, state } = setup();
    const long = "a".repeat(LIMITS.collectionName + 1);
    expect(codeOf(() => createCollection(state, ctx, { name: long }))).toBe("too_large");
    const legacy = { ...state, collections: { c1: { id: "c1", name: long, description: "", createdAt: "t" } } };
    expect(updateCollection(legacy, { id: "c1", description: "d" }).value.name).toBe(long);
    expect(codeOf(() => updateCollection(legacy, { id: "c1", name: long + "b" }))).toBe("too_large");
  });
});

describe("collection default in createMemory / updateMemory", () => {
  it("honours collectionId null and an explicit collection name", () => {
    const { ctx, state } = setup();
    const none = createMemory(state, ctx, { title: "A", collectionId: null, actor: USER });
    expect(none.value.collectionId).toBeNull();
    expect(Object.keys(none.state.collections)).toHaveLength(0);
    const named = createMemory(state, ctx, { title: "B", collection: "Ideas", actor: USER });
    expect(names(named.state)).toEqual(["Ideas"]);
    expect(named.value.collectionId).toBe(Object.keys(named.state.collections)[0]);
  });

  it("update never re-defaults, only an explicit collection/collectionId changes it", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "A", collectionId: null, actor: USER });
    const u = updateMemory(m.state, ctx, { id: m.value.id, patch: { content: "x", title: "Proj: renamed" }, actor: USER });
    expect(u.value.collectionId).toBeNull();
    expect(Object.keys(u.state.collections)).toHaveLength(0);
    const col = createCollection(u.state, ctx, { id: "c1", name: "Work" }).state;
    const byName = updateMemory(col, ctx, { id: m.value.id, patch: { collection: "work" }, actor: USER });
    expect(byName.value.collectionId).toBe("c1");
    const cleared = updateMemory(byName.state, ctx, { id: m.value.id, patch: { collectionId: null }, actor: USER });
    expect(cleared.value.collectionId).toBeNull();
    expect(codeOf(() => updateMemory(col, ctx, { id: m.value.id, patch: { collection: "nope" }, actor: AGENT }))).toBe("collection_not_found");
  });

  it("an agent save keeps the assignment pending until approved; rejecting leaves an empty Unsorted that can be deleted", () => {
    const { ctx, state } = setup();
    const created = createMemory(state, ctx, { title: "Agent note", actor: AGENT });
    const id = created.value.id;
    const rev = pendingRevisionFor(created.state, id)!;
    expect(rev.snapshot.collectionId).not.toBeNull();
    expect(Object.keys(created.state.collections)).toHaveLength(1); // Unsorted exists immediately
    const approved = approveRevision(created.state, ctx, { revisionId: rev.id, actor: USER });
    expect(getMemory(approved.state, id)?.collectionId).toBe(rev.snapshot.collectionId);

    const second = createMemory(state, ctx, { title: "Rejected", actor: AGENT });
    const rev2 = pendingRevisionFor(second.state, second.value.id)!;
    const rejected = rejectRevision(second.state, ctx, { revisionId: rev2.id, actor: USER });
    const colId = rev2.snapshot.collectionId as string;
    expect(rejected.state.collections[colId].name).toBe(UNSORTED_NAME);
    expect(Object.keys(deleteCollection(rejected.state, { id: colId }).state.collections)).toHaveLength(0);
  });

  it("an agent can place a memory in an existing collection by name, otherwise errors", () => {
    const { ctx, state } = setup();
    const s = createCollection(state, ctx, { id: "c1", name: "Work" }).state;
    const ok = createMemory(s, ctx, { title: "A", collection: "WORK", actor: AGENT });
    expect(pendingRevisionFor(ok.state, ok.value.id)?.snapshot.collectionId).toBe("c1");
    expect(codeOf(() => createMemory(s, ctx, { title: "B", collection: "Nope", actor: AGENT }))).toBe("collection_not_found");
  });
});
