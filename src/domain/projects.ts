import { DomainError, type DomainContext } from "./context";
import { assertNotBothCollectionFields, resolveCollection } from "./collectionDefault";
import { assertActor, LIMITS } from "./limits";
import { listMemories } from "./queries";
import { assertCollectionRoom, createCollection } from "./relations";
import { normalizeTitle, parseTitlePrefix } from "./titlePrefix";
import type {
  Actor,
  Collection,
  MemorySnapshot,
  Mutation,
  Origin,
  Project,
  ProjectSource,
  WorkspaceState,
} from "./types";
import { assertSafeId, freshId, isPlainObject, safeGet } from "./util";

const invalid = (msg: string) => new DomainError("invalid_input", msg);
const tooLarge = (msg: string) => new DomainError("too_large", msg);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Names that can never be a project name (case-insensitive, after whitespace normalisation). */
export const RESERVED_PROJECT_NAMES: ReadonlySet<string> = new Set(["unsorted", "constructor", "__proto__", "prototype"]);

// ---- sha256 (sync, dependency free: the domain runs in the browser and in Node) ---------------------------------

const frac32 = (x: number): number => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const PRIMES: number[] = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every((p) => n % p !== 0)) PRIMES.push(n);
const K = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));

/** Lowercase hex sha256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const total = Math.ceil((data.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(total - 4, (data.length * 8) >>> 0);
  const h = [...H0];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + add[i]) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Deterministic id of a project derived from its key (migration): "prj_" + first 16 hex chars of sha256(key). */
export const projectIdForKey = (key: string): string => `prj_${sha256Hex(key).slice(0, 16)}`;

// ---- repo / workspace normalisation -----------------------------------------------------------------------------

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const SEGMENT = /^[a-z0-9._~-]+$/;

/**
 * Canonical "host/owner/repo" (lowercase) of a git remote, or null when `input` is not an http(s), ssh:// or
 * scp-style (git@host:owner/repo) remote, is longer than 200 characters, or is otherwise unusable. Strips the
 * scheme, userinfo / credentials, port, query / fragment, a trailing "/" and ".git". Never returns credentials.
 */
