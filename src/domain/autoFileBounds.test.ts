/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted-shaped fixture data */
import { describe, expect, it } from "vitest";
import { createSequentialContext } from "./context";
import { createMemory, updateMemory } from "./memoryOps";
import { confirmProject, createProject, MAX_DERIVED_PROJECTS, renameProject } from "./projects";
import { currentSavedRevision, getMemory, memoryHistory } from "./queries";
import { migrateWorkspaceState } from "./migrate";
import { createEmptyWorkspace, repairProjects, validateWorkspaceState } from "./state";
import { AGENT, setup, USER } from "./testUtils";
import { applyReassignments, AUTO_FILE_BULK_LIMIT, autoFileOwnMemories, suggestReassignments } from "./unsorted";
import type { Revision, WorkspaceState } from "./types";

/** n user memories "<prefix>: <i>", each with exactly one saved revision, none in a project or collection (built directly: fast). */
function bulkState(n: number, prefix = "Notes", extra = ""): WorkspaceState {
  const s = createEmptyWorkspace();
  for (let i = 0; i < n; i++) {
    const id = `m${i}`;
    const at = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
    s.memories[id] = { id, createdAt: at, source: "manual", provenance: { origin: "user", createdBy: "tester" } };
    const rev: Revision = {
      id: `r${i}`,
      memoryId: id,
      snapshot: { title: `${prefix}: ${i}`, content: extra, type: "fact", tags: [], collectionId: null, projectId: null, archived: false, metadata: {} },
      parentRevisionId: null,
      createdAt: at,
      author: "tester",
      origin: "user",
      status: "saved",
      note: "Created",
      savedAt: at,
      decidedAt: at,
    };
    s.revisions[rev.id] = rev;
  }
  return s;
}

describe("auto-filing never targets or confirms an unconfirmed agent project", () => {
  function scenario() {
    const { ctx, state } = setup();
    const own = createMemory(state, ctx, { title: "Notes: x", actor: USER });
    const agent = createMemory(own.state, ctx, { title: "Agent finding", project: { name: "Notes" }, actor: AGENT });
    const project = Object.values(agent.state.projects)[0];
    expect(project).toMatchObject({ name: "Notes", autoCreated: true, confirmed: false });
    return { ctx, ownId: own.value.id, state: agent.state, projectId: project.id };
  }
  const untouched = (s: WorkspaceState, ownId: string, projectId: string) => {
    expect(getMemory(s, ownId)!.projectId).toBeNull();
    expect(memoryHistory(s, ownId)).toHaveLength(1);
    expect(s.projects[projectId].confirmed).toBe(false);
  };

  it("createProject / confirmProject / renameProject / create / update of anything leave it alone", () => {
    const { ctx, ownId, state, projectId } = scenario();
    const other = createProject(state, ctx, { name: "Other", actor: USER });
    untouched(other.state, ownId, projectId);
    const confirmedOther = confirmProject(other.state, { id: other.value.id, actor: USER }, ctx);
    untouched(confirmedOther.state, ownId, projectId);
    const renamed = renameProject(confirmedOther.state, { id: other.value.id, name: "Other 2", actor: USER }, ctx);
    untouched(renamed.state, ownId, projectId);
    const made = createMemory(renamed.state, ctx, { title: "Something else", actor: USER });
    untouched(made.state, ownId, projectId);
    const upd = updateMemory(made.state, ctx, { id: made.value.id, patch: { title: "Notes: y" }, actor: USER });
    untouched(upd.state, ownId, projectId);
    // the memory just retitled to match is NOT filed either (the only match is unconfirmed)
    expect(getMemory(upd.state, made.value.id)!.projectId).toBeNull();
    const direct = autoFileOwnMemories(upd.state, ctx, { actor: USER });
    expect(direct.value).toEqual([]);
    untouched(direct.state, ownId, projectId);
  });

  it("explicit fileUnsorted (applyReassignments) still suggests and files into it, and then confirms it (a user action)", () => {
    const { ctx, ownId, state, projectId } = scenario();
    expect(suggestReassignments(state).map((s) => s.memoryId)).toEqual([ownId]);
    const r = applyReassignments(state, ctx, { actor: USER });
    expect(r.value.map((s) => s.memoryId)).toEqual([ownId]);
    expect(getMemory(r.state, ownId)!.projectId).toBe(projectId);
    expect(r.state.projects[projectId].confirmed).toBe(true);
    expect(currentSavedRevision(r.state, ownId)!.note).toBe("Filed into Notes");
  });

  it("once the user confirms the project, auto-filing may use it (create / update of a single memory)", () => {
    const { ctx, state, projectId } = scenario();
    const c = confirmProject(state, { id: projectId, actor: USER }, ctx);
    const m = createMemory(c.state, ctx, { title: "Misc", actor: USER });
    const u = updateMemory(m.state, ctx, { id: m.value.id, patch: { title: "Notes: z" }, actor: USER });
    expect(u.value.projectId).toBe(projectId);
  });
});

