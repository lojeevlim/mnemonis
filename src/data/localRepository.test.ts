import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace, createSequentialContext, getMemory, listMemories } from "../domain";
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

describe("LocalRepository", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("initialises when storage is empty and persists under a versioned key", async () => {
    const repo = make(storage);
    await repo.load();
    expect(repo.getStatus().loadIssue).toBe("missing");
    expect(STORAGE_KEY).toMatch(/v1$/);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).schemaVersion).toBe(1);
  });

  it("round-trips mutations across instances", async () => {
    const repo = make(storage);
    const { value } = await repo.createMemory({ title: "Persist me", author: "t" });
    await repo.commit({ message: "c", author: "t" });
    const again = make(storage);
    const s = await again.load();
    expect(again.getStatus().loadIssue).toBeNull();
    expect(getMemory(s, value.id)?.status).toBe("committed");
  });

  it.each([
    ["not json", "{{{", "corrupt"],
    ["wrong shape", JSON.stringify({ schemaVersion: 1, state: { foo: 1 } }), "corrupt"],
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

  it("detects referential corruption (dangling head commit)", async () => {
    const s = createEmptyWorkspace();
    s.branches.main.headCommitId = "ghost";
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, state: s }));
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
    const { value } = await repo.createMemory({ title: "still works", author: "t" });
    expect(value.title).toBe("still works");
    expect(repo.getStatus().persistError).toBe("quota");
    expect(make(null).load()).resolves.toBeDefined();
  });

  it("failed domain operations leave state and storage untouched", async () => {
    const repo = make(storage);
    await repo.createMemory({ title: "x", author: "t" });
    const before = storage.getItem(STORAGE_KEY);
    await expect(repo.commit({ message: "", author: "t" })).rejects.toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("exports, imports (validated) and resets", async () => {
    const repo = make(storage);
    await repo.createMemory({ title: "exported", author: "t" });
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
  });
});
