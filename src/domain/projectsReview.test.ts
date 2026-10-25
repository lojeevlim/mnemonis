/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted-shaped fixture data */
import { describe, expect, it } from "vitest";
import v2Prefixes from "./__fixtures__/v2-prefixes.json";
import { DomainError, createSequentialContext } from "./context";
import { LIMITS } from "./limits";
import { createMemory, updateMemory } from "./memoryOps";
import { migrateWorkspaceState } from "./migrate";
import { checkProjectName, confirmProject, createProject, deleteProject, pruneEmptyAutoProjects, resolveProject } from "./projects";
import { listMemories } from "./queries";
import { createCollection, deleteCollection } from "./relations";
import { validateWorkspaceState } from "./state";
import { AGENT, setup, USER } from "./testUtils";
import { autoRelate, normalizeTitle, parseTitlePrefix } from "./titlePrefix";
import { autoRelateTopics } from "./topicLinks";
import type { WorkspaceState } from "./types";
import { approveAll, approveRevision, rejectAll, rejectRevision } from "./versioning";

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : `non-domain: ${String(e)}`;
  }
  return undefined;
};
const projectsOf = (s: WorkspaceState) => Object.values(s.projects);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---- F1: hostile long titles never cost super-linear time -------------------------------------------------------

describe("hostile long titles (F1)", () => {
  const MB = 1_000_000;
  const hostile: Record<string, string> = {
    "spaced words": "a ".repeat(MB / 2),
    "commas and colons": ",:".repeat(MB / 2),
    "commas only": ",".repeat(MB),
    "colon prefix then spaces": "a: " + "b ".repeat(MB / 2),
  };
  const withTitle = (title: string): any => {
    const raw = clone(v2Prefixes) as any;
    raw.memories.hostile = { id: "hostile", createdAt: "2026-01-02T00:00:00.000Z", source: "manual", provenance: { origin: "user", createdBy: "me" } };
    raw.revisions.rev_hostile = {
      id: "rev_hostile",
      memoryId: "hostile",
      snapshot: { title, content: "", type: "fact", tags: ["x"], collectionId: null, archived: false, metadata: {} },
      parentRevisionId: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      author: "me",
      origin: "user",
      status: "saved",
      note: "Created",
      savedAt: "2026-01-02T00:00:00.000Z",
      decidedAt: "2026-01-02T00:00:00.000Z",
    };
    return raw;
  };
  const baseline = migrateWorkspaceState(clone(v2Prefixes));

  for (const [name, title] of Object.entries(hostile)) {
    it(`migrates a 1 MB title (${name}) in well under a second, with the same projects as without it`, () => {
      const raw = withTitle(title);
      const t0 = performance.now();
      const r = migrateWorkspaceState(raw);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(1000);
      expect(r.ok && baseline.ok).toBe(true);
      if (r.ok && baseline.ok) {
        expect(r.state.projects).toEqual(baseline.state.projects); // not rejected, just ignored by the scans
        expect(r.state.memories.hostile).toBeDefined();
      }
    });

    it(`normalizeTitle / parseTitlePrefix / autoRelate / topic scans are linear on it (${name})`, () => {
      const raw = withTitle(title);
      raw.schemaVersion = 3;
      for (const rev of Object.values<any>(raw.revisions)) rev.snapshot.projectId = null;
      raw.projects = {};
      const v = validateWorkspaceState(raw);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      const t0 = performance.now();
      normalizeTitle(title);
      parseTitlePrefix(title);
      const ctx = createSequentialContext();
      autoRelate(v.state, ctx, USER, "hostile");
      autoRelate(v.state, ctx, USER, "m1");
      autoRelateTopics(v.state, ctx, USER, "hostile");
      expect(performance.now() - t0).toBeLessThan(1000);
    });
  }

  it("many memories sharing one key do not cost quadratic time either", () => {
    const raw = clone(v2Prefixes) as any;
    for (let i = 0; i < 4000; i++) {
      raw.memories[`k${i}`] = { id: `k${i}`, createdAt: "2026-01-02T00:00:00.000Z", source: "manual", provenance: { origin: "user", createdBy: "me" } };
      raw.revisions[`rev_k${i}`] = {
        ...raw.revisions.rev_m1,
        id: `rev_k${i}`,
        memoryId: `k${i}`,
        snapshot: { ...raw.revisions.rev_m1.snapshot, title: `Mnemonis: item ${i}`, collectionId: null },
      };
    }
    const t0 = performance.now();
    const r = migrateWorkspaceState(raw);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.ok).toBe(true);
  });
});