describe("bounded automatic filing", () => {
  it("one createProject files at most AUTO_FILE_BULK_LIMIT memories; the rest stay suggestions", () => {
    const ctx = createSequentialContext();
    const p = createProject(bulkState(120), ctx, { name: "Notes", actor: USER });
    const filed = Object.keys(p.state.memories).filter((id) => getMemory(p.state, id)!.projectId === p.value.id);
    expect(AUTO_FILE_BULK_LIMIT).toBe(50);
    expect(filed).toHaveLength(50);
    expect(suggestReassignments(p.state)).toHaveLength(70);
    expect(validateWorkspaceState(p.state).ok).toBe(true);
    // the explicit action files the rest
    expect(applyReassignments(p.state, ctx, { actor: USER }).value).toHaveLength(70);
  });

  it("only memories whose saved history is that single revision are bulk-filed", () => {
    const ctx = createSequentialContext();
    let s = bulkState(3);
    s = updateMemory(s, ctx, { id: "m1", patch: { content: "edited by the user" }, actor: USER }).state;
    const p = createProject(s, ctx, { name: "Notes", actor: USER });
    expect(getMemory(p.state, "m0")!.projectId).toBe(p.value.id);
    expect(getMemory(p.state, "m2")!.projectId).toBe(p.value.id);
    expect(getMemory(p.state, "m1")!.projectId).toBeNull();
    expect(memoryHistory(p.state, "m1")).toHaveLength(2);
    // still suggested for the explicit action
    expect(suggestReassignments(p.state).map((x) => x.memoryId)).toEqual(["m1"]);
  });

  it("bulk filing is limited to the new project; agent-written and other projects' matches are left", () => {
    const ctx = createSequentialContext();
    const s = bulkState(2, "Beta");
    const a = createProject(s, ctx, { name: "Alpha", actor: USER });
    expect(getMemory(a.state, "m0")!.projectId).toBeNull();
    const b = createProject(a.state, ctx, { name: "Beta", actor: USER });
    expect(getMemory(b.state, "m0")!.projectId).toBe(b.value.id);
  });

  it("skips (silently, 0) when the workspace is within 10% of the size cap; createProject still succeeds", () => {
    const base = bulkState(5, "Notes", "x".repeat(2000));
    const size = JSON.stringify(base).length;
    const ctx = createSequentialContext();
    ctx.workspaceQuotaBytes = Math.ceil(size * 1.05); // 95% used
    const p = createProject(base, ctx, { name: "Notes", actor: USER });
    expect(Object.keys(p.state.projects)).toEqual([p.value.id]);
    expect(Object.keys(p.state.revisions)).toHaveLength(5); // nothing was filed
    expect(autoFileOwnMemories(base, ctx, { actor: USER }).value).toEqual([]);
    // with room it files
    const roomy = createSequentialContext();
    roomy.workspaceQuotaBytes = size * 3;
    expect(createProject(base, roomy, { name: "Notes", actor: USER }).state.revisions).not.toEqual(base.revisions);
  });

  it("files only as many as fit below 90% of the cap", () => {
    const base = bulkState(10, "Notes", "x".repeat(10_000));
    const tight = createSequentialContext();
    tight.workspaceQuotaBytes = 1000; // far over: nothing is filed while the project is created
    const withProject = createProject(base, tight, { name: "Notes", actor: USER }).state;
    expect(Object.keys(withProject.revisions)).toHaveLength(10);
    const one = JSON.stringify(base.revisions.r0.snapshot).length + 512;
    const ctx = createSequentialContext();
    ctx.workspaceQuotaBytes = Math.ceil((JSON.stringify(withProject).length + 3 * one + 100) / 0.9);
    expect(autoFileOwnMemories(withProject, ctx, { actor: USER }).value).toHaveLength(3);
  });

  it("an explicit no-project choice is respected at write time; edited memories are never bulk-filed", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    const m = createMemory(p.state, ctx, { title: "Acme: kept out", projectId: null, actor: USER });
    expect(getMemory(m.state, m.value.id)!.projectId).toBeNull();
    const e = updateMemory(m.state, ctx, { id: m.value.id, patch: { content: "touched" }, actor: USER });
    const q = createProject(e.state, ctx, { name: "Other", actor: USER });
    expect(getMemory(q.state, m.value.id)!.projectId).toBeNull();
    expect(autoFileOwnMemories(e.state, ctx, { actor: USER }).value).toEqual([]);
  });

  it("is fast on 5000 memories: a no-match pass and a bounded 50-memory filing, each well under 2 s", () => {
    const base = bulkState(5000);
    const ctx = createSequentialContext();
    let t0 = performance.now();
    const none = createProject(base, ctx, { name: "Zeta", actor: USER });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(Object.keys(none.state.revisions)).toHaveLength(5000);
    t0 = performance.now();
    const filed = createProject(base, ctx, { name: "Notes", actor: USER });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    expect(Object.keys(filed.state.revisions)).toHaveLength(5050);
    expect(suggestReassignments(filed.state)).toHaveLength(4950);
  });
});

