import { describe, expect, it } from "vitest";
import { DomainError } from "./context";
import { createMemory, rollbackMemory, updateMemory } from "./memoryOps";
import {
  confirmProject,
  createProject,
  normalizeRepoUrl,
  projectIdForKey,
  projectOfMemory,
  renameProject,
  resolveProject,
  sha256Hex,
} from "./projects";
import { createCollection, deleteCollection } from "./relations";
import { approveRevision, rejectRevision } from "./versioning";
import { getMemory, listMemories, pendingChanges } from "./queries";
import { validateWorkspaceState } from "./state";
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

const projectsOf = (s: WorkspaceState) => Object.values(s.projects);

describe("sha256Hex / ids", () => {
  it("matches known sha256 vectors, including multi-block and non-ascii input", () => {
    const vectors: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["x".repeat(55), "d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072"],
    ["x".repeat(56), "04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e"],
    ["x".repeat(64), "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c"],
    ["x".repeat(1000), "44f8354494a5ba03ba1792a8d3e9c534c47a9181980fde7a3f44b06ef2ae7c7f"],
    ["héllo wörld ✓", "c2a59c71097b678dc5af2eb1f98ddc575b63948b0fa6740071a945673aaada4d"],
    ];
    for (const [input, hex] of vectors) expect(sha256Hex(input)).toBe(hex);
    expect(projectIdForKey("acme")).toBe(`prj_${sha256Hex("acme").slice(0, 16)}`);
    expect(projectIdForKey("acme")).toMatch(/^prj_[0-9a-f]{16}$/);
  });
});

describe("normalizeRepoUrl", () => {
  const same = [
    "https://github.com/Acme/Portal",
    "https://github.com/acme/portal.git",
    "HTTPS://GitHub.com/acme/portal/",
    "https://user:s3cret@github.com/acme/portal.git",
    "https://x-access-token:abc@github.com:8443/acme/portal.git/",
    "http://github.com/acme/portal?tab=readme#top",
    "ssh://git@github.com/acme/portal.git",
    "ssh://git@github.com:22/acme/portal",
    "git@github.com:acme/portal.git",
    "git@GitHub.com:Acme/Portal",
    "github.com:acme/portal",
  ];
  it.each(same)("%s -> github.com/acme/portal", (u) => {
    expect(normalizeRepoUrl(u)).toBe("github.com/acme/portal");
  });
  it("keeps GitLab sub-groups", () => {
    expect(normalizeRepoUrl("git@gitlab.com:grp/sub/repo.git")).toBe("gitlab.com/grp/sub/repo");
  });
  it.each([
    "file:///home/me/repo",
    "git://github.com/acme/portal",
    "ftp://github.com/acme/portal",
    "/Users/me/code/portal",
    "C:\\code\\portal",
    "C:/code/portal",
    "../portal",
    "github.com",
    "https://github.com/onlyowner",
    "https://github.com/a/../b",
    "https://github.com/a/b c",
    "https://[::1]/a/b",
    "javascript:alert(1)",
    "",
    "   ",
    `https://github.com/acme/${"x".repeat(200)}`,
  ])("rejects %j", (u) => {
    expect(normalizeRepoUrl(u)).toBeNull();
  });
  it("rejects non-strings", () => {
    expect(normalizeRepoUrl(5)).toBeNull();
    expect(normalizeRepoUrl(null)).toBeNull();
  });
});