// ---- F2: cleanup, deletion, cap cycling -------------------------------------------------------------------------

describe("pruneEmptyAutoProjects (F2a)", () => {
  const agentSave = (state: WorkspaceState, ctx = createSequentialContext(), name = "Acme", title = "Plan") =>
    createMemory(state, ctx, { title, project: { name }, actor: AGENT });

  it("reject of the last pending revision removes the unconfirmed project and its empty folder", () => {
    const { ctx, state } = setup();
    const m = agentSave(state, ctx);
    const p = projectsOf(m.state)[0];
    const r = rejectRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER });
    expect(r.state.projects).toEqual({});
    expect(r.state.collections[p.collectionId as string]).toBeUndefined();
    expect(validateWorkspaceState(r.state).ok).toBe(true);
  });

  it("is idempotent and leaves unrelated agent projects (no proposal yet) alone", () => {
    const { ctx, state } = setup();
    const standalone = createProject(state, ctx, { name: "Standalone", actor: AGENT });
    const m = agentSave(standalone.state, ctx);
    const acme = projectsOf(m.state).find((p) => p.key === "acme")!;
    const r = rejectRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER }).state;
    expect(Object.keys(r.projects)).toEqual([standalone.value.id]);
    expect(pruneEmptyAutoProjects(r, [acme.id, standalone.value.id])).toEqual(pruneEmptyAutoProjects(pruneEmptyAutoProjects(r, [acme.id]), [acme.id, standalone.value.id]));
    expect(pruneEmptyAutoProjects(r, [acme.id])).toBe(r); // nothing left to do
  });

  it("keeps the project while another proposal or a saved memory still references it", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "Acme", "One");
    const b = agentSave(a.state, ctx, "Acme", "Two");
    const r = rejectRevision(b.state, ctx, { revisionId: a.value.revisionId, actor: USER }).state;
    expect(projectsOf(r)).toHaveLength(1);
    const last = rejectRevision(r, ctx, { revisionId: b.value.revisionId, actor: USER }).state;
    expect(projectsOf(last)).toHaveLength(0);
  });

  it("removes it when the agent supersedes or withdraws its own proposal", () => {
    const { ctx, state } = setup();
    const m = agentSave(state, ctx);
    const old = projectsOf(m.state)[0];
    // supersede: the agent re-points the proposal at another project
    const moved = updateMemory(m.state, ctx, { id: m.value.id, patch: { project: { name: "Other" } }, actor: AGENT });
    expect(projectsOf(moved.state).map((p) => p.key)).toEqual(["other"]);
    expect(moved.state.collections[old.collectionId as string]).toBeUndefined();
    // withdraw: back to no project and the saved base
    const none = updateMemory(moved.state, ctx, { id: m.value.id, patch: { projectId: null }, actor: AGENT });
    expect(projectsOf(none.state)).toHaveLength(0);
  });

  it("a user write superseding the proposal prunes the old project", () => {
    const { ctx, state } = setup();
    const base = createMemory(state, ctx, { title: "Note", actor: USER });
    const prop = updateMemory(base.state, ctx, { id: base.value.id, patch: { project: { name: "Acme" } }, actor: AGENT });
    expect(projectsOf(prop.state)).toHaveLength(1);
    const user = updateMemory(prop.state, ctx, { id: base.value.id, patch: { content: "mine" }, actor: USER });
    expect(projectsOf(user.state)).toHaveLength(0);
  });

  it("a no-op agent update that created a project leaves nothing behind", () => {
    const { ctx, state } = setup();
    const base = createMemory(state, ctx, { title: "Note", actor: USER });
    const r = updateMemory(base.state, ctx, { id: base.value.id, patch: { project: { name: "Ghost" }, projectId: undefined }, actor: AGENT });
    // the project is referenced by the new proposal, so it stays; taking the proposal back prunes it
    expect(projectsOf(r.state)).toHaveLength(1);
    const back = updateMemory(r.state, ctx, { id: base.value.id, patch: { projectId: null }, actor: AGENT });
    expect(projectsOf(back.state)).toHaveLength(0);
  });

  it("keeps a folder that is not empty, was renamed or is shared; only unlinks it", () => {
    const { ctx, state } = setup();
    const m = agentSave(state, ctx);
    const p = projectsOf(m.state)[0];
    // a user files a memory in the project's folder
    const u = createMemory(m.state, ctx, { title: "Filed", collectionId: p.collectionId, projectId: null, actor: USER });
    const r = rejectRevision(u.state, ctx, { revisionId: m.value.revisionId, actor: USER }).state;
    expect(r.projects).toEqual({});
    expect(r.collections[p.collectionId as string]).toMatchObject({ projectId: null });
  });

  it("rejectAll and approveAll: rejected ones are pruned, approved ones are confirmed and kept", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "Acme", "One");
    const b = agentSave(a.state, ctx, "Beta", "Two");
    const rej = rejectAll(b.state, ctx, { actor: USER, revisionIds: [a.value.revisionId] }).state;
    expect(projectsOf(rej).map((p) => p.key)).toEqual(["beta"]);
    const all = rejectAll(b.state, ctx, { actor: USER }).state;
    expect(projectsOf(all)).toHaveLength(0);
    expect(Object.keys(all.collections)).toEqual([]);
    const ok = approveAll(b.state, ctx, { actor: USER }).state;
    expect(projectsOf(ok).map((p) => p.confirmed)).toEqual([true, true]);
  });

  it("never prunes confirmed or user projects", () => {
    const { ctx, state } = setup();
    const u = createProject(state, ctx, { name: "Mine", actor: USER });
    expect(pruneEmptyAutoProjects(u.state, [u.value.id])).toBe(u.state);
    const m = agentSave(u.state, ctx, "Acme");
    const ok = approveRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER }).state;
    const acme = projectsOf(ok).find((p) => p.key === "acme")!;
    expect(pruneEmptyAutoProjects(ok, [acme.id])).toBe(ok);
  });
});

