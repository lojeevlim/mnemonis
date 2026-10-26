/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted-shaped fixture data */
import { describe, expect, it } from "vitest";
import v3Projects from "./__fixtures__/v3-projects.json";
import v2Prefixes from "./__fixtures__/v2-prefixes.json";
import v1Seed from "./__fixtures__/v1-seed.json";
import { DomainError } from "./context";
import { LIMITS } from "./limits";
import { createMemory, updateMemory } from "./memoryOps";
import { migrateWorkspaceState } from "./migrate";
import {
  assignProjectOrganization,
  confirmOrganization,
  createOrganization,
  deleteOrganization,
  findOrganizationByKey,
  listOrganizations,
  organizationIdForKey,
  projectsOfOrganization,
  pruneEmptyAutoOrganizations,
  renameOrganization,
} from "./organizations";
import { confirmProject, createProject, deleteProject } from "./projects";
import { createEmptyWorkspace, repairOrganizations, SCHEMA_VERSION, validateWorkspaceState } from "./state";
import { approveRevision, rejectRevision } from "./versioning";
import { AGENT, setup, USER } from "./testUtils";
import type { WorkspaceState } from "./types";

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : `non-domain: ${String(e)}`;
  }
  return undefined;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const orgs = (s: WorkspaceState) => Object.values(s.organizations);
const projs = (s: WorkspaceState) => Object.values(s.projects);
const load = (raw: unknown): WorkspaceState => {
  const r = validateWorkspaceState(raw);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};
const migrate = (raw: unknown): WorkspaceState => {
  const r = migrateWorkspaceState(raw);
  if (!r.ok) throw new Error(`migration failed: ${r.reason}`);
  return r.state;
};

function agentSave(s: WorkspaceState, ctx: ReturnType<typeof setup>["ctx"], project: string, organization?: string, title = `${project} note`) {
  return createMemory(s, ctx, { title, project: { name: project }, ...(organization !== undefined && { organization }), actor: AGENT });
}

describe("schema 4", () => {
  it("an empty workspace is v4 with no organizations and validates", () => {
    const s = createEmptyWorkspace();
    expect(SCHEMA_VERSION).toBe(4);
    expect(s.schemaVersion).toBe(4);
    expect(s.organizations).toEqual({});
    expect(validateWorkspaceState(clone(s)).ok).toBe(true);
  });

  it("organizationIdForKey is org_ + 16 hex", () => {
    expect(organizationIdForKey("rok")).toMatch(/^org_[0-9a-f]{16}$/);
    expect(organizationIdForKey("rok")).toBe(organizationIdForKey("rok"));
  });

  it("a v4 state without the organizations map, or with a bad organizationId, is corrupt", () => {
    const s: any = clone(createEmptyWorkspace());
    delete s.organizations;
    expect(validateWorkspaceState(s).ok).toBe(false);
    const { ctx, state } = setup();
    const p: any = clone(createProject(state, ctx, { name: "A", actor: USER }).state);
    p.projects[Object.keys(p.projects)[0]].organizationId = 5;
    expect(validateWorkspaceState(p).ok).toBe(false);
  });
});