describe("auto-creation", () => {
  it("an agent save with `project` creates the project AND its default collection once, flagged unconfirmed", () => {
    const { state, ctx } = setup();
    const a = createMemory(state, ctx, { title: "Login flow", project: { name: "Acme Portal" }, actor: AGENT });
    expect(projectsOf(a.state)).toHaveLength(1);
    const p = projectsOf(a.state)[0];
    expect(p).toMatchObject({ name: "Acme Portal", key: "acme portal", autoCreated: true, confirmed: false, createdBy: "bot", aliases: [] });
    expect(Object.values(a.state.collections)).toHaveLength(1);
    const col = Object.values(a.state.collections)[0];
    expect(col).toMatchObject({ name: "Acme Portal", projectId: p.id });
    expect(p.collectionId).toBe(col.id);
    // the memory is a pending proposal pointing at them; it is not "in" the project until approved
    expect(a.value.projectId).toBe(p.id);
    expect(a.value.collectionId).toBe(col.id);
    expect(a.value.status).toBe("pending");
    expect(listMemories(a.state)).toEqual([]);
    expect(validateWorkspaceState(a.state).ok).toBe(true);

    const b = createMemory(a.state, ctx, { title: "Billing", project: { name: "  acme   PORTAL " }, actor: AGENT });
    expect(projectsOf(b.state)).toHaveLength(1);
    expect(Object.keys(b.state.collections)).toEqual([col.id]);
    expect(b.value.projectId).toBe(p.id);
    expect(b.value.collectionId).toBe(col.id);
  });

  it("a user project is confirmed immediately and a user memory is saved into it", () => {
    const { state, ctx } = setup();
    const a = createMemory(state, ctx, { title: "Notes", project: { name: "Home" }, actor: USER });
    const p = projectsOf(a.state)[0];
    expect(p).toMatchObject({ autoCreated: false, confirmed: true, createdBy: "tester" });
    expect(a.value).toMatchObject({ status: "saved", projectId: p.id, collectionId: p.collectionId });
  });

  it("createProject is the same transition for a user; duplicates are refused", () => {
    const { state, ctx } = setup();
    const a = createProject(state, ctx, { name: "Alpha", repo: "git@github.com:me/alpha.git", workspace: "ws_1", actor: USER });
    expect(a.value.sources).toEqual([
      { kind: "repo", ref: "github.com/me/alpha" },
      { kind: "workspace", ref: "ws_1" },
    ]);
    expect(code(() => createProject(a.state, ctx, { name: " ALPHA", actor: USER }))).toBe("duplicate_project");
  });
});