describe("deleteProject (F2b)", () => {
  it("is user only", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    expect(code(() => deleteProject(p.state, { id: p.value.id, actor: AGENT }))).toBe("forbidden");
    expect(code(() => deleteProject(p.state, { id: "prj_nope", actor: USER }))).toBe("project_not_found");
  });

  it("unlinks (does not delete) the linked collection", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    const d = deleteProject(p.state, { id: p.value.id, actor: USER });
    expect(d.state.projects).toEqual({});
    expect(d.state.collections[p.value.collectionId as string]).toMatchObject({ name: "Acme", projectId: null });
    expect(validateWorkspaceState(d.state).ok).toBe(true);
  });

  it("refuses with project_in_use while a saved memory or an open proposal references it", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    const saved = createMemory(p.state, ctx, { title: "N", projectId: p.value.id, actor: USER });
    expect(code(() => deleteProject(saved.state, { id: p.value.id, actor: USER }))).toBe("project_in_use");
    const prop = createMemory(p.state, ctx, { title: "N", projectId: p.value.id, actor: AGENT });
    expect(code(() => deleteProject(prop.state, { id: p.value.id, actor: USER }))).toBe("project_in_use");
    const rej = rejectRevision(prop.state, ctx, { revisionId: prop.value.revisionId, actor: USER }).state;
    expect(code(() => deleteProject(rej, { id: p.value.id, actor: USER }))).toBeUndefined();
  });
});