describe("v3 -> v4 migration", () => {
  const raw = v3Projects as any;

  it("keeps every id and record and only adds organizations {} + organizationId null", () => {
    const s = migrate(clone(raw));
    expect(s.schemaVersion).toBe(4);
    expect(s.organizations).toEqual({});
    expect(s.memories).toEqual(raw.memories);
    expect(s.revisions).toEqual(raw.revisions);
    expect(s.relations).toEqual(raw.relations);
    expect(s.collections).toEqual(raw.collections);
    expect(Object.keys(s.projects)).toEqual(Object.keys(raw.projects));
    expect(Object.keys(raw.projects).length).toBeGreaterThan(0);
    for (const [id, p] of Object.entries<any>(raw.projects)) expect(s.projects[id]).toEqual({ ...p, organizationId: null });
  });

  it("is pure (input untouched) and idempotent", () => {
    const input = clone(raw);
    const once = migrate(input);
    expect(input).toEqual(raw);
    expect(migrate(clone(once))).toEqual(once);
    expect(migrate(once)).toEqual(once);
  });

  it("the v2 and v1 chains end at the same v4 shape", () => {
    const fromV2 = migrate(clone(v2Prefixes));
    expect(fromV2.schemaVersion).toBe(4);
    expect(fromV2.organizations).toEqual({});
    expect(fromV2).toEqual(migrate(clone(raw)));
    for (const p of projs(fromV2)) expect(p.organizationId).toBeNull();
    const fromV1 = migrate(clone(v1Seed));
    expect(fromV1.schemaVersion).toBe(4);
    expect(migrate(clone(fromV1))).toEqual(fromV1);
  });

  it("rejects a v3 payload that is not a map / has hostile keys", () => {
    expect(migrateWorkspaceState({ ...clone(raw), projects: [] }).ok).toBe(false);
    const bad = clone(raw);
    bad.projects = JSON.parse('{"__proto__":{"id":"__proto__"}}');
    expect(migrateWorkspaceState(bad).ok).toBe(false);
  });
});