describe("precedence", () => {
  const withProjects = () => {
    const { state, ctx } = setup();
    const a = createProject(state, ctx, { name: "Alpha", actor: USER });
    const b = createProject(a.state, ctx, { name: "Beta", actor: USER });
    return { ctx, state: b.state, alpha: a.value, beta: b.value };
  };

  it("explicit projectId wins, null means no project, unknown / reserved ids are errors", () => {
    const { ctx, state, alpha } = withProjects();
    const m = createMemory(state, ctx, { title: "Beta: x", projectId: alpha.id, actor: USER });
    expect(m.value.projectId).toBe(alpha.id);
    expect(m.value.collectionId).toBe(alpha.collectionId);
    const none = createMemory(state, ctx, { title: "Beta: x", projectId: null, actor: USER });
    expect(none.value.projectId).toBeNull();
    expect(code(() => createMemory(state, ctx, { title: "x", projectId: "prj_nope", actor: USER }))).toBe("project_not_found");
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      expect(code(() => createMemory(state, ctx, { title: "x", projectId: bad, actor: USER }))).toBe("invalid_input");
    }
    expect(code(() => createMemory(state, ctx, { title: "x", projectId: 5 as never, actor: USER }))).toBe("invalid_input");
  });

  it("projectId and project are mutually exclusive (even projectId null); collection + project is allowed", () => {
    const { ctx, state, alpha, beta } = withProjects();
    expect(code(() => createMemory(state, ctx, { title: "x", projectId: alpha.id, project: { name: "Beta" }, actor: USER }))).toBe("invalid_input");
    expect(code(() => createMemory(state, ctx, { title: "x", projectId: null, project: { name: "Beta" }, actor: USER }))).toBe("invalid_input");
    const made = createMemory(state, ctx, { title: "x", actor: USER });
    const id = made.value.id;
    expect(code(() => updateMemory(made.state, ctx, { id, patch: { projectId: null, project: { name: "Beta" } }, actor: USER }))).toBe("invalid_input");
    // explicit collection wins for the folder, the project still links
    const m = createMemory(state, ctx, { title: "x", collectionId: alpha.collectionId, project: { name: "Beta" }, actor: USER });
    expect(m.value.projectId).toBe(beta.id);
    expect(m.value.collectionId).toBe(alpha.collectionId);
  });

  it("explicit project beats the collection-linked project; the collection-linked one beats the title prefix", () => {
    const { ctx, state, alpha, beta } = withProjects();
    const explicit = createMemory(state, ctx, { title: "x", collectionId: alpha.collectionId, project: { name: "Beta" }, actor: USER });
    expect(explicit.value.projectId).toBe(beta.id);
    const linked = createMemory(state, ctx, { title: "Beta: x", collection: "Alpha", actor: USER });
    expect(linked.value.projectId).toBe(alpha.id);
    expect(linked.value.collectionId).toBe(alpha.collectionId);
  });

  it("an unlinked explicit collection still lets the title prefix pick the project", () => {
    const { ctx, state, beta } = withProjects();
    const misc = createCollection(state, ctx, { name: "Misc" });
    const m = createMemory(misc.state, ctx, { title: "Beta: x", collectionId: misc.value.id, actor: USER });
    expect(m.value.projectId).toBe(beta.id);
    expect(m.value.collectionId).toBe(misc.value.id);
  });

  it("title prefix (key or alias) resolves an EXISTING project, never creates one", () => {
    const { ctx, state, alpha, beta } = withProjects();
    const r = renameProject(state, { id: alpha.id, name: "Alpha Prime", actor: USER });
    const viaKey = createMemory(r.state, ctx, { title: "beta: thing", actor: AGENT });
    expect(viaKey.value.projectId).toBe(beta.id);
    expect(viaKey.value.collectionId).toBe(beta.collectionId);
    const viaAlias = createMemory(r.state, ctx, { title: "Alpha: thing", actor: USER });
    expect(viaAlias.value.projectId).toBe(alpha.id);
    const unknown = createMemory(r.state, ctx, { title: "Gamma: thing", actor: AGENT });
    expect(unknown.value.projectId).toBeNull();
    expect(Object.keys(unknown.state.projects)).toHaveLength(2);
    const url = createMemory(r.state, ctx, { title: "Beta://not-a-prefix", actor: USER });
    expect(url.value.projectId).toBeNull();
  });

  it("imports and system writes get no project / folder default, but an explicit project works", () => {
    const { ctx, state } = withProjects();
    const imp = createMemory(state, ctx, { title: "Beta: x", provenance: { origin: "import", createdBy: "i" }, actor: USER });
    expect(imp.value.projectId).toBeNull();
    expect(imp.value.collectionId).toBeNull();
    const exp = createMemory(state, ctx, { title: "x", project: { name: "Beta" }, provenance: { origin: "import", createdBy: "i" }, actor: USER });
    expect(exp.value.projectId).not.toBeNull();
  });

  it("back-compat: without projects everything behaves as before (prefix collection, Unsorted)", () => {
    const { ctx, state } = setup();
    const col = createCollection(state, ctx, { name: "Foo" });
    const a = createMemory(col.state, ctx, { title: "Foo: x", actor: USER });
    expect(a.value).toMatchObject({ projectId: null, collectionId: col.value.id });
    const b = createMemory(a.state, ctx, { title: "Other", actor: USER });
    expect(b.state.collections[b.value.collectionId as string].name).toBe("Unsorted");
    expect(b.state.projects).toEqual({});
  });

  it("a resolved project without a folder (collection cap) goes to Unsorted/none, not to a same-named collection", () => {
    const { ctx, state } = setup();
    let s = state;
    for (let i = 0; i < 200; i++) s = createCollection(s, ctx, { name: `c${i}` }).state;
    const m = createMemory(s, ctx, { title: "x", project: { name: "Full" }, actor: USER });
    const p = projectsOf(m.state)[0];
    expect(p.collectionId).toBeNull();
    expect(m.value.collectionId).toBeNull();
    expect(m.value.projectId).toBe(p.id);
    expect(Object.keys(m.state.collections)).toHaveLength(200);
  });

  it("adopts an existing same-named, unlinked collection instead of creating a duplicate", () => {
    const { ctx, state } = setup();
    const col = createCollection(state, ctx, { name: "Acme" });
    const m = createMemory(col.state, ctx, { title: "x", project: { name: "acme" }, actor: USER });
    expect(Object.keys(m.state.collections)).toEqual([col.value.id]);
    expect(m.state.collections[col.value.id].projectId).toBe(m.value.projectId);
    expect(m.value.collectionId).toBe(col.value.id);
  });
});