describe("caps cannot be exhausted for good (F2c)", () => {
  it("an agent filling the unconfirmed cap with proposals is undone by rejecting them", () => {
    const { ctx, state } = setup();
    let s = state;
    const revs: string[] = [];
    for (let i = 0; i < LIMITS.maxAutoProjects; i++) {
      const m = createMemory(s, ctx, { title: `T${i}`, project: { name: `Junk ${i}` }, actor: AGENT });
      s = m.state;
      revs.push(m.value.revisionId);
    }
    expect(code(() => createMemory(s, ctx, { title: "X", project: { name: "One more" }, actor: AGENT }))).toBe("too_large");
    s = rejectAll(s, ctx, { actor: USER }).state;
    expect(projectsOf(s)).toHaveLength(0);
    expect(Object.keys(s.collections)).toHaveLength(0);
    expect(code(() => createMemory(s, ctx, { title: "X", project: { name: "Fine" }, actor: AGENT }))).toBeUndefined();
  });

  it("standalone agent junk projects can be deleted by the user", () => {
    const { ctx, state } = setup();
    let s = state;
    for (let i = 0; i < LIMITS.maxAutoProjects; i++) s = createProject(s, ctx, { name: `Junk ${i}`, actor: AGENT }).state;
    expect(code(() => createProject(s, ctx, { name: "More", actor: AGENT }))).toBe("too_large");
    for (const p of projectsOf(s)) s = deleteProject(s, { id: p.id, actor: USER }).state;
    expect(projectsOf(s)).toHaveLength(0);
    expect(code(() => createProject(s, ctx, { name: "More", actor: AGENT }))).toBeUndefined();
  });
});

// ---- F3: agents never adopt a user's collection -----------------------------------------------------------------

describe("agents do not adopt user collections (F3)", () => {
  it("an agent project named like a user collection leaves that collection untouched and has no folder", () => {
    const { ctx, state } = setup();
    const col = createCollection(state, ctx, { name: "Acme" });
    const m = createMemory(col.state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const p = projectsOf(m.state)[0];
    expect(p.collectionId).toBeNull();
    expect(m.state.collections[col.value.id]).toEqual(col.value); // untouched: no projectId written
    expect(Object.values(m.state.collections).filter((c) => c.name === "Acme")).toHaveLength(1);
  });

  it("an agent project gets a fresh folder only when no same-named collection exists", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: AGENT });
    expect(p.value.collectionId).not.toBeNull();
    expect(p.state.collections[p.value.collectionId as string]).toMatchObject({ name: "Acme", projectId: p.value.id });
  });

  it("the user's confirmProject adopts the oldest unlinked same-named collection (never creating one)", () => {
    const { ctx, state } = setup();
    const c1 = createCollection(state, ctx, { name: "Acme" });
    const c2 = createCollection(c1.state, ctx, { name: "ACME" });
    const a = createProject(c2.state, ctx, { name: "Acme", actor: AGENT });
    expect(a.value.collectionId).toBeNull();
    const c = confirmProject(a.state, { id: a.value.id, actor: USER });
    expect(c.value).toMatchObject({ confirmed: true, collectionId: c1.value.id });
    expect(c.state.collections[c1.value.id].projectId).toBe(a.value.id);
    expect(c.state.collections[c2.value.id].projectId ?? null).toBeNull();
    expect(Object.keys(c.state.collections)).toHaveLength(2);
    expect(confirmProject(c.state, { id: a.value.id, actor: USER }).state).toBe(c.state);
    expect(validateWorkspaceState(c.state).ok).toBe(true);
  });

  it("approving the agent's proposal (a user decision) also adopts the folder", () => {
    const { ctx, state } = setup();
    const col = createCollection(state, ctx, { name: "Acme" });
    const m = createMemory(col.state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const ok = approveRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER }).state;
    expect(projectsOf(ok)[0].collectionId).toBe(col.value.id);
    expect(ok.collections[col.value.id].projectId).toBe(projectsOf(ok)[0].id);
  });

  it("a user createProject adopts as before", () => {
    const { ctx, state } = setup();
    const col = createCollection(state, ctx, { name: "Acme" });
    const p = createProject(col.state, ctx, { name: "Acme", actor: USER });
    expect(p.value.collectionId).toBe(col.value.id);
    expect(Object.keys(p.state.collections)).toHaveLength(1);
  });
});

