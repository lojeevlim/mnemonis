import { describe, expect, it } from "vitest";
import { DomainError } from "./context";
import { archiveMemory, createMemory, updateMemory } from "./memoryOps";
import { createProject, renameProject } from "./projects";
import { currentSavedRevision, getMemory, memoryHistory } from "./queries";
import { validateWorkspaceState } from "./state";
import { AGENT, setup, USER } from "./testUtils";
import { applyReassignments, autoFileOwnMemories, suggestReassignments, suggestionCount, unsortedCount } from "./unsorted";
import { approveRevision } from "./versioning";
import type { WorkspaceState } from "./types";

type Ctx = ReturnType<typeof setup>["ctx"];

/** An agent-written memory that a user approved (current saved origin "agent"). */
function approvedAgent(state: WorkspaceState, ctx: Ctx, title: string): { state: WorkspaceState; id: string } {
  const made = createMemory(state, ctx, { title, actor: AGENT });
  const next = approveRevision(made.state, ctx, { revisionId: made.value.revisionId, actor: USER }).state;
  return { state: next, id: made.value.id };
}

/** An Acme project created AFTER a user-written and an agent-approved "Acme: ..." memory exist. */
function scenario() {
  const { ctx, state } = setup();
  const own = createMemory(state, ctx, { title: "Acme: own note", actor: USER });
  const ag = approvedAgent(own.state, ctx, "Acme: agent note");
  // createProject files the user's own note automatically; the agent-written one stays a suggestion.
  const proj = createProject(ag.state, ctx, { name: "Acme", actor: USER });
  return { ctx, ownId: own.value.id, agentId: ag.id, state: proj.state, project: proj.value };
}

describe("suggestReassignments", () => {
  it("lists agent-written memories in Unsorted whose title names a unique project, with origin split", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme: agent note");
    const p = createProject(a.state, ctx, { name: "Acme", actor: USER });
    const s = suggestReassignments(p.state);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ memoryId: a.id, origin: "agent", toProjectId: p.value.id, toCollectionId: p.value.collectionId });
    expect(s[0].fromCollectionId).not.toBe(p.value.collectionId);
    expect(suggestionCount(p.state)).toBe(1);
    expect(suggestionCount(p.state, "user")).toBe(0);
    expect(unsortedCount(p.state)).toBe(1);
  });

  it("matches a title that is exactly the project name and an alias after a rename", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme");
    const b = approvedAgent(a.state, ctx, "Acme: x");
    const p = createProject(b.state, ctx, { name: "Acme", actor: USER });
    const r = renameProject(p.state, { id: p.value.id, name: "Acme Inc", actor: USER }, ctx);
    expect(suggestReassignments(r.state).map((x) => x.memoryId).sort()).toEqual([a.id, b.id].sort());
  });

  it("suggests nothing when the title matches several projects (ambiguous)", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme: agent note");
    const p1 = createProject(a.state, ctx, { name: "Acme", actor: USER });
    const p2 = createProject(p1.state, ctx, { name: "Other", actor: USER });
    const dup: WorkspaceState = {
      ...p2.state,
      projects: { ...p2.state.projects, [p2.value.id]: { ...p2.value, aliases: ["acme"] } },
    };
    expect(suggestReassignments(dup)).toEqual([]);
  });

  it("skips memories that already have a project or a real collection, archived ones and ones with a pending proposal", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme: in a folder");
    const b = approvedAgent(a.state, ctx, "Acme: archived");
    const c = approvedAgent(b.state, ctx, "Acme: proposal");
    const p = createProject(c.state, ctx, { name: "Acme", actor: USER });
    let s = p.state;
    s = updateMemory(s, ctx, { id: a.id, patch: { collection: "Elsewhere" }, actor: USER }).state;
    s = updateMemory(s, ctx, { id: b.id, patch: { content: "x" }, actor: USER }).state; // user edit; origin becomes user
    s = archiveMemory(s, ctx, { id: b.id, actor: USER }).state;
    s = updateMemory(s, ctx, { id: c.id, patch: { content: "agent tweak" }, actor: AGENT }).state;
    expect(suggestReassignments(s)).toEqual([]);
  });

  it("is pure and idempotent: filing removes the suggestion and a second apply changes nothing", () => {
    const { state: s0, agentId } = scenario();
    const before = JSON.stringify(s0);
    const first = suggestReassignments(s0);
    expect(JSON.stringify(s0)).toBe(before);
    expect(first.map((x) => x.memoryId)).toEqual([agentId]);
    const { ctx } = setup();
    const applied = applyReassignments(s0, ctx, { actor: USER });
    expect(applied.value.map((x) => x.memoryId)).toEqual([agentId]);
    expect(suggestReassignments(applied.state)).toEqual([]);
    const again = applyReassignments(applied.state, ctx, { actor: USER });
    expect(again.value).toEqual([]);
    expect(again.state).toBe(applied.state);
  });

  it("returns nothing for a workspace without projects or without matches", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme: note");
    expect(suggestReassignments(a.state)).toEqual([]);
    const p = createProject(a.state, ctx, { name: "Zeta", actor: USER });
    expect(suggestReassignments(p.state)).toEqual([]);
    expect(autoFileOwnMemories(p.state, ctx, { actor: USER }).state).toBe(p.state);
  });
});