describe("duplicate prevention", () => {
  it("case / whitespace variants of a name are one project", () => {
    const { ctx } = setup();
    let { state } = setup();
    for (const name of ["Acme", " acme ", "ACME", "a\u0063me"]) {
      state = createMemory(state, ctx, { title: "x", project: { name }, actor: AGENT }).state;
    }
    expect(projectsOf(state)).toHaveLength(1);
  });

  it("every repo spelling resolves to one project, whatever the name", () => {
    const { ctx } = setup();
    let { state } = setup();
    const spellings = [
      "https://github.com/Acme/Portal.git",
      "git@github.com:acme/portal",
      "ssh://git@github.com:22/acme/portal.git",
      "https://tok:en@GITHUB.com:443/acme/portal/",
    ];
    const ids = new Set<string | null>();
    spellings.forEach((repo, i) => {
      const r = createMemory(state, ctx, { title: "x", project: { name: i === 0 ? "Portal" : `Other ${i}`, repo }, actor: AGENT });
      state = r.state;
      ids.add(r.value.projectId);
    });
    expect(ids.size).toBe(1);
    expect(projectsOf(state)).toHaveLength(1);
    expect(projectsOf(state)[0].sources).toEqual([{ kind: "repo", ref: "github.com/acme/portal" }]);
  });

  it("the same workspace id is one project", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "x", project: { name: "One", workspace: "ws-abc_1" }, actor: AGENT });
    const b = createMemory(a.state, ctx, { title: "y", project: { name: "Renamed on disk", workspace: "ws-abc_1" }, actor: AGENT });
    expect(b.value.projectId).toBe(a.value.projectId);
    expect(projectsOf(b.state)).toHaveLength(1);
  });

  it("an alias (old name after a rename) resolves; the id never changes", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Old Name", actor: USER });
    const r = renameProject(a.state, { id: a.value.id, name: "New Name", actor: USER });
    expect(r.value).toMatchObject({ id: a.value.id, key: "new name", name: "New Name", aliases: ["old name"], collectionId: a.value.collectionId });
    const m = createMemory(r.state, ctx, { title: "x", project: { name: "OLD name" }, actor: AGENT });
    expect(m.value.projectId).toBe(a.value.id);
    expect(projectsOf(m.state)).toHaveLength(1);
    // a name that is another project's alias or key cannot be taken
    const b = createProject(r.state, ctx, { name: "Beta", actor: USER });
    expect(code(() => renameProject(b.state, { id: b.value.id, name: "old name", actor: USER }))).toBe("duplicate_project");
    expect(code(() => createProject(b.state, ctx, { name: "Old Name", actor: USER }))).toBe("duplicate_project");
    expect(code(() => renameProject(b.state, { id: b.value.id, name: "constructor", actor: USER }))).toBe("invalid_input");
  });

  it("same name with a different repo makes a separate project; the same repo again reuses it", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "x", project: { name: "App", repo: "github.com:me/app-one" }, actor: AGENT });
    const b = createMemory(a.state, ctx, { title: "x", project: { name: "App", repo: "github.com:me/app-two" }, actor: AGENT });
    expect(b.value.projectId).not.toBe(a.value.projectId);
    const [p1, p2] = [a.value.projectId, b.value.projectId].map((id) => b.state.projects[id as string]);
    expect(p1.key).toBe("app");
    expect(p2.key).toBe("app (2)");
    const c = createMemory(b.state, ctx, { title: "x", project: { name: "App", repo: "https://github.com/me/app-two.git" }, actor: AGENT });
    expect(c.value.projectId).toBe(p2.id);
    const d = createMemory(c.state, ctx, { title: "x", project: { name: "App", repo: "github.com:me/app-three" }, actor: AGENT });
    expect(d.state.projects[d.value.projectId as string].key).toBe("app (3)");
    expect(projectsOf(d.state)).toHaveLength(3);
  });

  it("the repo is optional on either side: name-only reuses a repo project, and a repo reuses a name-only project", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "x", project: { name: "App", repo: "github.com:me/app" }, actor: AGENT });
    const b = createMemory(a.state, ctx, { title: "x", project: { name: "app" }, actor: AGENT });
    expect(b.value.projectId).toBe(a.value.projectId);
    const c = createMemory(b.state, ctx, { title: "x", project: { name: "Lib" }, actor: AGENT });
    const d = createMemory(c.state, ctx, { title: "x", project: { name: "lib", repo: "github.com:me/lib" }, actor: AGENT });
    expect(d.value.projectId).toBe(c.value.projectId);
    expect(d.state.projects[c.value.projectId as string].sources).toEqual([]); // not repointed / extended
  });

  it("a long name leaves room for the numeric suffix", () => {
    const { ctx, state } = setup();
    const name = "n".repeat(100);
    const a = createMemory(state, ctx, { title: "x", project: { name, repo: "github.com:me/a" }, actor: AGENT });
    const b = createMemory(a.state, ctx, { title: "x", project: { name, repo: "github.com:me/b" }, actor: AGENT });
    expect(b.state.projects[b.value.projectId as string].name).toHaveLength(100);
    expect(b.state.projects[b.value.projectId as string].name.endsWith(" (2)")).toBe(true);
  });
});

