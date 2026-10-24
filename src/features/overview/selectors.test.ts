import {
  addRelation,
  archiveMemory,
  createMemory,
  updateMemory,
  type Actor,
  type WorkspaceState,
} from "../../domain";
import { AGENT, setup, USER } from "../../domain/testUtils";
import { frequentTopics, overviewStats, recentActivity, recentChanges } from "./selectors";

function build() {
  const { ctx, state: s0 } = setup();
  let s: WorkspaceState = s0;
  const mk = (id: string, tags: string[], extra: { provenance?: { origin: string; createdBy: string } } = {}) => {
    s = createMemory(s, ctx, { id, title: id, tags, actor: USER, ...extra }).state;
  };
  mk("m1", ["Search", "ux"]);
  mk("m2", ["search"]);
  mk("m3", ["infra"], { provenance: { origin: "demo", createdBy: "Demo" } });
  mk("m4", ["Demo", "infra"]);
  s = addRelation(s, ctx, { fromId: "m1", toId: "m2", label: "rel", provenance: { origin: "user", createdBy: "a" }, actor: USER }).state;
  s = addRelation(s, ctx, { fromId: "m3", toId: "m4", label: "rel", provenance: { origin: "user", createdBy: "a" }, actor: USER }).state;
  return { s, ctx };
}

describe("overview selectors", () => {
  it("computes stats and counts pending proposals, archived and saved changes", () => {
    const { s, ctx } = build();
    expect(overviewStats(s)).toEqual({ memories: 4, archived: 0, pending: 0, saves: 4 });
    // User edits are saved immediately (they add to saved changes, never to pending).
    let t = updateMemory(s, ctx, { id: "m1", patch: { title: "m1 edited" }, actor: USER }).state;
    t = archiveMemory(t, ctx, { id: "m2", actor: USER }).state;
    expect(overviewStats(t)).toEqual({ memories: 3, archived: 1, pending: 0, saves: 6 });
    // Agent writes wait in the inbox and do not change saved counts.
    const agent: Actor = AGENT;
    t = updateMemory(t, ctx, { id: "m3", patch: { title: "m3 proposed" }, actor: agent }).state;
    expect(overviewStats(t)).toEqual({ memories: 3, archived: 1, pending: 1, saves: 6 });
  });

  it("lists recent changes newest first and limits", () => {
    const { s, ctx } = build();
    const t = updateMemory(s, ctx, { id: "m2", patch: { title: "newest" }, actor: USER }).state;
    const list = recentChanges(t, 2);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("m2");
  });

  it("lists recent saved activity newest first and flags demo memories", () => {
    const { s, ctx } = build();
    const first = recentActivity(s);
    expect(first).toHaveLength(4);
    expect(first[0].revision.memoryId).toBe("m4");
    expect(first.find((a) => a.revision.memoryId === "m3")!.demo).toBe(true);
    expect(first.find((a) => a.revision.memoryId === "m1")!.demo).toBe(false);
    const t = updateMemory(s, ctx, { id: "m3", patch: { title: "m3b" }, actor: USER }).state;
    const [latest] = recentActivity(t, 1);
    expect(recentActivity(t, 1)).toHaveLength(1);
    expect(latest.revision.snapshot.title).toBe("m3b");
    expect(latest.demo).toBe(true);
    // Agent proposals are not saved activity.
    const u = updateMemory(t, ctx, { id: "m1", patch: { title: "proposal" }, actor: AGENT }).state;
    expect(recentActivity(u)[0].revision.snapshot.title).toBe("m3b");
  });

  it("ranks topics by usage plus relation degree, case-insensitively, honouring exclusions", () => {
    const { s } = build();
    const topics = frequentTopics(s, { exclude: ["demo"] });
    // "Search"/"search" merge; infra and search tie on score (4) so the tag name breaks the tie.
    expect(topics.map((t) => t.tag.toLowerCase())).toEqual(["infra", "search", "ux"]);
    expect(topics[0]).toMatchObject({ memories: 2, connections: 2, score: 4 });
    expect(topics[1]).toMatchObject({ memories: 2, connections: 2, score: 4 });
    expect(topics[2]).toMatchObject({ memories: 1, connections: 1, score: 2 });
    expect(topics.find((t) => t.tag.toLowerCase() === "demo")).toBeUndefined();
    expect(frequentTopics(s, { limit: 1, exclude: ["demo"] })).toHaveLength(1);
  });

  it("ignores archived memories and returns nothing for an empty workspace", () => {
    const { s, ctx } = build();
    const t = archiveMemory(s, ctx, { id: "m2", actor: USER }).state;
    expect(frequentTopics(t, { exclude: ["demo"] }).find((x) => x.tag.toLowerCase() === "search")).toMatchObject({ memories: 1, connections: 0 });
    expect(frequentTopics(setup().state)).toEqual([]);
  });
});