describe("applyReassignments", () => {
  it("files agent-written memories into the project and its folder, only when a user asks", () => {
    const { ctx, state, agentId, project } = scenario();
    const r = applyReassignments(state, ctx, { actor: USER });
    const m = getMemory(r.state, agentId)!;
    expect(m.projectId).toBe(project.id);
    expect(m.collectionId).toBe(project.collectionId);
    const head = currentSavedRevision(r.state, agentId)!;
    expect(head.origin).toBe("user");
    expect(head.note).toBe("Filed into Acme");
    expect(validateWorkspaceState(r.state).ok).toBe(true);
  });

  it("only files the requested ids", () => {
    const { ctx, state } = setup();
    const a = approvedAgent(state, ctx, "Acme: one");
    const b = approvedAgent(a.state, ctx, "Acme: two");
    const p = createProject(b.state, ctx, { name: "Acme", actor: USER });
    const r = applyReassignments(p.state, ctx, { ids: [a.id, "mem_nope"], actor: USER });
    expect(r.value.map((x) => x.memoryId)).toEqual([a.id]);
    expect(getMemory(r.state, b.id)!.projectId).toBeNull();
  });

  it("refuses an agent actor", () => {
    const { ctx, state } = scenario();
    let code: string | undefined;
    try {
      applyReassignments(state, ctx, { actor: AGENT });
    } catch (e) {
      code = e instanceof DomainError ? e.code : "other";
    }
    expect(code).toBe("forbidden");
  });
});

describe("auto-filing the user's own memories", () => {
  it("createProject files own memories (user revision with the note) but never agent-written ones", () => {
    const { state, ownId, agentId, project } = scenario();
    const own = getMemory(state, ownId)!;
    expect(own.projectId).toBe(project.id);
    expect(own.collectionId).toBe(project.collectionId);
    const head = currentSavedRevision(state, ownId)!;
    expect(head).toMatchObject({ origin: "user", status: "saved", note: "Filed automatically into Acme" });
    expect(memoryHistory(state, ownId)).toHaveLength(2);
    expect(getMemory(state, agentId)!.projectId).toBeNull();
    expect(suggestionCount(state, "agent")).toBe(1);
  });

  it("is idempotent", () => {
    const { ctx, state } = scenario();
    const again = autoFileOwnMemories(state, ctx, { actor: USER });
    expect(again.value).toEqual([]);
    expect(again.state).toBe(state);
  });

  it("an agent actor files nothing", () => {
    const { ctx, state } = setup();
    const own = createMemory(state, ctx, { title: "Acme: note", actor: USER });
    const p = createProject(own.state, ctx, { name: "Zeta", actor: USER });
    expect(autoFileOwnMemories(p.state, ctx, { actor: AGENT }).value).toEqual([]);
  });

  it("confirmProject and renameProject move nothing (only createProject auto-files); the suggestion stays for an explicit file", () => {
    const { ctx, state } = setup();
    const made = createProject(state, ctx, { name: "Acme", actor: USER });
    const own = createMemory(made.state, ctx, { title: "Plain", actor: USER });
    // The project gets a new name that matches the memory: the rename does not rewrite the memory...
    const renamed = renameProject(own.state, { id: made.value.id, name: "Plain", actor: USER }, ctx);
    expect(getMemory(renamed.state, own.value.id)!.projectId).toBeNull();
    expect(memoryHistory(renamed.state, own.value.id)).toHaveLength(1);
    // ...but it is still suggested, and the explicit action files it.
    expect(suggestReassignments(renamed.state).map((x) => x.memoryId)).toEqual([own.value.id]);
    expect(applyReassignments(renamed.state, ctx, { actor: USER }).value).toHaveLength(1);
    const m2 = createMemory(renamed.state, ctx, { title: "Acme: old name", actor: USER });
    expect(getMemory(m2.state, m2.value.id)!.projectId).toBe(made.value.id); // alias resolves on create
  });

  it("a user retitling a memory so it matches a project files it; an explicit project choice is respected", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    const m = createMemory(p.state, ctx, { title: "Misc", actor: USER });
    expect(getMemory(m.state, m.value.id)!.projectId).toBeNull();
    const u = updateMemory(m.state, ctx, { id: m.value.id, patch: { title: "Acme: now about acme" }, actor: USER });
    expect(u.value.projectId).toBe(p.value.id);
    expect(currentSavedRevision(u.state, m.value.id)!.note).toBe("Filed automatically into Acme");
    const m2 = createMemory(u.state, ctx, { title: "Misc 2", actor: USER });
    const u2 = updateMemory(m2.state, ctx, { id: m2.value.id, patch: { title: "Acme: kept out", projectId: null }, actor: USER });
    expect(u2.value.projectId).toBeNull();
  });

  it("a memory created with an explicit no-project / collection choice is left alone", () => {
    const { ctx, state } = setup();
    const p = createProject(state, ctx, { name: "Acme", actor: USER });
    const m = createMemory(p.state, ctx, { title: "Acme", projectId: null, collectionId: null, actor: USER });
    expect(getMemory(m.state, m.value.id)!.projectId).toBeNull();
  });
});