describe("agent organization input", () => {
  it("a new project gets its organization (created once, unconfirmed, autoCreated) and a second call reuses it", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    expect(orgs(a)).toHaveLength(1);
    const rok = orgs(a)[0];
    expect(rok).toMatchObject({ name: "ROK", key: "rok", autoCreated: true, confirmed: false, createdBy: "bot" });
    expect(projs(a)[0].organizationId).toBe(rok.id);
    const b = agentSave(a, ctx, "Other", "rok").state; // case-insensitive reuse by key
    expect(orgs(b)).toHaveLength(1);
    expect(projs(b).every((p) => p.organizationId === rok.id)).toBe(true);
    expect(validateWorkspaceState(clone(b)).ok).toBe(true);
  });

  it("does not store the organization in any revision snapshot", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    for (const r of Object.values(a.revisions)) expect(Object.keys(r.snapshot)).not.toContain("organizationId");
  });

  it("requires project (invalid_input), also on update and with projectId", () => {
    const { ctx, state } = setup();
    expect(code(() => createMemory(state, ctx, { title: "x", organization: "ROK", actor: AGENT }))).toBe("invalid_input");
    const m = createMemory(state, ctx, { title: "x", actor: USER });
    expect(code(() => updateMemory(m.state, ctx, { id: m.value.id, patch: { content: "y", organization: "ROK" }, actor: AGENT }))).toBe("invalid_input");
    const p = createProject(m.state, ctx, { name: "P", actor: USER });
    expect(code(() => createMemory(p.state, ctx, { title: "z", projectId: p.value.id, organization: "ROK", actor: AGENT }))).toBe("invalid_input");
  });

  it("never changes the organization of an existing confirmed / user project, or one that already has one", () => {
    const { ctx, state } = setup();
    const user = createProject(state, ctx, { name: "Mine", actor: USER });
    const noChange = agentSave(user.state, ctx, "Mine", "Sneaky");
    expect(orgs(noChange.state)).toHaveLength(0);
    expect(projs(noChange.state).find((p) => p.name === "Mine")!.organizationId).toBeNull();

    // user assigns an org to a (confirmed) project; the agent cannot move it
    const o = createOrganization(user.state, ctx, { name: "Zengineering", actor: USER });
    const assigned = assignProjectOrganization(o.state, { projectId: user.value.id, organizationId: o.value.id, actor: USER });
    const again = agentSave(assigned.state, ctx, "Mine", "Other");
    expect(again.state.projects[user.value.id].organizationId).toBe(o.value.id);
    expect(orgs(again.state)).toHaveLength(1);

    // an unconfirmed agent project that already has an organization keeps it
    const first = agentSave(state, ctx, "VT", "ROK").state;
    const second = agentSave(first, ctx, "VT", "Elsewhere").state;
    expect(orgs(second).map((x) => x.name)).toEqual(["ROK"]);
    expect(projs(second)[0].organizationId).toBe(orgs(second)[0].id);
  });

  it("an existing unconfirmed agent project with no organization receives one", () => {
    const { ctx, state } = setup();
    const first = agentSave(state, ctx, "VT").state;
    expect(projs(first)[0].organizationId).toBeNull();
    const second = agentSave(first, ctx, "VT", "ROK", "VT other").state;
    expect(orgs(second)).toHaveLength(1);
    expect(projs(second)[0].organizationId).toBe(orgs(second)[0].id);
  });

  it("updateMemory with project + organization links a new project", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "note", actor: USER });
    const u = updateMemory(m.state, ctx, { id: m.value.id, patch: { project: { name: "VT" }, organization: "ROK" }, actor: AGENT });
    expect(orgs(u.state).map((o) => o.name)).toEqual(["ROK"]);
    expect(projs(u.state)[0].organizationId).toBe(orgs(u.state)[0].id);
  });

  it("validates the name even when it would be ignored: reserved, control, Cf, empty, over-long", () => {
    const { ctx, state } = setup();
    const user = createProject(state, ctx, { name: "Mine", actor: USER }).state;
    for (const bad of ["Unsorted", "__proto__", "a\u0000b", "a​b", "a‮b", "   ", ""]) {
      expect(code(() => agentSave(user, ctx, "Mine", bad)), JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(code(() => agentSave(user, ctx, "Mine", "x".repeat(101)))).toBe("too_large");
    expect(code(() => agentSave(user, ctx, "Mine", 5 as any))).toBe("invalid_input");
    const ok = agentSave(state, ctx, "Fresh", "  Zeng   Corp  ").state;
    expect(orgs(ok)[0].name).toBe("Zeng Corp");
  });

  it("caps: unconfirmed agent organizations (10) and total (50) -> too_large", () => {
    const { ctx, state } = setup();
    let s = state;
    for (let i = 0; i < LIMITS.maxAutoOrganizations; i++) s = agentSave(s, ctx, `P${i}`, `Org ${i}`).state;
    expect(orgs(s)).toHaveLength(LIMITS.maxAutoOrganizations);
    expect(code(() => agentSave(s, ctx, "PX", "One too many"))).toBe("too_large");
    expect(orgs(agentSave(s, ctx, "PY", "org 3").state)).toHaveLength(LIMITS.maxAutoOrganizations); // reuse is fine
    // total cap with user orgs
    let u = state;
    for (let i = 0; i < LIMITS.maxOrganizations; i++) u = createOrganization(u, ctx, { name: `U${i}`, actor: USER }).state;
    expect(code(() => createOrganization(u, ctx, { name: "more", actor: USER }))).toBe("too_large");
    expect(code(() => agentSave(u, ctx, "PZ", "agent org"))).toBe("too_large");
    expect(orgs(agentSave(u, ctx, "PZ", "u3").state)).toHaveLength(LIMITS.maxOrganizations);
  });
});

