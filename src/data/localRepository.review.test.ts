import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace, createSequentialContext, listMemories } from "../domain";
import { CORRUPT_BACKUP_KEY, LocalRepository, STORAGE_KEY, type StorageLike } from "./localRepository";

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

const make = (storage: StorageLike | null) =>
  new LocalRepository({ storage, ctx: createSequentialContext(), createInitial: createEmptyWorkspace });

describe("MAJOR-2 serialized mutations", () => {
  it("un-awaited concurrent mutations both take effect", async () => {
    const repo = make(new MemoryStorage());
    const [a, b] = await Promise.all([repo.createMemory({ title: "A", author: "t" }), repo.createMemory({ title: "B", author: "t" })]);
    expect(a.value.id).not.toBe(b.value.id);
    const s = await repo.load().then(() => repo.export()).then((j) => JSON.parse(j).state);
    expect(Object.keys(s.memories)).toHaveLength(2);
    expect(listMemories(b.state).map((m) => m.title).sort()).toEqual(["A", "B"]);
  });

  it("mixed concurrent mutations compose, persist, and a failure does not stall the queue", async () => {
    const storage = new MemoryStorage();
    const repo = make(storage);
    const results = await Promise.allSettled([
      repo.createMemory({ title: "One", author: "t" }),
      repo.createCollection({ name: "Col" }),
      repo.updateMemory({ id: "nope", patch: { title: "x" }, author: "t" }),
      repo.createMemory({ title: "Two", author: "t" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled"]);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY)!).state;
    expect(Object.keys(persisted.memories)).toHaveLength(2);
    expect(Object.keys(persisted.collections)).toHaveLength(1);
  });
});

describe("MINOR-5 corrupt backup", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("keeps the FIRST corrupt backup when a second corrupt load happens", async () => {
    storage.setItem(STORAGE_KEY, "{first-corrupt");
    await make(storage).load();
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe("{first-corrupt");
    storage.setItem(STORAGE_KEY, "{second-corrupt");
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("corrupt");
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe("{first-corrupt");
  });

  it("treats a structurally deep-invalid stored state as corrupt", async () => {
    const s = createEmptyWorkspace() as unknown as Record<string, unknown>;
    (s.branches as Record<string, { name: unknown }>).main.name = 42;
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, state: s }));
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("corrupt");
  });

  it("importJson rejects malicious payloads and oversized input without changing state", async () => {
    const repo = make(storage);
    await repo.load();
    const evil = '{"schemaVersion":1,"currentBranchId":"main","memories":{"__proto__":{"id":"__proto__"}},"revisions":{},"commits":{},"branches":{"main":{"id":"main","name":"main","headCommitId":null,"baseCommitId":null}},"relations":{},"collections":{},"pendingMerge":null}';
    await expect(repo.importJson(evil)).rejects.toThrow(/corrupt/);
    await expect(repo.importJson("x".repeat(11 * 1024 * 1024))).rejects.toThrow(/too large/);
    expect(Object.keys((await repo.createMemory({ title: "ok", author: "t" })).state.memories)).toHaveLength(1);
  });
});
