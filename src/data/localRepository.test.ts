import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  createSequentialContext,
  getMemory,
  listMemories,
  pendingChanges,
  type Actor,
} from "../domain";
import v1Seed from "../domain/__fixtures__/v1-seed.json";
import v1Drafts from "../domain/__fixtures__/v1-drafts.json";
import v2Prefixes from "../domain/__fixtures__/v2-prefixes.json";
import {
  CORRUPT_BACKUP_KEY,
  LEGACY_CORRUPT_BACKUP_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_V2_CORRUPT_BACKUP_KEY,
  LEGACY_V2_STORAGE_KEY,
  LocalRepository,
  STORAGE_KEY,
  type StorageLike,
} from "./localRepository";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const U: Actor = { kind: "user", name: "t" };
const AGENT: Actor = { kind: "agent", name: "bot" };

const make = (storage: StorageLike | null) =>
  new LocalRepository({ storage, ctx: createSequentialContext(), createInitial: createEmptyWorkspace });

describe("LocalRepository", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("initialises when storage is empty and persists under a versioned key", async () => {
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("missing");
    expect(STORAGE_KEY).toBe("mnemonis.workspace.v4");
    expect(CORRUPT_BACKUP_KEY).toBe("mnemonis.workspace.v4.corrupt");
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(4);
  });

  it("round-trips mutations across instances", async () => {
    const repo = make(storage);
    const { value } = await repo.createMemory({ title: "Persist me", actor: U });
    const again = make(storage);
    const s = await again.load();
    expect(again.getStatus().loadIssue).toBeNull();
    expect(getMemory(s, value.id)?.status).toBe("saved"); // a user write is saved at once
  });

  it.each([
    ["not json", "{{{", "corrupt"],
    ["wrong shape", JSON.stringify({ schemaVersion: 2, state: { foo: 1 } }), "corrupt"],
    ["null", "null", "corrupt"],
    ["future version", JSON.stringify({ schemaVersion: 99, state: { schemaVersion: 99 } }), "version-mismatch"],
  ])("falls back to a fresh workspace on unreadable data (%s)", async (_n, raw, issue) => {
    storage.setItem(STORAGE_KEY, raw);
    const repo = make(storage);
    const s = await repo.load();
    expect(listMemories(s)).toEqual([]);
    expect(repo.getStatus().loadIssue).toBe(issue);
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe(raw); // original preserved
    // replaced by valid data
    expect(make(storage).load()).resolves.toBeDefined();
  });

  it("detects referential corruption (dangling revision memory)", async () => {
    const s = createEmptyWorkspace();
    s.revisions.r = {
      id: "r",
      memoryId: "ghost",
      snapshot: { title: "t", content: "", type: "fact", tags: [], collectionId: null, projectId: null, archived: false, metadata: {} },
      parentRevisionId: null,
      createdAt: "t",
      author: "a",
      origin: "user",
      status: "saved",
      note: "",
      savedAt: "t",
      decidedAt: "t",
    };
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, state: s }));
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("corrupt");
  });

  it("survives a throwing/unavailable storage", async () => {
    const boom: StorageLike = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {},
    };
    const repo = make(boom);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("storage-unavailable");
    const { value } = await repo.createMemory({ title: "still works", actor: U });
    expect(value.title).toBe("still works");
    expect(repo.getStatus().persistError).toBe("quota");
    expect(make(null).load()).resolves.toBeDefined();
  });

  it("failed domain operations leave state and storage untouched", async () => {
    const repo = make(storage);
    await repo.createMemory({ title: "x", actor: U });
    const before = storage.getItem(STORAGE_KEY);
    await expect(repo.updateMemory({ id: "ghost", patch: { title: "y" }, actor: U })).rejects.toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("exports, imports (validated) and resets", async () => {
    const repo = make(storage);
    await repo.createMemory({ title: "exported", actor: U });
    const json = await repo.export();
    await repo.reset({ seed: false });
    expect(listMemories(await repo.load())).toHaveLength(0);
    const s = await repo.importJson(json);
    expect(listMemories(s)).toHaveLength(1);
    await expect(repo.importJson("nope")).rejects.toThrow(/JSON/);
    await expect(repo.importJson(JSON.stringify({ state: { a: 1 } }))).rejects.toThrow(/corrupt/);
    expect(listMemories(await repo.load())).toHaveLength(1);
  });

  it("default initial workspace is the demo seed", async () => {
    const repo = new LocalRepository({ storage });
    const s = await repo.load();
    expect(listMemories(s).length).toBeGreaterThanOrEqual(15);
    expect(pendingChanges(s)).toHaveLength(2);
  });

  it("agent writes wait for review; only a user can approve or reject", async () => {
    const repo = make(storage);
    const { value } = await repo.createMemory({ title: "Mine", content: "a", actor: U });
    const p = await repo.updateMemory({ id: value.id, patch: { content: "b" }, actor: AGENT });
    expect(p.value.status).toBe("pending");
    expect(p.value.content).toBe("a");
    const [change] = pendingChanges(p.state);
    await expect(repo.approve({ revisionId: change.revisionId, actor: AGENT })).rejects.toThrow(/Only a user/);
    await expect(repo.approveAll({ actor: AGENT })).rejects.toThrow(/Only a user/);
    expect(pendingChanges((await repo.load()))).toHaveLength(1);
    const ok = await repo.approve({ revisionId: change.revisionId, actor: U });
    expect(getMemory(ok.state, value.id)?.content).toBe("b");
    // survives a reload
    expect(getMemory(await make(storage).load(), value.id)?.content).toBe("b");
    await repo.updateMemory({ id: value.id, patch: { content: "c" }, actor: AGENT });
    const rej = await repo.rejectAll({ actor: U });
    expect(rej.value).toHaveLength(1);
    expect(getMemory(rej.state, value.id)?.content).toBe("b");
    const again = await repo.updateMemory({ id: value.id, patch: { content: "d" }, actor: AGENT });
    const approved = await repo.approveAll({ actor: U });
    expect(approved.value).toHaveLength(1);
    expect(getMemory(approved.state, value.id)?.content).toBe("d");
    expect(again.value.hasPending).toBe(true);
  });
});

