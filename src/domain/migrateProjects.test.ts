/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted-shaped fixture data */
import { describe, expect, it } from "vitest";
import v1Seed from "./__fixtures__/v1-seed.json";
import v1Drafts from "./__fixtures__/v1-drafts.json";
import v2Prefixes from "./__fixtures__/v2-prefixes.json";
import { createSequentialContext } from "./context";
import { createMemory } from "./memoryOps";
import { migrateWorkspaceState } from "./migrate";
import { projectIdForKey } from "./projects";
import { listMemories, pendingChanges } from "./queries";
import { createEmptyWorkspace, validateWorkspaceState } from "./state";
import { USER } from "./testUtils";
import type { WorkspaceState } from "./types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const migrate = (raw: unknown): WorkspaceState => {
  const r = migrateWorkspaceState(raw);
  if (!r.ok) throw new Error(`migration failed: ${r.reason}`);
  return r.state;
};

describe("v2 -> v3 migration", () => {
  const raw = v2Prefixes as any;
  const s = migrate(clone(raw));
  const byKey = (k: string) => Object.values(s.projects).find((p) => p.key === k);

  it("keeps every id and record: memories, revisions, relations, collections", () => {
    expect(s.schemaVersion).toBe(3);
    expect(s.memories).toEqual(raw.memories);
    expect(s.relations).toEqual(raw.relations);
    expect(Object.keys(s.revisions)).toEqual(Object.keys(raw.revisions));
    expect(Object.keys(s.collections)).toEqual(Object.keys(raw.collections)); // none created
    for (const [id, r] of Object.entries<any>(raw.revisions)) {
      // identical apart from the normalisation default
      expect(s.revisions[id]).toEqual({ ...r, snapshot: { ...r.snapshot, projectId: null } });
    }
    expect(validateWorkspaceState(s).ok).toBe(true);
  });

  it("derives projects from the title prefixes with deterministic ids, as the graph does", () => {
    expect(Object.values(s.projects).map((p) => p.key).sort()).toEqual(["acme portal", "mnemonis"]);
    // not projects: a pending-only memory, an archived one, a URL title, a stand-alone note
    const mn = byKey("mnemonis");
    expect(mn).toMatchObject({
      id: projectIdForKey("mnemonis"),
      name: "Mnemonis",
      aliases: [],
      sources: [{ kind: "prefix", ref: "mnemonis" }],
      autoCreated: false,
      confirmed: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(byKey("acme portal")).toMatchObject({ id: projectIdForKey("acme portal"), name: "Acme Portal" });
    expect(mn?.id).toMatch(/^prj_[0-9a-f]{16}$/);
  });

  it("links the oldest same-named collection both ways and leaves the rest alone", () => {
    const mn = byKey("mnemonis")!;
    const acme = byKey("acme portal")!;
    expect(mn.collectionId).toBe("col_a");
    expect(s.collections.col_a.projectId).toBe(mn.id);
    expect(acme.collectionId).toBe("col_c");
    expect(s.collections.col_c.projectId).toBe(acme.id);
    expect(s.collections.col_b).toEqual(raw.collections.col_b); // duplicate name: untouched
    expect(s.collections.col_d).toEqual(raw.collections.col_d);
  });

  it("does not backfill projectId into snapshots (read time derivation instead) and keeps pending proposals", () => {
    for (const r of Object.values(s.revisions)) expect(r.snapshot.projectId).toBeNull();
    expect(pendingChanges(s)).toHaveLength(1);
    expect(listMemories(s)).toHaveLength(8);
  });

  it("is idempotent and deterministic", () => {
    const again = migrate(clone(s));
    expect(again).toEqual(s);
    expect(migrate(clone(raw))).toEqual(s);
    expect(migrate(clone(again))).toEqual(migrate(clone(s)));
  });

  it("does not mutate its input", () => {
    const input = clone(raw);
    const before = JSON.stringify(input);
    migrate(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("an empty / project-free v2 workspace gets an empty projects map", () => {
    const empty = migrate({ schemaVersion: 2, memories: {}, revisions: {}, relations: {}, collections: {} });
    expect(empty).toEqual(createEmptyWorkspace());
  });

  it("v1 chains through v2 to v3 and stays idempotent", () => {
    for (const v1 of [v1Seed, v1Drafts]) {
      const m = migrate(clone(v1));
      expect(m.schemaVersion).toBe(3);
      expect(Object.keys(m.projects).every((k) => m.projects[k].id === k)).toBe(true);
      for (const r of Object.values(m.revisions)) expect(r.snapshot.projectId).toBeNull();
      expect(migrate(clone(m))).toEqual(m);
    }
  });

  it("rejects hostile v2 input as corrupt without throwing", () => {
    const evil = clone(raw);
    evil.revisions.rev_m1.snapshot.projectId = 5;
    expect(migrateWorkspaceState(evil)).toEqual({ ok: false, reason: "corrupt" });
    const reserved = clone(raw);
    reserved.revisions = JSON.parse('{"__proto__":{"id":"__proto__"}}');
    expect(migrateWorkspaceState(reserved)).toEqual({ ok: false, reason: "corrupt" });
    const junk = clone(raw);
    junk.projects = { p: { id: "p" } };
    expect(migrateWorkspaceState(junk)).toEqual({ ok: false, reason: "corrupt" });
    expect(migrateWorkspaceState({ ...clone(raw), revisions: 5 })).toEqual({ ok: false, reason: "corrupt" });
  });

  it("new workspaces validate and a v3 state is not re-derived", () => {
    const ctx = createSequentialContext();
    const a = createMemory(createEmptyWorkspace(), ctx, { title: "Foo: a", actor: USER });
    const b = createMemory(a.state, ctx, { title: "Foo: b", actor: USER });
    expect(b.state.projects).toEqual({}); // creating memories never derives projects; only migration does
    expect(migrate(clone(b.state))).toEqual(b.state);
    expect(migrate(clone({ ...raw, schemaVersion: 2 })).projects).toEqual(s.projects);
  });
});

describe("v3 validation", () => {
  const valid = () => clone(migrate(clone(v2Prefixes)));
  it("requires projectId on snapshots and well-formed projects / sources", () => {
    const a: any = valid();
    delete a.revisions.rev_m1.snapshot.projectId;
    expect(validateWorkspaceState(a).ok).toBe(false);
    const b: any = valid();
    b.projects[projectIdForKey("mnemonis")].sources = [{ kind: "disk", ref: "/Users/x" }];
    expect(validateWorkspaceState(b).ok).toBe(false);
    const c: any = valid();
    c.projects[projectIdForKey("mnemonis")].id = "other";
    expect(validateWorkspaceState(c).ok).toBe(false);
    const d: any = valid();
    delete d.projects;
    expect(validateWorkspaceState(d).ok).toBe(false);
    const e: any = valid();
    e.collections.col_a.projectId = 3;
    expect(validateWorkspaceState(e).ok).toBe(false);
  });
});