describe("agents vs users, caps and hostile input", () => {
  it("caps unconfirmed agent projects (too_large, never silent); approving frees room", () => {
    const { ctx, state } = setup();
    let s = state;
    let first: string | undefined;
    for (let i = 0; i < 25; i++) {
      const r = createMemory(s, ctx, { title: `m${i}`, project: { name: `Auto ${i}` }, actor: AGENT });
      s = r.state;
      first ??= r.value.revisionId;
    }
    expect(projectsOf(s)).toHaveLength(25);
    expect(code(() => createMemory(s, ctx, { title: "x", project: { name: "One too many" }, actor: AGENT }))).toBe("too_large");
    // reusing an existing one is fine
    expect(createMemory(s, ctx, { title: "x", project: { name: "Auto 3" }, actor: AGENT }).value.projectId).not.toBeNull();
    // a user is not subject to the agent cap
    expect(createMemory(s, ctx, { title: "x", project: { name: "User one" }, actor: USER }).value.projectId).not.toBeNull();
    const approved = approveRevision(s, ctx, { revisionId: first as string, actor: USER }).state;
    expect(code(() => createMemory(approved, ctx, { title: "x", project: { name: "Now fits" }, actor: AGENT }))).toBeUndefined();
  });

  it("caps the total number of projects", () => {
    const { ctx, state } = setup();
    let s = state;
    for (let i = 0; i < 200; i++) s = createProject(s, ctx, { name: `P${i}`, actor: USER }).state;
    expect(code(() => createProject(s, ctx, { name: "P200", actor: USER }))).toBe("too_large");
    expect(code(() => createMemory(s, ctx, { title: "x", project: { name: "P200" }, actor: USER }))).toBe("too_large");
    expect(createMemory(s, ctx, { title: "x", project: { name: "p7" }, actor: USER }).value.projectId).not.toBeNull();
  });

  it("rejects reserved names, control characters, long names / repos, bad workspace refs and unknown keys", () => {
    const { ctx, state } = setup();
    const save = (project: unknown) => code(() => createMemory(state, ctx, { title: "x", project: project as never, actor: AGENT }));
    for (const name of ["Unsorted", " unsorted ", "constructor", "__proto__", "Prototype"]) expect(save({ name })).toBe("invalid_input");
    expect(save({ name: "a\u0000b" })).toBe("invalid_input");
    expect(save({ name: "a\nb" })).toBe("invalid_input");
    expect(save({ name: "a\u007fb" })).toBe("invalid_input");
    expect(save({ name: "   " })).toBe("invalid_input");
    expect(save({ name: 5 })).toBe("invalid_input");
    expect(save({ name: "n".repeat(101) })).toBe("too_large");
    expect(save({ name: "ok", repo: `https://github.com/acme/${"r".repeat(200)}` })).toBe("invalid_input");
    expect(save({ name: "ok", repo: "/Users/me/code/portal" })).toBe("invalid_input");
    expect(save({ name: "ok", repo: 5 })).toBe("invalid_input");
    expect(save({ name: "ok", workspace: "/Users/me/code" })).toBe("invalid_input");
    expect(save({ name: "ok", workspace: "a".repeat(65) })).toBe("invalid_input");
    expect(save({ name: "ok", workspace: "has space" })).toBe("invalid_input");
    expect(save({ name: "ok", extra: 1 })).toBe("invalid_input");
    expect(save(JSON.parse('{"name":"ok","__proto__":{"x":1}}'))).toBe("invalid_input");
    expect(save(null)).toBe("invalid_input");
    expect(save("Acme")).toBe("invalid_input");
    expect(save(["Acme"])).toBe("invalid_input");
  });

  it("agents cannot rename, confirm or repoint existing projects", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Acme", repo: "github.com:me/acme", actor: AGENT });
    expect(code(() => renameProject(a.state, { id: a.value.id, name: "Other", actor: AGENT }))).toBe("forbidden");
    expect(code(() => confirmProject(a.state, { id: a.value.id, actor: AGENT }))).toBe("forbidden");
    // another repo under the same name does not touch the existing project, it gets its own
    const m = createMemory(a.state, ctx, { title: "x", project: { name: "Acme", repo: "github.com:evil/acme" }, actor: AGENT });
    expect(m.state.projects[a.value.id]).toEqual(a.state.projects[a.value.id]);
    expect(m.value.projectId).not.toBe(a.value.id);
    // an agent cannot move a memory into an unknown project id
    expect(code(() => updateMemory(m.state, ctx, { id: m.value.id, patch: { projectId: "prj_missing" }, actor: AGENT }))).toBe("project_not_found");
  });

  it("resolveProject never mutates its input and returns projectCreated", () => {
    const { ctx, state } = setup();
    const frozen = JSON.stringify(state);
    const r = resolveProject(state, ctx, { project: { name: "Acme" }, title: "t", actor: AGENT });
    expect(JSON.stringify(state)).toBe(frozen);
    expect(r.projectCreated).toBe(true);
    const again = resolveProject(r.state, ctx, { project: { name: "Acme" }, title: "t", actor: AGENT });
    expect(again).toMatchObject({ projectId: r.projectId, projectCreated: false });
    expect(resolveProject(state, ctx, { title: "t", actor: AGENT })).toMatchObject({ projectId: null, projectCreated: false });
  });

  it("stores only the normalised repo: no credentials, no paths", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, {
      title: "x",
      project: { name: "Secret", repo: "https://user:hunter2@github.com:8443/acme/portal.git", workspace: "ws_9f3a" },
      actor: AGENT,
    });
    const json = JSON.stringify(m.state);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("user:");
    expect(json).not.toContain("8443");
    expect(json).not.toContain(".git");
    expect(json).not.toContain("/Users/");
    expect(projectsOf(m.state)[0].sources).toEqual([
      { kind: "repo", ref: "github.com/acme/portal" },
      { kind: "workspace", ref: "ws_9f3a" },
    ]);
  });
});