describe("confirm and prune", () => {
  it("rejecting the only proposal prunes the project and its unconfirmed organization", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK");
    expect(orgs(a.state)).toHaveLength(1);
    const rejected = rejectRevision(a.state, ctx, { revisionId: a.value.revisionId, actor: USER }).state;
    expect(projs(rejected)).toHaveLength(0);
    expect(orgs(rejected)).toHaveLength(0);
  });

  it("an organization still referenced by another project survives the prune of one project", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK");
    const b = agentSave(a.state, ctx, "Other", "ROK");
    const rejected = rejectRevision(b.state, ctx, { revisionId: b.value.revisionId, actor: USER }).state;
    expect(projs(rejected).map((p) => p.name)).toEqual(["VT"]);
    expect(orgs(rejected)).toHaveLength(1);
  });

  it("approving a memory in the project confirms the project and its organization", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK");
    const approved = approveRevision(a.state, ctx, { revisionId: a.value.revisionId, actor: USER }).state;
    expect(projs(approved)[0].confirmed).toBe(true);
    expect(orgs(approved)[0]).toMatchObject({ confirmed: true, autoCreated: true });
    // confirmed organizations are never pruned
    expect(pruneEmptyAutoOrganizations(approved)).toBe(approved);
  });

  it("confirmProject cascades to the organization; confirmOrganization confirms on its own", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    const c = confirmProject(a, { id: projs(a)[0].id, actor: USER }).state;
    expect(orgs(c)[0].confirmed).toBe(true);
    const b = agentSave(state, ctx, "VT", "ROK").state;
    const d = confirmOrganization(b, { id: orgs(b)[0].id, actor: USER });
    expect(d.value.confirmed).toBe(true);
    expect(projs(d.state)[0].confirmed).toBe(false);
    expect(confirmOrganization(d.state, { id: d.value.id, actor: USER }).state).toBe(d.state); // idempotent
  });

  it("pruneEmptyAutoOrganizations is pure, idempotent and only touches unreferenced unconfirmed agent organizations", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    const userOrg = createOrganization(a, ctx, { name: "Mine", actor: USER });
    const orphaned: WorkspaceState = { ...userOrg.state, projects: {} };
    const before = clone(orphaned);
    const pruned = pruneEmptyAutoOrganizations(orphaned);
    expect(orphaned).toEqual(before);
    expect(orgs(pruned).map((o) => o.name)).toEqual(["Mine"]);
    expect(pruneEmptyAutoOrganizations(pruned)).toBe(pruned);
  });

  it("an agent withdrawing its own proposal (back to the saved snapshot) leaves no project or organization behind", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "note", actor: USER });
    const u = updateMemory(m.state, ctx, { id: m.value.id, patch: { project: { name: "VT" }, organization: "ROK" }, actor: AGENT });
    expect(orgs(u.state)).toHaveLength(1);
    const withdrawn = updateMemory(u.state, ctx, { id: m.value.id, patch: { projectId: null, collectionId: m.value.collectionId }, actor: AGENT });
    expect(projs(withdrawn.state)).toHaveLength(0);
    expect(orgs(withdrawn.state)).toHaveLength(0);
  });
});

