import { describe, expect, it } from "vitest";
import { createMemory } from "./memoryOps";
import { createCollection } from "./relations";
import { commitDrafts } from "./versioning";
import { searchWorkspace } from "./search";
import { archiveMemory } from "./memoryOps";
import { A, setup } from "./testUtils";

function build() {
  const { ctx, state } = setup();
  let s = createCollection(state, ctx, { name: "Work", id: "col_work" }).state;
  const add = (input: Parameters<typeof createMemory>[2]) => {
    s = createMemory(s, ctx, input).state;
  };
  add({ id: "alpha", title: "Alpha", content: "nothing here", type: "fact", author: A });
  add({ id: "m_pg", title: "Postgres", content: "database notes", type: "technical_decision", tags: ["db"], collectionId: "col_work", author: A });
  add({ id: "m_pg2", title: "Why Postgres over Mongo", content: "relational", type: "technical_decision", tags: ["db", "decision"], author: A });
  add({ id: "m_body", title: "Notes", content: "We chose alpha twice: alpha alpha", type: "meeting_note", author: A });
  add({ id: "m_meta", title: "Meta", content: "x", type: "reference", metadata: { owner: "zeta", nested: { k: "quasar" } }, author: A });
  add({ id: "m_tag", title: "Tagged", content: "x", tags: ["quasar"], author: A });
  s = commitDrafts(s, ctx, { message: "init", author: A }).state;
  return { s, ctx };
}

describe("search", () => {
  it("ranks exact id > exact title > prefix title > token matches", () => {
    const { s } = build();
    const byId = searchWorkspace(s, { query: "ALPHA" });
    expect(byId.items[0].memory.id).toBe("alpha"); // id (case-insensitive) and exact title
    expect(byId.items.map((i) => i.memory.id)).toContain("m_body");

    const r = searchWorkspace(s, { query: "postgres" });
    expect(r.items.map((i) => i.memory.id)).toEqual(["m_pg", "m_pg2"]); // exact title before token title match

    const prefix = searchWorkspace(s, { query: "Why Post" });
    expect(prefix.items[0].memory.id).toBe("m_pg2");

    const idExact = searchWorkspace(s, { query: "m_pg2" });
    expect(idExact.items[0].memory.id).toBe("m_pg2");
    expect(idExact.items[0].matchedOn).toContain("id");
  });

  it("scores title/tag/content/metadata tokens with AND semantics", () => {
    const { s } = build();
    expect(searchWorkspace(s, { query: "quasar" }).items.map((i) => i.memory.id).sort()).toEqual(["m_meta", "m_tag"]);
    expect(searchWorkspace(s, { query: "quasar" }).items[0].memory.id).toBe("m_tag"); // tag outweighs metadata
    expect(searchWorkspace(s, { query: "database relational" }).total).toBe(0);
    expect(searchWorkspace(s, { query: "zeta" }).items[0].matchedOn).toContain("metadata");
    expect(searchWorkspace(s, { query: "!!!" }).total).toBe(0);
  });

  it("filters by type, collection, tag, status, branch", () => {
    const { s, ctx } = build();
    expect(searchWorkspace(s, { type: "technical_decision" }).total).toBe(2);
    expect(searchWorkspace(s, { collectionId: "col_work" }).total).toBe(1);
    expect(searchWorkspace(s, { collectionId: null }).total).toBe(5);
    expect(searchWorkspace(s, { tag: "DB" }).total).toBe(2);
    expect(searchWorkspace(s, { status: "draft" }).total).toBe(0);
    expect(searchWorkspace(s, { status: "committed" }).total).toBe(6);
    const arch = archiveMemory(s, ctx, { id: "alpha", author: A }).state;
    expect(searchWorkspace(arch, {}).total).toBe(5); // archived hidden by default
    expect(searchWorkspace(arch, { includeArchived: true }).total).toBe(6);
    expect(searchWorkspace(arch, { status: "draft" }).total).toBe(1); // pending archive is a draft
    expect(() => searchWorkspace(s, { branchId: "ghost" })).toThrow();
    expect(searchWorkspace(s, { branchId: "main", type: "fact" }).total).toBe(2);
  });

  it("paginates and reports total", () => {
    const { s } = build();
    const p1 = searchWorkspace(s, { limit: 4, offset: 0 });
    const p2 = searchWorkspace(s, { limit: 4, offset: 4 });
    expect(p1.total).toBe(6);
    expect(p1.items).toHaveLength(4);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.memory.id)).size).toBe(6);
    expect(searchWorkspace(s, { limit: 4, offset: 99 }).items).toEqual([]);
  });
});