describe("pending semantics", () => {
  it("an agent save stays out of the project / collection until approved; approval confirms the project", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const p = projectsOf(m.state)[0];
    expect(p.confirmed).toBe(false);
    expect(listMemories(m.state).filter((x) => x.projectId === p.id)).toEqual([]);
    expect(pendingChanges(m.state)).toHaveLength(1);
    const ok = approveRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER });
    expect(ok.state.projects[p.id]).toMatchObject({ confirmed: true, autoCreated: true });
    expect(listMemories(ok.state).filter((x) => x.projectId === p.id)).toHaveLength(1);
    // idempotent: another approval keeps it confirmed and changes nothing else
    const more = createMemory(ok.state, ctx, { title: "More", project: { name: "Acme" }, actor: AGENT });
    const ok2 = approveRevision(more.state, ctx, { revisionId: more.value.revisionId, actor: USER });
    expect(ok2.state.projects[p.id]).toEqual(ok.state.projects[p.id]);
  });

  // Behaviour change (F2): rejecting the LAST proposal that names an unconfirmed agent project now prunes the
  // project and its empty folder; while another proposal still names it, both stay (next test).
  it("rejecting the last proposal prunes the unconfirmed project and its empty folder; the memory stays unsaved", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const p = projectsOf(m.state)[0];
    const r = rejectRevision(m.state, ctx, { revisionId: m.value.revisionId, actor: USER });
    expect(r.state.projects[p.id]).toBeUndefined();
    expect(listMemories(r.state)).toEqual([]);
    expect(r.state.collections[p.collectionId as string]).toBeUndefined();
    expect(validateWorkspaceState(r.state).ok).toBe(true);
  });

  it("a user saving a memory into the project, or confirming it, acknowledges it", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const p = projectsOf(m.state)[0];
    const u = createMemory(m.state, ctx, { title: "Mine", projectId: p.id, actor: USER });
    expect(u.state.projects[p.id].confirmed).toBe(true);
    const c = confirmProject(m.state, { id: p.id, actor: USER });
    expect(c.value.confirmed).toBe(true);
    expect(confirmProject(c.state, { id: p.id, actor: USER }).state).toBe(c.state);
    expect(code(() => confirmProject(m.state, { id: "prj_x", actor: USER }))).toBe("project_not_found");
  });

  it("an agent proposal does not confirm; deleting the default collection keeps the project without a folder", () => {
    const { ctx, state } = setup();
    const m = createMemory(state, ctx, { title: "Plan", project: { name: "Acme" }, actor: AGENT });
    const p = projectsOf(m.state)[0];
    const again = createMemory(m.state, ctx, { title: "Two", project: { name: "Acme" }, actor: AGENT });
    expect(again.state.projects[p.id].confirmed).toBe(false);
    // Reject only the first proposal: "Two" still names the project, so project and folder stay.
    const rej1 = rejectRevision(again.state, ctx, { revisionId: m.value.revisionId, actor: USER }).state;
    expect(rej1.projects[p.id]).toBeDefined();
    // Confirmed by the user, the project survives the last rejection (only unconfirmed ones are pruned).
    const kept = confirmProject(rej1, { id: p.id, actor: USER }).state;
    const rej = rejectRevision(kept, ctx, { revisionId: again.value.revisionId, actor: USER }).state;
    expect(rej.projects[p.id]).toBeDefined();
    const del = deleteCollection(rej, { id: p.collectionId as string }).state;
    expect(del.projects[p.id].collectionId).toBeNull();
    expect(validateWorkspaceState(del).ok).toBe(true);
  });
});