describe("bulk filters and removeRelation via the repository", () => {
  it("approveAll / rejectAll accept id filters; detailed variants report skipped links", async () => {
    const repo = make(new MemoryStorage());
    const a = await repo.createMemory({ title: "A", actor: U });
    const b = await repo.createMemory({ title: "B", actor: U });
    await repo.updateMemory({ id: a.value.id, patch: { title: "A2" }, actor: AGENT });
    await repo.updateMemory({ id: b.value.id, patch: { title: "B2" }, actor: AGENT });
    const [first, second] = pendingChanges(await repo.load());
    const one = await repo.approveAll({ actor: U, revisionIds: [first.revisionId] });
    expect(one.value).toEqual([first.revisionId]);
    expect(pendingChanges(one.state)).toHaveLength(1);
    const rej = await repo.rejectAllDetailed({ actor: U, revisionIds: [second.revisionId, "gone"] });
    expect(rej.value.rejectedRevisionIds).toEqual([second.revisionId]);
    expect(rej.value.ignoredIds).toEqual(["gone"]);
    const none = await repo.approveAllDetailed({ actor: U });
    expect(none.value.approvedRevisionIds).toEqual([]);
  });

  it("removeRelation is user only; pending links are kept as rejected", async () => {
    const repo = make(new MemoryStorage());
    const a = await repo.createMemory({ title: "A", actor: U });
    const b = await repo.createMemory({ title: "B", actor: U });
    const prov = { origin: "process" as const, createdBy: "bot" };
    const rel = await repo.addRelation({ fromId: a.value.id, toId: b.value.id, label: "x", provenance: prov, actor: AGENT });
    await expect(repo.removeRelation({ id: rel.value.id, actor: AGENT })).rejects.toThrow(/Only a user/);
    const r = await repo.removeRelation({ id: rel.value.id, actor: U });
    expect(r.state.relations[rel.value.id].status).toBe("rejected");
  });
});