describe("user operations", () => {
  it("create / rename / delete with duplicates and unknown ids", () => {
    const { ctx, state } = setup();
    const a = createOrganization(state, ctx, { name: "  ROK ", actor: USER });
    expect(a.value).toMatchObject({ name: "ROK", key: "rok", autoCreated: false, confirmed: true, createdBy: A_NAME });
    expect(code(() => createOrganization(a.state, ctx, { name: "rok", actor: USER }))).toBe("duplicate_organization");
    const b = createOrganization(a.state, ctx, { name: "Zengineering", actor: USER });
    expect(code(() => renameOrganization(b.state, { id: b.value.id, name: "ROK", actor: USER }))).toBe("duplicate_organization");
    expect(renameOrganization(b.state, { id: b.value.id, name: "ZENGINEERING", actor: USER }).value.name).toBe("ZENGINEERING");
    expect(code(() => renameOrganization(b.state, { id: "org_nope", name: "x", actor: USER }))).toBe("organization_not_found");
    expect(code(() => renameOrganization(b.state, { id: "__proto__", name: "x", actor: USER }))).toBe("organization_not_found");
    expect(code(() => deleteOrganization(b.state, { id: "org_nope", actor: USER }))).toBe("organization_not_found");
    expect(code(() => confirmOrganization(b.state, { id: "org_nope", actor: USER }))).toBe("organization_not_found");
    expect(code(() => createOrganization(b.state, ctx, { name: "Unsorted", actor: USER }))).toBe("invalid_input");
    expect(listOrganizations(b.state).map((o) => o.name)).toEqual(["ROK", "Zengineering"]);
    expect(findOrganizationByKey(b.state, "rok")?.id).toBe(a.value.id);
  });

  it("assign / unassign a project; unknown ids", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "VT", actor: USER });
    const o = createOrganization(p.state, ctx, { name: "ROK", actor: USER });
    const as = assignProjectOrganization(o.state, { projectId: p.value.id, organizationId: o.value.id, actor: USER });
    expect(as.value.organizationId).toBe(o.value.id);
    expect(projectsOfOrganization(as.state, o.value.id).map((x) => x.id)).toEqual([p.value.id]);
    expect(assignProjectOrganization(as.state, { projectId: p.value.id, organizationId: null, actor: USER }).state.projects[p.value.id].organizationId).toBeNull();
    expect(code(() => assignProjectOrganization(o.state, { projectId: "prj_x", organizationId: null, actor: USER }))).toBe("project_not_found");
    expect(code(() => assignProjectOrganization(o.state, { projectId: p.value.id, organizationId: "org_x", actor: USER }))).toBe("organization_not_found");
  });

  it("assigning an unconfirmed organization acknowledges it", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    const p = createProject(a, ctx, { name: "Mine", actor: USER });
    const as = assignProjectOrganization(p.state, { projectId: p.value.id, organizationId: orgs(a)[0].id, actor: USER });
    expect(orgs(as.state)[0].confirmed).toBe(true);
  });

  it("deleting an organization unlinks its projects and never deletes them", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    const d = deleteOrganization(a, { id: orgs(a)[0].id, actor: USER }).state;
    expect(orgs(d)).toHaveLength(0);
    expect(projs(d)).toHaveLength(1);
    expect(projs(d)[0].organizationId).toBeNull();
    expect(validateWorkspaceState(clone(d)).ok).toBe(true);
  });

  it("deleting an unreferenced project also prunes its unconfirmed organization", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "VT", actor: USER });
    const withOrg: WorkspaceState = {
      ...p.state,
      organizations: { org_1: { id: "org_1", key: "rok", name: "ROK", createdAt: "t", createdBy: "bot", autoCreated: true, confirmed: false } },
      projects: { [p.value.id]: { ...p.value, organizationId: "org_1" } },
    };
    const d = deleteProject(withOrg, { id: p.value.id, actor: USER }).state;
    expect(orgs(d)).toHaveLength(0);
  });

  it("agents (and malformed actors) are forbidden / invalid for every user operation", () => {
    const { ctx, state } = setup();
    const a = agentSave(state, ctx, "VT", "ROK").state;
    const id = orgs(a)[0].id;
    const pid = projs(a)[0].id;
    expect(code(() => createOrganization(a, ctx, { name: "x", actor: AGENT }))).toBe("forbidden");
    expect(code(() => renameOrganization(a, { id, name: "x", actor: AGENT }))).toBe("forbidden");
    expect(code(() => deleteOrganization(a, { id, actor: AGENT }))).toBe("forbidden");
    expect(code(() => confirmOrganization(a, { id, actor: AGENT }))).toBe("forbidden");
    expect(code(() => assignProjectOrganization(a, { projectId: pid, organizationId: null, actor: AGENT }))).toBe("forbidden");
    expect(code(() => createOrganization(a, ctx, { name: "x", actor: { kind: "root", name: "x" } as any }))).toBe("invalid_input");
  });

  it("user ops use prototype-safe lookups", () => {
    const { ctx, state } = setup();
    for (const id of ["__proto__", "constructor", "prototype", "toString"]) {
      expect(code(() => deleteOrganization(state, { id, actor: USER })), id).toBe("organization_not_found");
    }
    const p = createProject(state, ctx, { name: "VT", actor: USER });
    expect(code(() => assignProjectOrganization(p.state, { projectId: p.value.id, organizationId: "__proto__", actor: USER }))).toBe("organization_not_found");
  });
});

