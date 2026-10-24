import {
  addRelation,
  archiveMemory,
  commitDrafts,
  createBranch,
  createMemory,
  updateMemory,
  type WorkspaceState,
} from "../../domain";
import { setup } from "../../domain/testUtils";
import { frequentTopics, overviewStats, recentChanges, recentCommits } from "./selectors";

function build() {
  const { ctx, state: s0 } = setup();
  let s: WorkspaceState = s0;
  const mk = (id: string, tags: string[], extra: { provenance?: { origin: string; createdBy: string } } = {}) => {
    s = createMemory(s, ctx, { id, title: id, tags, author: "a", ...extra }).state;
  };
  mk("m1", ["Search", "ux"]);
  mk("m2", ["search"]);
  mk("m3", ["infra"], { provenance: { origin: "demo", createdBy: "Demo" } });
  mk("m4", ["Demo", "infra"]);
  s = commitDrafts(s, ctx, { message: "first", author: "a" }).state;
  s = addRelation(s, ctx, { fromId: "m1", toId: "m2", label: "rel", provenance: { origin: "user", createdBy: "a" } }).state;
  s = addRelation(s, ctx, { fromId: "m3", toId: "m4", label: "rel", provenance: { origin: "user", createdBy: "a" } }).state;
  return { s, ctx };
}

describe("overview selectors", () => {
  it("computes stats and counts drafts, archived, branches and commits", () => {
    const { s, ctx } = build();
    expect(overviewStats(s)).toMatchObject({ branchName: "main", memories: 4, archived: 0, drafts: 0, branches: 1, commits: 1 });
    let t = updateMemory(s, ctx, { id: "m1", patch: { title: "m1 edited" }, author: "a" }).state;
    t = archiveMemory(t, ctx, { id: "m2", author: "a" }).state;
    t = createBranch(t, ctx, { name: "x" }).state;
    expect(overviewStats(t)).toMatchObject({ memories: 3, archived: 1, drafts: 2, branches: 2 });
  });

  it("lists recent changes newest first and limits", () => {
    const { s, ctx } = build();
    const t = updateMemory(s, ctx, { id: "m2", patch: { title: "newest" }, author: "a" }).state;
    const list = recentChanges(t, 2);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("m2");
  });

  it("flags demo-only commits", () => {
    const { s, ctx } = build();
    expect(recentCommits(s)[0]).toMatchObject({ changeCount: 4, demo: false });
    let t = updateMemory(s, ctx, { id: "m3", patch: { title: "m3b" }, author: "a" }).state;
    t = commitDrafts(t, ctx, { message: "second", author: "a" }).state;
    const [latest, first] = recentCommits(t);
    expect(latest.commit.message).toBe("second");
    expect(latest.demo).toBe(true);
    expect(first.demo).toBe(false);
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
    const t = archiveMemory(s, ctx, { id: "m2", author: "a" }).state;
    expect(frequentTopics(t, { exclude: ["demo"] }).find((x) => x.tag.toLowerCase() === "search")).toMatchObject({ memories: 1, connections: 0 });
    expect(frequentTopics(setup().state)).toEqual([]);
  });
});