describe("legacy v1 storage", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });
  const v1Envelope = (state: unknown) => JSON.stringify({ schemaVersion: 1, state });

  it("migrates the v1 key on load, persists under v2 and leaves the v1 key untouched", async () => {
    const raw = v1Envelope(v1Seed);
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    const repo = make(storage);
    const s = await repo.load();
    expect(repo.getStatus().loadIssue).toBeNull();
    expect(listMemories(s)).toHaveLength(18);
    expect(pendingChanges(s)).toHaveLength(2); // the old experiment line, now Inbox items
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) as string);
    expect(stored.schemaVersion).toBe(4);
    expect(stored.state.schemaVersion).toBe(4);
    expect(Object.keys(stored.state.memories)).toHaveLength(19);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw); // NOT deleted, NOT rewritten
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBeNull();
    // the next load reads v2 and does not re-migrate
    storage.setItem(LEGACY_STORAGE_KEY, "changed after migration");
    expect(listMemories(await make(storage).load())).toHaveLength(18);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe("changed after migration");
  });

  it("v2 data wins over a stale v1 key", async () => {
    await make(storage).createMemory({ title: "v2 only", actor: U });
    storage.setItem(LEGACY_STORAGE_KEY, v1Envelope(v1Seed));
    const s = await make(storage).load();
    expect(listMemories(s).map((m) => m.title)).toEqual(["v2 only"]);
  });

  it("unreadable legacy data starts fresh, reports corrupt and still keeps the v1 key", async () => {
    for (const raw of ["{nope", v1Envelope({ foo: 1 }), JSON.stringify({ schemaVersion: 1 }), "null"]) {
      const st = new MemoryStorage();
      st.setItem(LEGACY_STORAGE_KEY, raw);
      const repo = make(st);
      const s = await repo.load();
      expect(listMemories(s)).toEqual([]);
      expect(repo.getStatus().loadIssue).toBe("corrupt");
      expect(st.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    }
  });

  it("a throwing storage on the legacy read does not break load", async () => {
    const st = new MemoryStorage();
    const boom: StorageLike = {
      getItem: (k) => {
        if (k === LEGACY_STORAGE_KEY) throw new Error("denied");
        return st.getItem(k);
      },
      setItem: (k, v) => st.setItem(k, v),
      removeItem: (k) => st.removeItem(k),
    };
    const repo = make(boom);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("missing");
  });

  it("imports v1 or v2 JSON, wrapped in an envelope or bare", async () => {
    const repo = make(storage);
    await repo.load();
    const a = await repo.importJson(v1Envelope(v1Drafts));
    expect(Object.keys(a.memories)).toHaveLength(4);
    expect(pendingChanges(a).map((p) => p.memoryId).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    const b = await repo.importJson(JSON.stringify(v1Seed)); // bare v1 state
    expect(listMemories(b)).toHaveLength(18);
    const exported = await repo.export();
    const c = await repo.importJson(exported); // v2 envelope round trip
    expect(c).toEqual(b);
    const d = await repo.importJson(JSON.stringify(JSON.parse(exported).state)); // bare v2 state
    expect(d).toEqual(b);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).state).toEqual(b);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull(); // importing never writes the legacy key
  });

  it("rejects a malformed v1 import and an unknown version without changing state", async () => {
    const repo = make(storage);
    await repo.load();
    const created = await repo.createMemory({ title: "keep me", actor: U });
    const broken = JSON.parse(JSON.stringify(v1Drafts));
    broken.revisions.rev_1.snapshot = { title: 1 };
    await expect(repo.importJson(v1Envelope(broken))).rejects.toThrow(/corrupt/);
    await expect(repo.importJson(JSON.stringify({ schemaVersion: 99 }))).rejects.toThrow(/version-mismatch/);
    expect(getMemory(await repo.load(), created.value.id)?.title).toBe("keep me");
  });
});

