import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace, createSequentialContext } from "../domain";
import { LocalRepository } from "../data/localRepository";
import {
  createWorkspaceStore,
  selectCurrentBranch,
  selectMemories,
  selectPendingDrafts,
} from "./workspaceStore";

function makeStore() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return createWorkspaceStore(
    new LocalRepository({ storage, ctx: createSequentialContext(), createInitial: createEmptyWorkspace }),
  );
}

describe("workspace store", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(async () => {
    store = makeStore();
    await store.getState().init();
  });

  it("loads, creates a draft, exposes pending drafts, commits", async () => {
    expect(store.getState().loading).toBe(false);
    expect(selectCurrentBranch(store.getState())?.name).toBe("main");
    const m = await store.getState().createMemory({ title: "Hello" });
    expect(m?.status).toBe("draft");
    expect(selectPendingDrafts(store.getState())).toHaveLength(1);
    await store.getState().commit("first");
    expect(selectPendingDrafts(store.getState())).toHaveLength(0);
    expect(selectMemories(store.getState())[0].status).toBe("committed");
  });

  it("surfaces domain errors without losing state", async () => {
    await store.getState().createMemory({ title: "x" });
    const result = await store.getState().commit("   ");
    expect(result).toBeUndefined();
    expect(store.getState().error).toMatch(/version note/);
    expect(selectPendingDrafts(store.getState())).toHaveLength(1);
    await store.getState().commit("ok");
    expect(store.getState().error).toBeNull();
  });
});