describe("update and rollback", () => {
  it("update never re-defaults the project or collection", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "Plain", actor: USER });
    const b = createProject(a.state, ctx, { name: "Plain", actor: USER });
    const u = updateMemory(b.state, ctx, { id: a.value.id, patch: { title: "Plain: renamed", content: "x" }, actor: USER });
    expect(u.value.projectId).toBeNull();
    expect(u.value.collectionId).toBe(a.value.collectionId);
  });

  it("an explicit project on update links it and brings the memory to the project's folder; explicit collection wins", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "Plain", actor: USER });
    const u = updateMemory(a.state, ctx, { id: a.value.id, patch: { project: { name: "Acme" } }, actor: USER });
    const p = projectsOf(u.state)[0];
    expect(u.value).toMatchObject({ projectId: p.id, collectionId: p.collectionId });
    const keep = updateMemory(a.state, ctx, { id: a.value.id, patch: { project: { name: "Acme" }, collectionId: null }, actor: USER });
    expect(keep.value.collectionId).toBeNull();
    expect(keep.value.projectId).not.toBeNull();
    const off = updateMemory(u.state, ctx, { id: a.value.id, patch: { projectId: null }, actor: USER });
    expect(off.value.projectId).toBeNull();
    expect(off.value.collectionId).toBe(p.collectionId); // folder untouched
    // naming only a collection leaves the project alone
    const col = createCollection(u.state, ctx, { name: "Else" });
    const mv = updateMemory(col.state, ctx, { id: a.value.id, patch: { collectionId: col.value.id }, actor: USER });
    expect(mv.value.projectId).toBe(p.id);
  });

  it("an agent update with a new project creates it unconfirmed, as a pending change", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "Plain", actor: USER });
    const u = updateMemory(a.state, ctx, { id: a.value.id, patch: { project: { name: "Acme" } }, actor: AGENT });
    const p = projectsOf(u.state)[0];
    expect(p.confirmed).toBe(false);
    expect(u.value.hasPending).toBe(true);
    expect(getMemory(u.state, a.value.id)?.projectId).toBeNull(); // the saved view is unchanged
    expect(pendingChanges(u.state)[0].note).toBe("Edited collection, project");
  });

  it("rollback restores the old projectId only while that project exists", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "T", project: { name: "Acme" }, actor: USER });
    const p = projectsOf(a.state)[0];
    const first = a.value.revisionId;
    const edit = updateMemory(a.state, ctx, { id: a.value.id, patch: { projectId: null }, actor: USER });
    const back = rollbackMemory(edit.state, ctx, { memoryId: a.value.id, toRevisionId: first, actor: USER });
    expect(back.value.projectId).toBe(p.id);
    const gone: WorkspaceState = { ...edit.state, projects: {} };
    const back2 = rollbackMemory(gone, ctx, { memoryId: a.value.id, toRevisionId: first, actor: USER });
    expect(back2.value.projectId).toBeNull();
  });

  it("projectId is a revisioned field: dangling ids in history validate", () => {
    const { ctx, state } = setup();
    const a = createMemory(state, ctx, { title: "T", project: { name: "Acme" }, actor: USER });
    const gone: WorkspaceState = { ...a.state, projects: {} };
    expect(validateWorkspaceState(gone).ok).toBe(true);
  });
});

describe("projectOfMemory (read-time derivation)", () => {
  it("prefers the snapshot's project, then a title-prefix / exact-title existing project, else null", () => {
    const { ctx, state } = setup();
    const a = createProject(state, ctx, { name: "Alpha", actor: USER });
    const b = createProject(a.state, ctx, { name: "Beta", actor: USER });
    const s = b.state;
    expect(projectOfMemory(s, { title: "x", projectId: b.value.id })?.id).toBe(b.value.id);
    expect(projectOfMemory(s, { title: "Alpha: x", projectId: b.value.id })?.id).toBe(b.value.id);
    expect(projectOfMemory(s, { title: "alpha:  x", projectId: null })?.id).toBe(a.value.id);
    expect(projectOfMemory(s, { title: "Alpha", projectId: null })?.id).toBe(a.value.id);
    expect(projectOfMemory(s, { title: "Alpha: x", projectId: "prj_dangling" })?.id).toBe(a.value.id);
    expect(projectOfMemory(s, { title: "Gamma: x", projectId: null })).toBeNull();
    expect(projectOfMemory(s, { title: "Alpha://x", projectId: null })).toBeNull();
    expect(projectOfMemory(s, { title: "constructor", projectId: "__proto__" })).toBeNull();
  });
});
