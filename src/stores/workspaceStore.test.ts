import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace, createSequentialContext, memoryHistory } from "../domain";
import { LocalRepository } from "../data/localRepository";
import {
  createWorkspaceStore,
  selectMemories,
  selectPending,
  selectPendingRelations,
  selectTimeline,
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

const MH = { kind: "agent", name: "Memory Health: Organize" } as const;

describe("workspace store", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(async () => {
    store = makeStore();
    await store.getState().init();
  });

  it("loads and auto-saves the user's own writes (no pending, timeline grows)", async () => {
    expect(store.getState().loading).toBe(false);
    const m = await store.getState().createMemory({ title: "Hello" });
    expect(m?.status).toBe("saved");
    expect(selectPending(store.getState())).toHaveLength(0);
    expect(selectMemories(store.getState())[0].status).toBe("saved");
    const u = await store.getState().updateMemory(m!.id, { content: "body" });
    expect(u?.content).toBe("body");
    expect(selectTimeline(store.getState()).map((r) => r.note)).toEqual(["Edited content", "Created"]);
    expect(selectTimeline(store.getState())[0].author).toBe(store.getState().author);
  });

  it("agent writes (explicit actor) become pending and are approved or rejected by the user", async () => {
    const m = await store.getState().createMemory({ title: "Base", content: "a" });
    await store.getState().updateMemory(m!.id, { content: "b" }, { actor: MH });
    await store.getState().createMemory({ title: "Agent made" }, { actor: MH });
    expect(selectPending(store.getState())).toHaveLength(2);
    expect(selectMemories(store.getState())).toHaveLength(1); // the new one is not saved yet
    expect(selectMemories(store.getState())[0]).toMatchObject({ content: "a", hasPending: true });

    const [first] = selectPending(store.getState());
    expect(await store.getState().approve(first.revisionId)).toBe(true);
    expect(selectMemories(store.getState())[0].content).toBe("b");
    expect(selectPending(store.getState())).toHaveLength(1);
    expect(await store.getState().rejectAll()).toBe(true);
    expect(selectPending(store.getState())).toHaveLength(0);
    expect(selectMemories(store.getState())).toHaveLength(1);
  });

  it("approveAll approves everything", async () => {
    const a = await store.getState().createMemory({ title: "A" });
    await store.getState().updateMemory(a!.id, { title: "A2" }, { actor: MH });
    await store.getState().archiveMemory(a!.id, { actor: MH }); // same actor: accumulates into one proposal
    expect(selectPending(store.getState())).toHaveLength(1);
    await store.getState().createMemory({ title: "B" }, { actor: MH });
    expect(await store.getState().approveAll()).toBe(true);
    expect(selectPending(store.getState())).toHaveLength(0);
    expect(selectMemories(store.getState())).toHaveLength(2);
  });

  it("a user edit supersedes a pending agent proposal", async () => {
    const m = await store.getState().createMemory({ title: "T", content: "a" });
    await store.getState().updateMemory(m!.id, { content: "agent" }, { actor: MH });
    await store.getState().updateMemory(m!.id, { content: "user" });
    expect(selectPending(store.getState())).toHaveLength(0);
    expect(selectMemories(store.getState())[0].content).toBe("user");
  });

  it("rollback is a new saved revision; failures surface the error without losing state", async () => {
    const m = await store.getState().createMemory({ title: "T", content: "a" });
    await store.getState().updateMemory(m!.id, { content: "b" });
    const original = memoryHistory(store.getState().state!, m!.id)[1];
    await store.getState().rollbackMemory(m!.id, original.id);
    expect(selectMemories(store.getState())[0].content).toBe("a");
    expect(memoryHistory(store.getState().state!, m!.id)).toHaveLength(3);

    expect(await store.getState().approve("ghost")).toBe(false);
    expect(store.getState().error).toMatch(/not found/);
    expect(selectMemories(store.getState())).toHaveLength(1);
    expect(await store.getState().approveAll()).toBe(true); // nothing pending is fine
    expect(store.getState().error).toBeNull();
  });

  it("the store always approves as the user (agent actors are never used for review)", async () => {
    const m = await store.getState().createMemory({ title: "T", content: "a" });
    await store.getState().updateMemory(m!.id, { content: "b" }, { actor: MH });
    await store.getState().approve(selectPending(store.getState())[0].revisionId);
    const approved = Object.values(store.getState().state!.revisions).find((r) => r.origin === "agent");
    expect(approved?.status).toBe("saved");
    expect(approved?.author).toBe(MH.name); // the proposal keeps its author; the decision was the user's
  });

  it("user links are saved; agent links wait in the inbox until approved or rejected", async () => {
    const a = await store.getState().createMemory({ title: "A" });
    const b = await store.getState().createMemory({ title: "B" });
    await store.getState().addRelation(a!.id, b!.id, "plain"); // legacy call shape: user, saved
    expect(Object.values(store.getState().state!.relations)[0]).toMatchObject({ status: "saved" });
    await store.getState().addRelation(a!.id, b!.id, "proposed", undefined, { actor: MH });
    const pending = selectPendingRelations(store.getState());
    expect(pending).toHaveLength(1);
    expect(pending[0].provenance).toMatchObject({ origin: "process", createdBy: MH.name });
    expect(await store.getState().approveRelation(pending[0].relationId)).toBe(true);
    expect(selectPendingRelations(store.getState())).toHaveLength(0);
    await store.getState().addRelation(b!.id, a!.id, "again", undefined, { actor: MH });
    expect(await store.getState().rejectRelation(selectPendingRelations(store.getState())[0].relationId)).toBe(true);
    await store.getState().addRelation(b!.id, a!.id, "third", undefined, { actor: MH });
    expect(await store.getState().approveAll()).toBe(true);
    expect(selectPendingRelations(store.getState())).toHaveLength(0);
    await store.getState().addRelation(a!.id, b!.id, "fourth", undefined, { actor: MH });
    expect(await store.getState().rejectAll()).toBe(true);
    expect(selectPendingRelations(store.getState())).toHaveLength(0);
  });

  it("approveAll / rejectAll accept optional id filters; removeRelation is user-only for agents", async () => {
    const a = await store.getState().createMemory({ title: "A" });
    const b = await store.getState().createMemory({ title: "B" });
    await store.getState().updateMemory(a!.id, { title: "A2" }, { actor: MH });
    await store.getState().updateMemory(b!.id, { title: "B2" }, { actor: MH });
    const [first, second] = selectPending(store.getState());
    expect(await store.getState().approveAll({ revisionIds: [first.revisionId] })).toBe(true);
    expect(selectPending(store.getState())).toHaveLength(1);
    const d = await store.getState().rejectAllDetailed({ revisionIds: [second.revisionId] });
    expect(d?.rejectedRevisionIds).toEqual([second.revisionId]);
    expect(selectPending(store.getState())).toHaveLength(0);

    await store.getState().addRelation(a!.id, b!.id, "rel");
    const relId = Object.keys(store.getState().state!.relations)[0];
    await store.getState().removeRelation(relId, { actor: MH });
    expect(store.getState().error).toMatch(/Only a user/);
    expect(store.getState().state!.relations[relId]).toBeDefined();
    await store.getState().removeRelation(relId);
    expect(store.getState().state!.relations[relId]).toBeUndefined();
  });
});