describe("migration derives only real projects", () => {
  const v2 = (titles: string[], extra: Record<string, unknown> = {}): any => {
    const s: any = bulkState(0);
    titles.forEach((title, i) => {
      const at = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
      s.memories[`m${i}`] = { id: `m${i}`, createdAt: at, source: "manual", provenance: { origin: "user", createdBy: "t" } };
      s.revisions[`r${i}`] = {
        id: `r${i}`, memoryId: `m${i}`, parentRevisionId: null, createdAt: at, author: "t", origin: "user", status: "saved", note: "", savedAt: at, decidedAt: at,
        snapshot: { title, content: "", type: "fact", tags: [], collectionId: null, archived: false, metadata: {} },
      };
    });
    delete s.projects;
    return { ...s, schemaVersion: 2, ...extra };
  };
  const keys = (raw: unknown) => {
    const r = migrateWorkspaceState(raw);
    expect(r.ok).toBe(true);
    return r.ok ? Object.values(r.state.projects).map((p) => p.key).sort() : [];
  };

  it("a prefix with one child is not a project; two children, or a parent and a child, are", () => {
    expect(keys(v2(["Solo: a"]))).toEqual([]);
    expect(keys(v2(["Pair: a", "Pair: b"]))).toEqual(["pair"]);
    expect(keys(v2(["Dad", "Dad: a"]))).toEqual(["dad"]);
    expect(keys(v2(["Dad"]))).toEqual([]);
  });

  it("keeps at most MAX_DERIVED_PROJECTS busiest keys, leaving room under the 200 cap", () => {
    expect(MAX_DERIVED_PROJECTS).toBe(100);
    const titles: string[] = [];
    for (let i = 0; i < 150; i++) {
      titles.push(`P${String(i).padStart(3, "0")}: a`, `P${String(i).padStart(3, "0")}: b`);
      if (i < 10) titles.push(`P${String(i).padStart(3, "0")}: c`); // the 10 busiest
    }
    const got = keys(v2(titles));
    expect(got).toHaveLength(100);
    for (let i = 0; i < 10; i++) expect(got).toContain(`p${String(i).padStart(3, "0")}`);
  });
});