describe("repair on load", () => {
  const base = (): any => {
    const { ctx, state } = setup();
    const p1 = createProject(state, ctx, { name: "One", actor: USER });
    const p2 = createProject(p1.state, ctx, { name: "Two", actor: USER });
    return { raw: clone(p2.state), p1: p1.value.id, p2: p2.value.id };
  };
  const org = (id: string, name: string, createdAt: string, extra: any = {}) => ({
    id, key: name.toLowerCase(), name, createdAt, createdBy: "u", autoCreated: false, confirmed: true, ...extra,
  });

  it("a dangling organizationId becomes null", () => {
    const { raw, p1 } = base();
    raw.projects[p1].organizationId = "org_gone";
    expect(load(raw).projects[p1].organizationId).toBeNull();
  });

  it("duplicate keys keep the oldest; projects of the dropped one move to it", () => {
    const { raw, p1, p2 } = base();
    raw.organizations = { o2: org("o2", "ROK", "2026-02-01T00:00:00.000Z"), o1: org("o1", "rok", "2026-01-01T00:00:00.000Z") };
    raw.projects[p1].organizationId = "o2";
    raw.projects[p2].organizationId = "o1";
    const s = load(raw);
    expect(Object.keys(s.organizations)).toEqual(["o1"]);
    expect(s.projects[p1].organizationId).toBe("o1");
    expect(s.projects[p2].organizationId).toBe("o1");
  });

  it("cleans names (control / Cf / NFC / length / reserved) and is pure, idempotent, same object when clean", () => {
    const { raw } = base();
    raw.organizations = {
      a: org("a", "A​B\u0001C", "2026-01-01T00:00:00.000Z", { key: "x" }),
      b: org("b", "Unsorted", "2026-01-02T00:00:00.000Z"),
      c: org("c", "x".repeat(300), "2026-01-03T00:00:00.000Z"),
    };
    const before = clone(raw);
    const s = load(raw);
    expect(raw).toEqual(before);
    expect(s.organizations.a.name).toBe("AB C");
    expect(s.organizations.a.key).toBe("ab c");
    expect(s.organizations.b.name).toBe("Organization b");
    expect(s.organizations.c.name).toHaveLength(100);
    expect(repairOrganizations(s)).toBe(s);
    expect(load(clone(s))).toEqual(s);
  });

  it("hostile sizes: 20k duplicate / dangling organizations repair in linear time", () => {
    const { raw } = base();
    const organizations: any = {};
    for (let i = 0; i < 20_000; i++) organizations[`o${i}`] = org(`o${i}`, i % 2 ? "Same" : `Name ${i}`, new Date(1e12 + i * 1000).toISOString());
    raw.organizations = organizations;
    for (let i = 0; i < 2000; i++) {
      raw.projects[`p${i}`] = { ...raw.projects[Object.keys(raw.projects)[0]], id: `p${i}`, key: `p${i}`, name: `p${i}`, collectionId: null, organizationId: `o${i}` };
    }
    const t0 = performance.now();
    const s = load(raw);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(Object.values(s.organizations).filter((o) => o.key === "same")).toHaveLength(1);
    for (const p of Object.values(s.projects)) expect(p.organizationId === null || p.organizationId in s.organizations).toBe(true);
  });

  it("prototype-polluting organization keys are rejected, not repaired", () => {
    const { raw } = base();
    raw.organizations = JSON.parse('{"__proto__":{"id":"__proto__","key":"a","name":"A","createdAt":"t","createdBy":"u","autoCreated":false,"confirmed":true}}');
    expect(validateWorkspaceState(raw).ok).toBe(false);
    raw.organizations = { constructor: org("constructor", "A", "t") };
    expect(validateWorkspaceState(raw).ok).toBe(false);
  });

  it("rejects malformed organization records", () => {
    const { raw } = base();
    raw.organizations = { a: { ...org("a", "A", "t"), confirmed: "yes" } };
    expect(validateWorkspaceState(raw).ok).toBe(false);
    raw.organizations = { a: { ...org("a", "A", "t"), name: 5 } };
    expect(validateWorkspaceState(raw).ok).toBe(false);
  });
});

const A_NAME = USER.name;