describe("storage recovery", () => {
  const v1Envelope = (state: unknown) => JSON.stringify({ schemaVersion: 1, state });

  it("corrupt v2 + intact v1 => v1 recovered, v2 backed up, v1 key untouched", async () => {
    const storage = new MemoryStorage();
    const v1 = v1Envelope(v1Seed);
    storage.setItem(STORAGE_KEY, "{broken v2");
    storage.setItem(LEGACY_STORAGE_KEY, v1);
    const repo = make(storage);
    const s = await repo.load();
    expect(listMemories(s)).toHaveLength(18);
    expect(repo.getStatus().loadIssue).toBeNull();
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe("{broken v2");
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(v1);
    expect(storage.getItem(LEGACY_CORRUPT_BACKUP_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(4); // repaired
  });

  it("corrupt v2 + unreadable v1 => both backed up separately, v1 key kept, issue reported", async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, state: { nope: 1 } }));
    storage.setItem(LEGACY_STORAGE_KEY, "{broken v1");
    const repo = make(storage);
    const s = await repo.load();
    expect(listMemories(s)).toEqual([]);
    expect(repo.getStatus().loadIssue).toBe("corrupt");
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toContain("nope");
    expect(storage.getItem(LEGACY_CORRUPT_BACKUP_KEY)).toBe("{broken v1");
    expect(LEGACY_CORRUPT_BACKUP_KEY).not.toBe(CORRUPT_BACKUP_KEY);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe("{broken v1");
  });

  it("missing v2 + unreadable v1 backs up v1 under its own slot", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, "{broken v1");
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("corrupt");
    expect(storage.getItem(LEGACY_CORRUPT_BACKUP_KEY)).toBe("{broken v1");
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBeNull();
  });

  it("agent links persist as pending through the repository and survive reload", async () => {
    const storage = new MemoryStorage();
    const repo = make(storage);
    const a = await repo.createMemory({ id: "a", title: "A", actor: U });
    await repo.createMemory({ id: "b", title: "B", actor: U });
    const rel = await repo.addRelation({
      fromId: "a",
      toId: "b",
      label: "l",
      provenance: { origin: "process", createdBy: "bot" },
      actor: AGENT,
    });
    expect(rel.value.status).toBe("pending");
    expect(a.value.status).toBe("saved");
    const reloaded = await make(storage).load();
    expect(reloaded.relations[rel.value.id].status).toBe("pending");
    await expect(repo.approveRelation({ relationId: rel.value.id, actor: AGENT })).rejects.toThrow(/Only a user/);
    const ok = await repo.approveRelation({ relationId: rel.value.id, actor: U });
    expect(ok.value.status).toBe("saved");
    const rej = await repo.addRelation({ fromId: "b", toId: "a", label: "m", provenance: { origin: "process", createdBy: "bot" }, actor: AGENT });
    expect((await repo.rejectRelation({ relationId: rej.value.id, actor: U })).value.status).toBe("rejected");
  });
});

describe("legacy v2 storage (no projects)", () => {
  const v2Envelope = (state: unknown) => JSON.stringify({ schemaVersion: 2, state });

  it("migrates the v2 key on load, persists under v4 (with derived projects) and leaves the v2 key untouched", async () => {
    const storage = new MemoryStorage();
    const raw = v2Envelope(v2Prefixes);
    storage.setItem(LEGACY_V2_STORAGE_KEY, raw);
    const repo = make(storage);
    const s = await repo.load();
    expect(repo.getStatus().loadIssue).toBeNull();
    expect(Object.keys(s.projects)).toHaveLength(2);
    expect(Object.keys(s.memories)).toEqual(Object.keys(v2Prefixes.memories));
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(4);
    expect(storage.getItem(LEGACY_V2_STORAGE_KEY)).toBe(raw);
    storage.setItem(LEGACY_V2_STORAGE_KEY, "changed after migration");
    expect(Object.keys((await make(storage).load()).projects)).toHaveLength(2);
  });

  it("an old v2 export file still imports", async () => {
    const repo = make(new MemoryStorage());
    await repo.load();
    const s = await repo.importJson(v2Envelope(v2Prefixes));
    expect(s.schemaVersion).toBe(4);
    expect(Object.keys(s.projects)).toHaveLength(2);
  });

  it("unreadable v2 data is backed up in its own slot, the v1 key is then tried", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_V2_STORAGE_KEY, "{broken");
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, state: v1Seed }));
    const repo = make(storage);
    const s = await repo.load();
    expect(listMemories(s)).toHaveLength(18);
    expect(storage.getItem(LEGACY_V2_CORRUPT_BACKUP_KEY)).toBe("{broken");
    expect(storage.getItem(LEGACY_V2_STORAGE_KEY)).toBe("{broken");
  });

  it("only unreadable v2 data reports corrupt and starts fresh", async () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_V2_STORAGE_KEY, v2Envelope({ foo: 1 }));
    const repo = make(storage);
    expect(listMemories(await repo.load())).toEqual([]);
    expect(repo.getStatus().loadIssue).toBe("corrupt");
  });
});