// ---- F4: a user takes over an unconfirmed agent project ---------------------------------------------------------

describe("user createProject takes over an unconfirmed agent project (F4)", () => {
  it("keeps the id, confirms it and keeps its folder", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Acme", actor: AGENT });
    const u = createProject(a.state, ctx, { name: " ACME ", repo: "https://github.com/o/r.git", actor: USER });
    expect(u.value.id).toBe(a.value.id);
    expect(u.value).toMatchObject({ confirmed: true, autoCreated: true, collectionId: a.value.collectionId });
    expect(u.value.sources).toEqual([{ kind: "repo", ref: "github.com/o/r" }]);
    expect(projectsOf(u.state)).toHaveLength(1);
  });

  it("a confirmed or user-created duplicate still fails, and so does an agent duplicate", () => {
    const { ctx, state } = setup();
    const user = createProject(state, ctx, { name: "Acme", actor: USER });
    expect(code(() => createProject(user.state, ctx, { name: "acme", actor: USER }))).toBe("duplicate_project");
    expect(code(() => createProject(user.state, ctx, { name: "acme", actor: AGENT }))).toBe("duplicate_project");
    const a = createProject(user.state, ctx, { name: "Beta", actor: AGENT });
    expect(code(() => createProject(a.state, ctx, { name: "beta", actor: AGENT }))).toBe("duplicate_project");
    const ok = confirmProject(a.state, { id: a.value.id, actor: USER });
    expect(code(() => createProject(ok.state, ctx, { name: "beta", actor: USER }))).toBe("duplicate_project");
  });

  it("resolveProject by name (not a user createProject) does not change an unconfirmed project", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Acme", actor: AGENT });
    const r = resolveProject(a.state, ctx, { project: { name: "Acme" }, title: "t", actor: USER });
    expect(r.projectId).toBe(a.value.id);
    expect(r.state.projects[a.value.id].confirmed).toBe(false);
  });
});

// ---- F6: names and imported projects ----------------------------------------------------------------------------