describe("project data is repaired on load, not rejected", () => {
  const withProjects = (): any => {
    const raw: any = JSON.parse(JSON.stringify(bulkState(2)));
    const proj = (id: string, name: string, createdAt: string, extra: any = {}) => ({
      id, key: name.toLowerCase(), name, aliases: [], sources: [], collectionId: null, createdAt, createdBy: "u", autoCreated: false, confirmed: true, ...extra,
    });
    const col = (id: string, projectId: string | null, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, name: id, description: "", createdAt, projectId });
    return { raw, proj, col };
  };
  const load = (raw: any): WorkspaceState => {
    const v = validateWorkspaceState(raw);
    if (!v.ok) throw new Error(v.reason);
    return v.state;
  };

  it("mismatched links keep both objects and clear the inconsistent pointer", () => {
    const { raw, proj, col } = withProjects();
    raw.projects = { p1: proj("p1", "One", "2026-01-01T00:00:00.000Z", { collectionId: "c1" }), p2: proj("p2", "Two", "2026-01-02T00:00:00.000Z", { collectionId: "c1" }) };
    raw.collections = { c1: col("c1", "p2"), c2: col("c2", "p1") };
    const s = load(raw);
    expect(Object.keys(s.projects)).toEqual(["p1", "p2"]);
    expect(Object.keys(s.collections)).toEqual(["c1", "c2"]);
    expect(s.projects.p1.collectionId).toBeNull(); // c1 names p2
    expect(s.projects.p2.collectionId).toBe("c1");
    expect(s.collections.c2.projectId).toBe("p1"); // one-sided (c2 names p1, p1 names nothing): tolerated as before
  });

  it("a dangling pointer on either side is cleared", () => {
    const { raw, proj, col } = withProjects();
    raw.projects = { p1: proj("p1", "One", "2026-01-01T00:00:00.000Z", { collectionId: "c_gone" }) };
    raw.collections = { c1: col("c1", "p_gone") };
    const s = load(raw);
    expect(s.projects.p1.collectionId).toBeNull();
    expect(s.collections.c1.projectId).toBeNull();
  });

  it("duplicate keys: the oldest keeps the key, the later project is renamed; aliases that clash are dropped", () => {
    const { raw, proj } = withProjects();
    raw.projects = {
      p_new: proj("p_new", "Acme", "2026-02-01T00:00:00.000Z", { aliases: ["old", "acme", "old"] }),
      p_old: proj("p_old", "Acme", "2026-01-01T00:00:00.000Z", { aliases: ["old"] }),
    };
    raw.collections = {};
    const s = load(raw);
    expect(s.projects.p_old).toMatchObject({ name: "Acme", key: "acme", aliases: ["old"] });
    expect(s.projects.p_new).toMatchObject({ name: "Acme (2)", key: "acme (2)", aliases: [] });
  });

  it("imported projects: key = normalizeTitle(name), Cf / control / NFC / length rules, over-long refs dropped", () => {
    const { raw, proj } = withProjects();
    raw.projects = {
      p1: proj("p1", "  Sp​ace\u0007  Name ", "2026-01-01T00:00:00.000Z", {
        key: "wrong",
        aliases: ["ok", "UPPER", "x".repeat(101), "zero​width"],
        sources: [
          { kind: "repo", ref: "github.com/acme/repo" },
          { kind: "repo", ref: "github.com/acme/repo" },
          { kind: "repo", ref: "h/".repeat(200) },
          { kind: "workspace", ref: "/etc/passwd" },
          { kind: "workspace", ref: "ws_1" },
          { kind: "manual", ref: "bad\u0000ref" },
        ],
      }),
      p2: proj("p2", "x".repeat(5000), "2026-01-02T00:00:00.000Z"),
      p3: proj("p3", "​​", "2026-01-03T00:00:00.000Z"),
      p4: proj("p4", "Unsorted", "2026-01-04T00:00:00.000Z"),
    };
    raw.collections = {};
    const s = load(raw);
    expect(s.projects.p1.name).toBe("Space Name");
    expect(s.projects.p1.key).toBe("space name");
    expect(s.projects.p1.aliases).toEqual(["ok"]);
    expect(s.projects.p1.sources).toEqual([
      { kind: "repo", ref: "github.com/acme/repo" },
      { kind: "workspace", ref: "ws_1" },
    ]);
    expect(s.projects.p2.name).toHaveLength(100);
    expect(s.projects.p3.name).toMatch(/^Project /);
    expect(s.projects.p4.name).toMatch(/^Project /);
    const keys = Object.values(s.projects).map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("type / size / shape errors are still rejected", () => {
    const { raw, proj } = withProjects();
    raw.projects = { p1: proj("p1", "One", "2026-01-01T00:00:00.000Z", { aliases: [1] }) };
    raw.collections = {};
    expect(validateWorkspaceState(raw).ok).toBe(false);
  });

  it("repair is pure, idempotent, leaves memories / revisions / relations alone and returns the same state when clean", () => {
    const { raw, proj, col } = withProjects();
    raw.projects = {
      p1: proj("p1", "One", "2026-01-01T00:00:00.000Z", { collectionId: "c1", aliases: ["a", "a"] }),
      p2: proj("p2", "One", "2026-01-02T00:00:00.000Z", { collectionId: "c1" }),
      p3: proj("p3", "Three", "2026-01-03T00:00:00.000Z", { collectionId: "c9" }),
    };
    raw.collections = { c1: col("c1", "p3"), c2: col("c2", "p3"), c3: col("c3", "p1") };
    const before = JSON.stringify(raw);
    const once = load(raw);
    expect(JSON.stringify(raw)).toBe(before); // input untouched
    expect(once.memories).toEqual(raw.memories);
    expect(once.revisions).toEqual(raw.revisions);
    const twice = repairProjects(once);
    expect(twice).toBe(once);
    expect(load(JSON.parse(JSON.stringify(once)))).toEqual(once);
    // a consistent link set is never changed
    const s = Object.values(once.collections);
    for (const c of s) if (c.projectId) expect(once.projects[c.projectId]).toBeDefined();
  });

  it("random link soup always ends consistent and stable", () => {
    const { raw, proj, col } = withProjects();
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let round = 0; round < 200; round++) {
      const ps: Record<string, unknown> = {};
      const cs: Record<string, unknown> = {};
      const pid = (i: number) => (i === 4 ? "p_gone" : `p${i}`);
      const cid = (i: number) => (i === 4 ? "c_gone" : `c${i}`);
      for (let i = 0; i < 4; i++) {
        ps[`p${i}`] = proj(`p${i}`, `N${rnd(3)}`, `2026-01-0${1 + rnd(3)}T00:00:00.000Z`, { collectionId: rnd(5) === 0 ? null : cid(rnd(5)) });
        cs[`c${i}`] = col(`c${i}`, rnd(5) === 0 ? null : pid(rnd(5)), `2026-01-0${1 + rnd(3)}T00:00:00.000Z`);
      }
      const s = load({ ...raw, projects: ps, collections: cs });
      expect(repairProjects(s)).toBe(s);
      const keys = Object.values(s.projects).map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of Object.values(s.projects)) {
        if (p.collectionId !== null) {
          const c = s.collections[p.collectionId];
          expect(c).toBeDefined();
          expect([null, undefined, p.id]).toContain(c.projectId);
        }
        expect(Object.values(s.collections).filter((c) => c.projectId === p.id).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a v2 workspace with broken project data migrates (repaired), a v3 one loads", () => {
    const { raw, proj } = withProjects();
    raw.projects = { p1: proj("p1", "One", "2026-01-01T00:00:00.000Z", { collectionId: "c_gone" }) };
    raw.collections = {};
    expect(migrateWorkspaceState({ ...raw, schemaVersion: 3 }).ok).toBe(true);
    const v2raw = JSON.parse(JSON.stringify({ ...raw, schemaVersion: 2 }));
    for (const r of Object.values<any>(v2raw.revisions)) delete r.snapshot.projectId;
    const m = migrateWorkspaceState(v2raw);
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.state.projects.p1.collectionId).toBeNull();
  });
});