export function normalizeRepoUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > LIMITS.repoUrl || CONTROL_CHARS.test(raw) || /\s/.test(raw)) return null;
  let host: string;
  let path: string;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    if (proto !== "http" && proto !== "https" && proto !== "ssh") return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    host = url.hostname.toLowerCase();
    path = url.pathname;
  } else {
    const m = /^(?:[^@:/\\?#]+@)?([^@:/\\?#]+):([^\\?#]+)$/.exec(raw);
    if (!m || m[2].startsWith("/")) return null;
    host = m[1].toLowerCase();
    path = m[2];
    if (host.length < 2) return null; // "C:/dir" is a drive letter, not a host
  }
  if (!HOST.test(host)) return null;
  let p = path.replace(/\/+$/, "");
  if (p.toLowerCase().endsWith(".git")) p = p.slice(0, -4);
  const segments = p.replace(/^\/+/, "").toLowerCase().split("/");
  if (segments.length < 2) return null;
  for (const s of segments) if (!s || s === "." || s === ".." || s.length > 100 || !SEGMENT.test(s)) return null;
  return `${host}/${segments.join("/")}`;
}

const WORKSPACE_REF = /^[A-Za-z0-9_-]{1,64}$/;

/** A workspace ref is an opaque client-computed id (never a path). */
export const isWorkspaceRef = (v: unknown): v is string => typeof v === "string" && WORKSPACE_REF.test(v);

// ---- input -------------------------------------------------------------------------------------------------------

/** What a client supplies to name (and possibly create) a project. Unknown keys are rejected. */
export interface ProjectInput {
  name: string;
  /** A git remote in any common spelling; stored normalised ("host/owner/repo"). */
  repo?: string;
  /** Opaque client-computed workspace id (<= 64 chars of [A-Za-z0-9_-]); never a path. */
  workspace?: string;
}

interface CheckedInput {
  name: string;
  key: string;
  repo: string | null;
  workspace: string | null;
}

/** A project name: 1-100 chars after trimming, no control characters, not a reserved word. */
export function checkProjectName(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("project name must be a string");
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw invalid("project name must not be empty");
  if (name.length > LIMITS.projectName) throw tooLarge(`Project name is too long (max ${LIMITS.projectName} characters)`);
  if (CONTROL_CHARS.test(raw)) throw invalid("project name must not contain control characters");
  if (RESERVED_PROJECT_NAMES.has(normalizeTitle(name))) throw invalid(`project name is reserved: ${name}`);
  return name;
}

function checkProjectInput(raw: unknown): CheckedInput {
  if (!isPlainObject(raw)) throw invalid("project must be an object");
  for (const k of Object.keys(raw)) {
    if (k !== "name" && k !== "repo" && k !== "workspace") throw invalid(`project has an unknown field: ${k}`);
  }
  const name = checkProjectName(raw.name);
  let repo: string | null = null;
  if (raw.repo !== undefined) {
    repo = normalizeRepoUrl(raw.repo);
    if (repo === null) throw invalid("project.repo must be an http(s), ssh or scp-style git remote (max 200 characters)");
  }
  let workspace: string | null = null;
  if (raw.workspace !== undefined) {
    if (!isWorkspaceRef(raw.workspace)) {
      throw invalid("project.workspace must be an opaque id of 1-64 letters, digits, '_' or '-' (never a path)");
    }
    workspace = raw.workspace;
  }
  return { name, key: normalizeTitle(name), repo, workspace };
}

/** `projectId` and `project` are alternatives: giving both, even `projectId: null`, is ambiguous. */
export function assertNotBothProjectFields(projectId: unknown, project: unknown): void {
  if (projectId !== undefined && project !== undefined) throw invalid("give either project or projectId, not both");
}

// ---- lookups -----------------------------------------------------------------------------------------------------

const projectList = (state: WorkspaceState): Project[] => Object.values(state.projects);

/** Oldest first (createdAt, then id): the deterministic tie-break whenever several projects match. */
const oldestFirst = (a: Project, b: Project): number =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1;

export function getProject(state: WorkspaceState, id: string | null | undefined): Project | undefined {
  return safeGet(state.projects, id);
}

/** The project whose key or alias equals `key` (a normalised key); the oldest on a (corrupt) tie. */
export function findProjectByKey(state: WorkspaceState, key: string): Project | undefined {
  return projectList(state)
    .filter((p) => p.key === key || p.aliases.includes(key))
    .sort(oldestFirst)[0];
}

const hasSource = (p: Project, kind: ProjectSource["kind"], ref: string): boolean =>
  p.sources.some((s) => s.kind === kind && s.ref === ref);

const hasRepo = (p: Project): boolean => p.sources.some((s) => s.kind === "repo");

/** Title-prefix project of a title: `<key>: ...` (not a URL) or a title that is exactly a key / alias. */
function projectByTitle(state: WorkspaceState, title: string): Project | undefined {
  const prefix = parseTitlePrefix(title);
  if (prefix !== null && !title.slice(title.indexOf(":") + 1).startsWith("//")) {
    const hit = findProjectByKey(state, normalizeTitle(prefix));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The project a memory belongs to, derived at READ time: its snapshot's projectId when that project exists,
 * else the existing project its title points at (`<key>: ...` prefix, or a title that is exactly the key), else null.
 * Saved history is never rewritten to record this.
 */
export function projectOfMemory(
  state: WorkspaceState,
  memory: Pick<MemorySnapshot, "title"> & { projectId?: string | null },
): Project | null {
  const own = getProject(state, memory.projectId);
  if (own) return own;
  const byPrefix = projectByTitle(state, memory.title);
  if (byPrefix) return byPrefix;
  return findProjectByKey(state, normalizeTitle(memory.title)) ?? null;
}

// ---- creation ----------------------------------------------------------------------------------------------------

/** Links `project` to its default folder: adopts the oldest unlinked collection of the same name, else creates one. */
function attachDefaultCollection(state: WorkspaceState, ctx: DomainContext, project: Project): { state: WorkspaceState; project: Project } {
  const adoptable = Object.values(state.collections)
    .filter((c) => normalizeTitle(c.name) === project.key && (c.projectId ?? null) === null)
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1))[0];
  let col: Collection | undefined = adoptable;
  let next = state;
  if (!col) {
    try {
      assertCollectionRoom(state, project.name);
    } catch (e) {
      if (e instanceof DomainError && e.code === "too_large") return { state, project }; // cap reached: no folder
      throw e;
    }
    const created = createCollection(state, ctx, { name: project.name });
    next = created.state;
    col = created.value;
  }
  const linked = { ...col, projectId: project.id };
  return {
    state: { ...next, collections: { ...next.collections, [col.id]: linked } },
    project: { ...project, collectionId: col.id },
  };
}

function nextFreeName(state: WorkspaceState, name: string): string {
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, LIMITS.projectName - suffix.length).trimEnd()}${suffix}`;
    if (!findProjectByKey(state, normalizeTitle(candidate))) return candidate;
  }
  throw new DomainError("duplicate_project", `Could not find a free project name for: ${name}`);
}

function insertProject(state: WorkspaceState, ctx: DomainContext, c: CheckedInput, actor: Actor): { state: WorkspaceState; project: Project } {
  if (findProjectByKey(state, c.key)) throw new DomainError("duplicate_project", `Project already exists: ${c.name}`);
  const all = projectList(state);
  if (all.length >= LIMITS.maxProjects) throw tooLarge(`Too many projects (max ${LIMITS.maxProjects})`);
  const isAgent = actor.kind === "agent";
  if (isAgent && all.filter((p) => p.autoCreated && !p.confirmed).length >= LIMITS.maxAutoProjects) {
    throw tooLarge(`Too many unconfirmed projects created by agents (max ${LIMITS.maxAutoProjects}); a user must review them first`);
  }
  const sources: ProjectSource[] = [];
  if (c.repo !== null) sources.push({ kind: "repo", ref: c.repo });
  if (c.workspace !== null) sources.push({ kind: "workspace", ref: c.workspace });
  const project: Project = {
    id: freshId(ctx, "prj", (x) => Object.hasOwn(state.projects, x)),
    key: c.key,
    name: c.name,
    aliases: [],
    sources,
    collectionId: null,
    createdAt: ctx.now(),
    createdBy: actor.name,
    autoCreated: isAgent,
    confirmed: !isAgent,
  };
  assertSafeId(project.id, "project");
  const withCollection = attachDefaultCollection(state, ctx, project);
  return {
    state: { ...withCollection.state, projects: { ...withCollection.state.projects, [project.id]: withCollection.project } },
    project: withCollection.project,
  };
}

/**
 * Creates a project and its default collection in one transition (no collection when the collection cap is
 * reached). A user's project is confirmed at once; an agent's is `autoCreated` + unconfirmed and counts against
 * LIMITS.maxAutoProjects. Throws "duplicate_project" when the name is a key / alias already, "too_large" over a cap.
 */
export function createProject(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { name: string; repo?: string; workspace?: string; actor: Actor },
): Mutation<Project> {
  assertActor(args.actor);
  const checked = checkProjectInput({
    name: args.name,
    ...(args.repo !== undefined && { repo: args.repo }),
    ...(args.workspace !== undefined && { workspace: args.workspace }),
  });
  const r = insertProject(state, ctx, checked, args.actor);
  return { state: r.state, value: r.project };
}

// ---- user-only maintenance ---------------------------------------------------------------------------------------

function requireUser(actor: Actor): void {
  assertActor(actor);
  if (actor.kind !== "user") throw new DomainError("forbidden", "Only a user can change an existing project");
}

/** User only, idempotent: marks a project as reviewed (an agent-created project stops counting against the cap). */
export function confirmProject(state: WorkspaceState, args: { id: string; actor: Actor }): Mutation<Project> {
  requireUser(args.actor);
  const p = getProject(state, args.id);
  if (!p) throw new DomainError("project_not_found", `Project not found: ${args.id}`);
  if (p.confirmed) return { state, value: p };
  const next = { ...p, confirmed: true };
  return { state: { ...state, projects: { ...state.projects, [p.id]: next } }, value: next };
}

/**
 * User only. Renames a project: id and collection link stay, the old key becomes an alias (so lookups by the old
 * name still resolve). The new name must not collide with another project's key or alias.
 */
export function renameProject(state: WorkspaceState, args: { id: string; name: string; actor: Actor }): Mutation<Project> {
  requireUser(args.actor);
  const p = getProject(state, args.id);
  if (!p) throw new DomainError("project_not_found", `Project not found: ${args.id}`);
  const name = checkProjectName(args.name);
  const key = normalizeTitle(name);
  const clash = findProjectByKey(state, key);
  if (clash && clash.id !== p.id) throw new DomainError("duplicate_project", `Project already exists: ${name}`);
  const aliases = [...p.aliases.filter((a) => a !== key)];
  if (key !== p.key && !aliases.includes(p.key)) aliases.push(p.key);
  if (aliases.length > LIMITS.maxProjectAliases) throw tooLarge(`Too many project aliases (max ${LIMITS.maxProjectAliases})`);
  const next: Project = { ...p, name, key, aliases, confirmed: true };
  return { state: { ...state, projects: { ...state.projects, [p.id]: next } }, value: next };
}

/** Confirms `projectId` (if it exists and is unconfirmed); returns the same state otherwise. Used when a user saves / approves. */
export function confirmProjectIn(state: WorkspaceState, projectId: string | null): WorkspaceState {
  const p = getProject(state, projectId);
  if (!p || p.confirmed) return state;
  return { ...state, projects: { ...state.projects, [p.id]: { ...p, confirmed: true } } };
}

// ---- resolution --------------------------------------------------------------------------------------------------

export interface ResolveProjectInput {
  /** undefined = apply the rule; null = no project (respected); string = that project id. */
  projectId?: string | null;
  /** Name (and optional repo / workspace) of a project to reuse or create. Mutually exclusive with projectId. */
  project?: unknown;
  /** Id of an explicitly named collection: its linked project is used when neither projectId nor project is given. */
  collectionId?: string | null;
  title: string;
  actor: Actor;
  origin?: Origin;
  /** False for updates: only an explicit projectId / project is honoured, nothing is ever re-defaulted. */
  applyDefault?: boolean;
  migrating?: boolean;
}

export interface ResolveProjectResult {
  state: WorkspaceState;
  projectId: string | null;
  projectCreated: boolean;
}

/**
 * Decides which project a memory belongs to. Order: (1) explicit `projectId` (null = none, respected);
 * (2) explicit `project` {name, repo?, workspace?}: a project with the same normalised repo or workspace; else a
 * project whose key / alias equals the name (unless its repo differs from the supplied one: then a separate
 * "<name> (2)" project is made); else a new project (+ default collection); (3) the project linked to the
 * explicitly named collection; (4) an EXISTING project matching the title prefix (`<key>: ...`).
 * (3) and (4) apply to creates only (applyDefault !== false) and never for imports / system writes.
 * Existing projects are never modified here (no rename, merge, delete or repoint), whoever the actor is.
 */
export function resolveProject(state: WorkspaceState, ctx: DomainContext, input: ResolveProjectInput): ResolveProjectResult {
  const { projectId, project, actor } = input;
  assertActor(actor);
  assertNotBothProjectFields(projectId, project);
  const none: ResolveProjectResult = { state, projectId: null, projectCreated: false };

  if (projectId !== undefined) {
    if (projectId === null) return none;
    if (typeof projectId !== "string") throw invalid("projectId must be a string or null");
    assertSafeId(projectId, "project");
    if (!getProject(state, projectId)) throw new DomainError("project_not_found", `Project not found: ${projectId}`);
    return { state, projectId, projectCreated: false };
  }

  if (project !== undefined) {
    const c = checkProjectInput(project);
    const byRef = projectList(state)
      .filter((p) => (c.repo !== null && hasSource(p, "repo", c.repo)) || (c.workspace !== null && hasSource(p, "workspace", c.workspace)))
      // A repo match beats a workspace-only match.
      .sort((a, b) => Number(c.repo !== null && hasSource(b, "repo", c.repo)) - Number(c.repo !== null && hasSource(a, "repo", c.repo)) || oldestFirst(a, b));
    if (byRef[0]) return { state, projectId: byRef[0].id, projectCreated: false };
    const byName = projectList(state)
      .filter((p) => p.key === c.key || p.aliases.includes(c.key))
      .sort(oldestFirst);
    // Same name but a different repository is a different project; with the repo absent on either side, reuse by name.
    const reusable = byName.find((p) => c.repo === null || !hasRepo(p));
    if (reusable) return { state, projectId: reusable.id, projectCreated: false };
    const name = byName.length > 0 ? nextFreeName(state, c.name) : c.name;
    const created = insertProject(state, ctx, { ...c, name, key: normalizeTitle(name) }, actor);
    return { state: created.state, projectId: created.project.id, projectCreated: true };
  }

  const origin = input.origin ?? actor.kind;
  if (input.applyDefault === false || input.migrating || origin === "import" || origin === "system") return none;

  const fromCollection = input.collectionId ? safeGet(state.collections, input.collectionId)?.projectId : null;
  if (fromCollection && getProject(state, fromCollection)) return { state, projectId: fromCollection, projectCreated: false };

  const byTitle = projectByTitle(state, input.title);
  return byTitle ? { state, projectId: byTitle.id, projectCreated: false } : none;
}

// ---- placement (project + collection) -----------------------------------------------------------------------------

export interface PlacementInput {
  projectId?: string | null;
  project?: unknown;
  collectionId?: string | null;
  collection?: string;
  title: string;
  actor: Actor;
  origin?: Origin;
  /** False for updates: only explicit input changes the project / collection. */
  applyDefault?: boolean;
  migrating?: boolean;
}

export interface Placement {
  state: WorkspaceState;
  /** undefined only for an update that gave no project input (leave the project as it is). */
  projectId: string | null | undefined;
  collectionId: string | null | undefined;
  projectCreated: boolean;
}

/**
 * The single place that decides project AND collection for a write.
 *  - an explicit collection (collectionId / collection) is resolved first and always decides the folder;
 *  - the project is resolved by resolveProject (explicit > collection-linked > title prefix);
 *  - with no explicit collection, the folder follows the project's default collection; with no project the
 *    existing collection rule applies (title-prefix collection name, then "Unsorted"), unless applyDefault is false.
 * For an update (applyDefault false) a field nobody mentioned comes back undefined = unchanged.
 */
export function resolvePlacement(state: WorkspaceState, ctx: DomainContext, input: PlacementInput): Placement {
  assertNotBothCollectionFields(input.collectionId, input.collection);
  assertNotBothProjectFields(input.projectId, input.project);
  const isUpdate = input.applyDefault === false;
  const explicitCollection = input.collectionId !== undefined || input.collection !== undefined;
  let next = state;
  let collectionId: string | null | undefined;
  if (explicitCollection) {
    const r = resolveCollection(next, ctx, {
      collectionId: input.collectionId,
      collection: input.collection,
      title: input.title,
      actor: input.actor,
      applyDefault: false,
    });
    next = r.state;
    collectionId = r.collectionId;
  }
  const explicitProject = input.projectId !== undefined || input.project !== undefined;
  let projectId: string | null | undefined;
  let projectCreated = false;
  if (!isUpdate || explicitProject) {
    const p = resolveProject(next, ctx, {
      projectId: input.projectId,
      project: input.project,
      collectionId,
      title: input.title,
      actor: input.actor,
      origin: input.origin,
      applyDefault: input.applyDefault,
      migrating: input.migrating,
    });
    next = p.state;
    projectId = p.projectId;
    projectCreated = p.projectCreated;
  }
  if (!explicitCollection) {
    const folder = projectId ? getProject(next, projectId)?.collectionId : null;
    if (folder && Object.hasOwn(next.collections, folder)) collectionId = folder;
    else if (!isUpdate) {
      const r = resolveCollection(next, ctx, {
        title: input.title,
        actor: input.actor,
        origin: input.origin,
        migrating: input.migrating,
        // A resolved project that has no folder (cap reached) goes to Unsorted / none, not to a same-named collection.
        skipPrefix: !!projectId,
      });
      next = r.state;
      collectionId = r.collectionId;
    }
  }
  return { state: next, projectId, collectionId, projectCreated };
}

// ---- migration: derive projects from title prefixes ---------------------------------------------------------------

const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");

/** Most common raw casing; ties go to the variant with uppercase letters, then alphabetical (as the graph does). */
function displayName(votes: string[]): string {
  const count = new Map<string, number>();
  for (const v of votes) count.set(v, (count.get(v) ?? 0) + 1);
  const hasUpper = (v: string): boolean => v !== v.toLowerCase();
  return [...count.entries()].sort(
    (a, b) => b[1] - a[1] || Number(hasUpper(b[0])) - Number(hasUpper(a[0])) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  )[0][0];
}

/**
 * Pure, deterministic migration step: adds a Project for every title-prefix project the graph would show (same
 * rules as src/features/graph/graphModel.ts derivedPrefixLinks: a key with a colon child `<key>: ...`, or a memory
 * titled exactly the key that has colon children / legacy followers `<key> ...` / `<key>, ...`), computed over the
 * visible saved memories. Each gets id prj_<16 hex of sha256(key)> and sources [{prefix, key}]. The oldest existing
 * collection of the same normalised name is linked to it both ways. Nothing else is touched: no collection is
 * created, snapshots / revisions / relations / ids are unchanged. Projects already in the state are kept and their
 * keys are not derived again, so applying it twice changes nothing.
 */
export function deriveProjectsFromPrefixes(state: WorkspaceState): WorkspaceState {
  const memories = listMemories(state).filter((m) => !m.archived);
  const real = new Map<string, { id: string; title: string; createdAt: string }[]>();
  for (const m of memories) {
    const key = normalizeTitle(m.title);
    real.set(key, [...(real.get(key) ?? []), m]);
  }
  const colon = new Map<string, { id: string; raw: string; createdAt: string }[]>();
  const colonOf = new Set<string>();
  for (const m of memories) {
    const prefix = parseTitlePrefix(m.title);
    if (prefix === null) continue;
    if (m.title.slice(m.title.indexOf(":") + 1).startsWith("//")) continue; // a URL, not `<project>: <data>`
    colonOf.add(m.id);
    const key = normalizeTitle(prefix);
    colon.set(key, [...(colon.get(key) ?? []), { id: m.id, raw: collapse(prefix), createdAt: m.createdAt }]);
  }
  const keys = [...new Set([...colon.keys(), ...real.keys()])].filter((k) => k !== "");
  const keySet = new Set(keys);
  const legacy = new Map<string, { id: string; raw: string; createdAt: string }[]>();
  for (const m of memories) {
    if (colonOf.has(m.id)) continue;
    const c = collapse(m.title);
    let found: { key: string; raw: string } | undefined;
    for (let n = c.length - 1; n > 0 && !found; n--) {
      if (c[n] !== " " && c[n] !== ",") continue;
      const raw = c.slice(0, n);
      const k = raw.toLowerCase();
      if (keySet.has(k) && !k.includes("/")) found = { key: k, raw };
    }
    if (found) legacy.set(found.key, [...(legacy.get(found.key) ?? []), { id: m.id, raw: found.raw, createdAt: m.createdAt }]);
  }

  interface Candidate {
    key: string;
    name: string;
    size: number;
    createdAt: string;
  }
  const taken = new Set(projectList(state).flatMap((p) => [p.key, ...p.aliases]));
  const found: Candidate[] = [];
  for (const key of keys) {
    const parents = real.get(key) ?? [];
    const followers = (legacy.get(key) ?? []).filter((f) => !parents.some((p) => p.id === f.id));
    const children = colon.get(key) ?? [];
    const qualifies = parents.length > 0 ? children.length + followers.length > 0 : !key.includes("/") && children.length > 0;
    if (!qualifies || taken.has(key) || RESERVED_PROJECT_NAMES.has(key)) continue;
    const members = [...parents, ...children, ...followers];
    const name = displayName([...children, ...followers].map((c) => c.raw).concat(parents.map((p) => collapse(p.title))));
    if (name.length > LIMITS.projectName || CONTROL_CHARS.test(name) || normalizeTitle(name) !== key) continue;
    found.push({ key, name, size: members.length, createdAt: members.map((m) => m.createdAt).sort()[0] });
  }
  // Keep the busiest keys when more than the cap qualify (deterministic: size desc, then key).
  const room = Math.max(0, LIMITS.maxProjects - projectList(state).length);
  const chosen = found.sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, room);
  if (chosen.length === 0) return state;

  const projects = { ...state.projects };
  const collections = { ...state.collections };
  const oldestCollections = Object.values(state.collections).sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1,
  );
  for (const c of chosen) {
    let id = projectIdForKey(c.key);
    while (Object.hasOwn(projects, id)) id = projectIdForKey(`${c.key}\u0000${id}`);
    const col = oldestCollections.find((x) => normalizeTitle(x.name) === c.key && (collections[x.id].projectId ?? null) === null);
    if (col) collections[col.id] = { ...collections[col.id], projectId: id };
    projects[id] = {
      id,
      key: c.key,
      name: c.name,
      aliases: [],
      sources: [{ kind: "prefix", ref: c.key }],
      collectionId: col?.id ?? null,
      createdAt: c.createdAt,
      createdBy: "migration",
      autoCreated: false,
      confirmed: true,
    };
  }
  return { ...state, projects, collections };
}