describe("project names and imported projects (F6)", () => {
  it("rejects Unicode format characters (zero-width, bidi, BOM)", () => {
    for (const bad of ["Ac​me", "Acme‮", "﻿Acme", "Ac‍me", "A⁦cme"]) {
      expect(code(() => checkProjectName(bad))).toBe("invalid_input");
    }
    expect(checkProjectName("Acme Portal")).toBe("Acme Portal");
  });

  it("applies NFC before computing name and key", () => {
    const { ctx, state } = setup();
    const nfd = "Café";
    const nfc = "Café";
    const a = createProject(state, ctx, { name: nfd, actor: USER });
    expect(a.value.name).toBe(nfc);
    expect(a.value.key).toBe(nfc.toLowerCase());
    expect(code(() => createProject(a.state, ctx, { name: nfc, actor: USER }))).toBe("duplicate_project");
  });

  const base = (): any => {
    const { ctx, state } = setup();
    const u = createProject(state, ctx, { name: "Acme", actor: USER });
    return clone(u.state);
  };

  it("validateWorkspaceState enforces alias and source counts and types", () => {
    const ok = base();
    expect(validateWorkspaceState(ok).ok).toBe(true);
    const id = Object.keys(ok.projects)[0];
    const aliases = (n: number) => ({ ...ok, projects: { [id]: { ...ok.projects[id], aliases: Array.from({ length: n }, (_, i) => `a${i}`) } } });
    expect(validateWorkspaceState(aliases(LIMITS.maxProjectAliases)).ok).toBe(true);
    expect(validateWorkspaceState(aliases(LIMITS.maxProjectAliases + 1)).ok).toBe(false);
    const sources = (n: number) => ({ ...ok, projects: { [id]: { ...ok.projects[id], sources: Array.from({ length: n }, (_, i) => ({ kind: "manual", ref: `r${i}` })) } } });
    expect(validateWorkspaceState(sources(LIMITS.maxProjectSources)).ok).toBe(true);
    expect(validateWorkspaceState(sources(LIMITS.maxProjectSources + 1)).ok).toBe(false);
    expect(validateWorkspaceState({ ...ok, projects: { [id]: { ...ok.projects[id], aliases: [1] } } }).ok).toBe(false);
    expect(validateWorkspaceState({ ...ok, projects: { [id]: { ...ok.projects[id], sources: [{ kind: "nope", ref: "x" }] } } }).ok).toBe(false);
  });

  it("collection and project links must reference each other when both are set; dangling ids are tolerated", () => {
    const ok = base();
    const id = Object.keys(ok.projects)[0];
    const cid = ok.projects[id].collectionId as string;
    const withCol = (c: any, p: any = {}) => ({ ...ok, collections: { ...ok.collections, [cid]: { ...ok.collections[cid], ...c } }, projects: { [id]: { ...ok.projects[id], ...p } } });
    expect(validateWorkspaceState(withCol({ projectId: "prj_other" })).ok).toBe(false);
    expect(validateWorkspaceState(withCol({ projectId: null }, { collectionId: "col_other" })).ok).toBe(true); // dangling project side
    expect(validateWorkspaceState(withCol({}, { collectionId: "col_other" })).ok).toBe(false); // both set, not mutual
    expect(validateWorkspaceState(withCol({ projectId: "prj_gone" }, { collectionId: null })).ok).toBe(true); // dangling collection side
    expect(validateWorkspaceState(withCol({ projectId: null })).ok).toBe(true); // one-sided
    const second = { ...ok.collections[cid], id: "col_two", projectId: id };
    expect(validateWorkspaceState({ ...ok, collections: { ...ok.collections, col_two: second } }).ok).toBe(false);
    const other = { ...ok.projects[id], id: "prj_two", key: "two", collectionId: "col_two" };
    const c2 = { ...ok.collections[cid], id: "col_two", projectId: null };
    expect(validateWorkspaceState({ ...ok, collections: { ...ok.collections, col_two: c2 }, projects: { ...ok.projects, prj_two: other } }).ok).toBe(true);
  });

  it("deleteCollection and deleteProject keep the links valid", () => {
    const { ctx, state } = setup();
    const u = createProject(state, ctx, { name: "Acme", actor: USER });
    const dc = deleteCollection(u.state, { id: u.value.collectionId as string }).state;
    expect(validateWorkspaceState(dc).ok).toBe(true);
    expect(listMemories(dc)).toEqual([]);
  });

  it("lookups tolerate duplicate keys: the oldest project wins", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Acme", actor: USER });
    const dup = { ...a.value, id: "prj_zzz", createdAt: "2030-01-01T00:00:00.000Z", collectionId: null };
    const s = { ...a.state, projects: { prj_zzz: dup, [a.value.id]: a.value } };
    const r = resolveProject(s, ctx, { project: { name: "Acme" }, title: "t", actor: USER });
    expect(r.projectId).toBe(a.value.id);
  });
});
