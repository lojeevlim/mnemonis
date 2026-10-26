import { LIMITS } from "./limits";
import { RESERVED_PROJECT_NAMES } from "./projects";
import { normalizeTitle } from "./titlePrefix";
import { ORIGINS, PROJECT_SOURCE_KINDS, RELATION_STATUSES, REVISION_STATUSES, type Relation, type WorkspaceState } from "./types";
import { isJsonValue, isPlainObject, isReservedKey } from "./util";

export const SCHEMA_VERSION = 4;

export function createEmptyWorkspace(): WorkspaceState {
  return { schemaVersion: SCHEMA_VERSION, memories: {}, revisions: {}, relations: {}, collections: {}, projects: {}, organizations: {} };
}

export type ValidationResult =
  | { ok: true; state: WorkspaceState }
  | { ok: false; reason: "corrupt" | "version-mismatch" };

/** Upper bound for imported / stored workspace JSON (characters). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type Rec = Record<string, unknown>;
const CORRUPT: ValidationResult = { ok: false, reason: "corrupt" };

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Own entries of a map whose keys are safe and equal to each value's `id`. */
function entriesOf(map: unknown): [string, Rec][] | null {
  if (!isPlainObject(map)) return null;
  const out: [string, Rec][] = [];
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (isReservedKey(key) || !isPlainObject(v) || v.id !== key) return null;
    out.push([key, v]);
  }
  return out;
}

const has = (map: Rec, key: unknown): boolean => isStr(key) && !isReservedKey(key) && Object.hasOwn(map, key);

function validSnapshot(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isStr(v.title) &&
    isStr(v.content) &&
    isStr(v.type) &&
    isStrArray(v.tags) &&
    isStrOrNull(v.collectionId) &&
    isStrOrNull(v.projectId) &&
    typeof v.archived === "boolean" &&
    isPlainObject(v.metadata) &&
    isJsonValue(v.metadata)
  );
}

/** True when following `next` from any node revisits a node (cycle). Iterative, safe on bad data. */
function hasCycle(ids: string[], next: (id: string) => string[]): boolean {
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  for (const root of ids) {
    if (state.has(root)) continue;
    const stack: { id: string; rest: string[] }[] = [{ id: root, rest: [...next(root)] }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const child = top.rest.pop();
      if (child === undefined) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const st = state.get(child);
      if (st === 1) return true;
      if (st === 2) continue;
      state.set(child, 1);
      stack.push({ id: child, rest: [...next(child)] });
    }
  }
  return false;
}

/**
 * Per memory: saved revisions form ONE linear chain (first has parent null, each next one's parent is the
 * previous saved), and a pending revision's parent is the chain head (null when nothing is saved yet).
 * Independent of key order.
 */
function validChains(revisions: [string, Rec][]): boolean {
  const savedBy = new Map<string, Rec[]>();
  const pendingBy = new Map<string, Rec>();
  for (const [, r] of revisions) {
    const mid = r.memoryId as string;
    if (r.status === "saved") savedBy.set(mid, [...(savedBy.get(mid) ?? []), r]);
    else if (r.status === "pending") pendingBy.set(mid, r);
  }
  const heads = new Map<string, string>();
  for (const [mid, list] of savedBy) {
    const ids = new Set(list.map((r) => r.id as string));
    const used = new Set<string>();
    const roots: Rec[] = [];
    for (const r of list) {
      const p = r.parentRevisionId as string | null;
      if (p === null) roots.push(r);
      else if (!ids.has(p) || used.has(p)) return false; // parent must be a saved sibling, used once
      else used.add(p);
    }
    // One root + every parent link inside the set and used once + no cycles (checked globally) = a line.
    if (roots.length !== 1) return false;
    const tips = list.filter((r) => !used.has(r.id as string));
    if (tips.length !== 1) return false;
    heads.set(mid, tips[0].id as string);
  }
  for (const [mid, r] of pendingBy) {
    if (r.parentRevisionId !== (heads.get(mid) ?? null)) return false;
  }
  return true;
}

/** Validates (and returns the relations normalised: missing status => saved). null = invalid. */
function validate(raw: Rec): Record<string, Relation> | null {
  const memories = entriesOf(raw.memories);
  const revisions = entriesOf(raw.revisions);
  const relations = entriesOf(raw.relations);
  const collections = entriesOf(raw.collections);
  const projects = entriesOf(raw.projects);
  const organizations = entriesOf(raw.organizations);
  if (!memories || !revisions || !relations || !collections || !projects || !organizations) return null;
  const memMap = raw.memories as Rec;
  const revMap = raw.revisions as Rec;

  for (const [, m] of memories) {
    const p = m.provenance;
    if (!isStr(m.createdAt) || !isStr(m.source)) return null;
    if (!isPlainObject(p) || !isStr(p.origin) || !isStr(p.createdBy)) return null;
  }
  for (const [, c] of collections) {
    if (!isStr(c.name) || !isStr(c.description) || !isStr(c.createdAt)) return null;
    if (c.projectId !== undefined && !isStrOrNull(c.projectId)) return null;
  }
  for (const [, pr] of projects) {
    if (!isStr(pr.key) || !isStr(pr.name) || !isStr(pr.createdAt) || !isStr(pr.createdBy)) return null;
    if (!isStrArray(pr.aliases) || !isStrOrNull(pr.collectionId)) return null;
    if (pr.aliases.length > LIMITS.maxProjectAliases) return null;
    if (typeof pr.autoCreated !== "boolean" || typeof pr.confirmed !== "boolean") return null;
    if (!isStrOrNull(pr.organizationId)) return null;
    if (!Array.isArray(pr.sources) || pr.sources.length > LIMITS.maxProjectSources) return null;
    for (const s of pr.sources) {
      if (!isPlainObject(s) || !isStr(s.ref) || !isStr(s.kind) || !(PROJECT_SOURCE_KINDS as readonly string[]).includes(s.kind)) return null;
    }
  }
  for (const [, o] of organizations) {
    if (!isStr(o.key) || !isStr(o.name) || !isStr(o.createdAt) || !isStr(o.createdBy)) return null;
    if (typeof o.autoCreated !== "boolean" || typeof o.confirmed !== "boolean") return null;
  }
  for (const [, r] of relations) {
    const p = r.provenance;
    if (!has(memMap, r.fromId) || !has(memMap, r.toId) || !isStr(r.label) || !isStr(r.createdAt)) return null;
    if (!isPlainObject(p) || (p.origin !== "user" && p.origin !== "process") || !isStr(p.createdBy)) return null;
    if (p.process !== undefined && !isStr(p.process)) return null;
    if (p.demo !== undefined && typeof p.demo !== "boolean") return null;
    if (r.status !== undefined && !(isStr(r.status) && (RELATION_STATUSES as readonly string[]).includes(r.status))) return null;
    if (r.decidedAt !== undefined && !isStrOrNull(r.decidedAt)) return null;
  }
  const pendingMemories = new Set<string>();
  for (const [, r] of revisions) {
    if (!has(memMap, r.memoryId) || !validSnapshot(r.snapshot)) return null;
    if (!isStr(r.createdAt) || !isStr(r.author) || !isStr(r.note)) return null;
    if (!isStr(r.origin) || !(ORIGINS as readonly string[]).includes(r.origin)) return null;
    if (!isStr(r.status) || !(REVISION_STATUSES as readonly string[]).includes(r.status)) return null;
    if (!isStrOrNull(r.savedAt) || !isStrOrNull(r.decidedAt)) return null;
    if (r.status === "saved" && r.savedAt === null) return null;
    if (r.parentRevisionId !== null && !has(revMap, r.parentRevisionId)) return null;
    if (r.parentRevisionId !== null && (revMap[r.parentRevisionId as string] as Rec).memoryId !== r.memoryId) return null;
    if (r.status === "pending") {
      // Invariant: at most one pending revision per memory.
      if (pendingMemories.has(r.memoryId as string)) return null;
      pendingMemories.add(r.memoryId as string);
    }
  }
  const parentOf = (id: string) => {
    const p = (revMap[id] as Rec).parentRevisionId;
    return isStr(p) ? [p] : [];
  };
  if (hasCycle(revisions.map(([id]) => id), parentOf)) return null;
  if (!validChains(revisions)) return null;
  const out: Record<string, Relation> = {};
  for (const [id, r] of relations) {
    const status = r.status === undefined ? "saved" : r.status;
    out[id] = {
      ...(r as unknown as Relation),
      status: status as Relation["status"],
      decidedAt: r.decidedAt === undefined ? (status === "saved" ? (r.createdAt as string) : null) : (r.decidedAt as string | null),
    };
  }
  return out;
}

/**
 * Deep structural + referential validation of untrusted (localStorage / imported) data:
 * field types, id === map key, reserved keys, dangling references and cycles in
 * revision parents. Historic revisions may legitimately reference a
 * collection (or project) that was later deleted, so snapshot.collectionId / projectId are type-checked only.
 */
export function validateWorkspaceState(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return CORRUPT;
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: typeof raw.schemaVersion === "number" ? "version-mismatch" : "corrupt" };
  }
  let relations: Record<string, Relation> | null;
  try {
    relations = validate(raw);
  } catch {
    return CORRUPT;
  }
  if (!relations) return CORRUPT;
  return { ok: true, state: repairOrganizations(repairProjects({ ...(raw as unknown as WorkspaceState), relations })) };
}

// ---- repair of project data on load ---------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f]+/g;
const FORMAT_RUN = /\p{Cf}+/gu;
const HAS_FORMAT = /\p{Cf}/u;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const WORKSPACE_REF = /^[A-Za-z0-9_-]{1,64}$/;
const byAge = (a: Rec, b: Rec): number =>
  a.createdAt === b.createdAt ? (a.id! < b.id! ? -1 : 1) : (a.createdAt as string) < (b.createdAt as string) ? -1 : 1;
const sameList = (a: unknown[], b: unknown[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** A name the project rules accept (<= 100 chars, NFC, no control / format characters, not reserved), or "" when nothing is left. */
function cleanProjectName(raw: string): string {
  const name = raw.slice(0, 1000).replace(FORMAT_RUN, "").replace(CONTROL_RUN, " ").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, LIMITS.projectName).trim();
  return RESERVED_PROJECT_NAMES.has(normalizeTitle(name)) ? "" : name;
}

const validAlias = (a: string): boolean =>
  a !== "" && a.length <= LIMITS.projectName && a === normalizeTitle(a) && a === a.normalize("NFC") && !HAS_FORMAT.test(a) && !HAS_CONTROL.test(a) && !RESERVED_PROJECT_NAMES.has(a);
const validSource = (s: Rec): boolean => {
  const ref = s.ref as string;
  if (ref === "" || ref.length > LIMITS.repoUrl) return false;
  if (ref !== ref.normalize("NFC") || HAS_CONTROL.test(ref) || HAS_FORMAT.test(ref)) return false;
  return s.kind === "workspace" ? WORKSPACE_REF.test(ref) : ref.length <= LIMITS.repoUrl;
};

/**
 * Pure and idempotent repair of what loading must never reject: project <-> folder links, keys and references.
 * Type / size / shape errors are NOT repaired here (the validator rejects those); memories, revisions and relations
 * are never touched. Deterministic, oldest project first:
 *  - a project's name loses control / format characters, is NFC and at most 100 characters, and its key becomes
 *    normalizeTitle(name) (a name that is empty or reserved after cleaning becomes "Project <id suffix>");
 *  - a later project whose key is taken gets a free "<name> (n)" name (dropped only when none is free within 50 tries);
 *    an alias that is not a clean normalised key, repeats, or is another project's key / alias is dropped;
 *    a source whose ref is too long, not NFC, has control / format characters, is duplicated or (workspace) is not an
 *    opaque id is dropped;
 *  - links: a dangling project.collectionId / collection.projectId is cleared; a collection pointed at by several
 *    projects stays with the project it names (else the oldest) and the others lose the pointer; a project named by
 *    several collections keeps the one it points at (else the oldest) and the others lose the pointer. Both objects
 *    are always kept; one-sided links (only one side names the other) are tolerated as before.
 * Returns the same state object when there is nothing to repair.
 */
export function repairProjects(state: WorkspaceState): WorkspaceState {
  const projs = new Map<string, Rec>(Object.entries(state.projects).map(([id, p]) => [id, { ...(p as unknown as Rec) }]));
  const cols = new Map<string, Rec>(Object.entries(state.collections).map(([id, c]) => [id, { ...(c as unknown as Rec) }]));
  let dirty = false;
  const set = (o: Rec, k: string, v: unknown): void => {
    if (o[k] !== v) {
      o[k] = v;
      dirty = true;
    }
  };
  const order = [...projs.values()].sort(byAge);

  // 1. names, keys, sources
  for (const p of order) {
    const name = cleanProjectName(p.name as string) || `Project ${(p.id as string).replace(/[^A-Za-z0-9]/g, "").slice(-8) || "x"}`;
    set(p, "name", name);
    set(p, "key", normalizeTitle(name));
    const seen = new Set<string>();
    const sources = (p.sources as Rec[]).filter((s) => {
      const id = `${s.kind as string}\u0000${s.ref as string}`;
      if (!validSource(s) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!sameList(sources, p.sources as Rec[])) set(p, "sources", sources);
  }

  // 2. unique keys: the oldest keeps the key, a later one is renamed (or dropped when nothing is free)
  const keys = new Set<string>();
  for (const p of order) {
    if (keys.has(p.key as string)) {
      let free: string | null = null;
      for (let n = 2; n < 52 && free === null; n++) {
        const suffix = ` (${n})`;
        const candidate = `${(p.name as string).slice(0, LIMITS.projectName - suffix.length).trimEnd()}${suffix}`;
        if (!keys.has(normalizeTitle(candidate))) free = candidate;
      }
      if (free === null) {
        projs.delete(p.id as string);
        dirty = true;
        continue;
      }
      set(p, "name", free);
      set(p, "key", normalizeTitle(free));
    }
    keys.add(p.key as string);
  }

  // 3. aliases (after every key is known): clean, unique, never a key of any project
  const aliasOwner = new Set<string>();
  for (const p of order) {
    if (!projs.has(p.id as string)) continue;
    const aliases = (p.aliases as string[]).filter((a) => {
      if (!validAlias(a) || a === p.key || keys.has(a) || aliasOwner.has(a)) return false;
      aliasOwner.add(a);
      return true;
    });
    if (!sameList(aliases, p.aliases as string[])) set(p, "aliases", aliases);
  }

  // 4. links
  for (const p of projs.values()) if (p.collectionId !== null && !cols.has(p.collectionId as string)) set(p, "collectionId", null);
  for (const c of cols.values()) if (typeof c.projectId === "string" && !projs.has(c.projectId)) set(c, "projectId", null);
  const pointing = new Map<string, Rec[]>();
  for (const p of order) {
    if (!projs.has(p.id as string) || p.collectionId === null) continue;
    const list = pointing.get(p.collectionId as string);
    if (list) list.push(p);
    else pointing.set(p.collectionId as string, [p]);
  }
  for (const [cid, list] of pointing) {
    const named = (cols.get(cid) as Rec).projectId;
    const owner = typeof named === "string" ? named : (list[0].id as string);
    for (const p of list) if (p.id !== owner) set(p, "collectionId", null);
  }
  const named = new Map<string, Rec[]>();
  for (const c of [...cols.values()].sort(byAge)) {
    if (typeof c.projectId !== "string") continue;
    const list = named.get(c.projectId);
    if (list) list.push(c);
    else named.set(c.projectId, [c]);
  }
  for (const [pid, list] of named) {
    const own = (projs.get(pid) as Rec).collectionId;
    const keep = own === null ? list[0].id : own;
    for (const c of list) if (c.id !== keep) set(c, "projectId", null);
  }

  if (!dirty) return state;
  return {
    ...state,
    projects: Object.fromEntries(projs) as unknown as WorkspaceState["projects"],
    collections: Object.fromEntries(cols) as unknown as WorkspaceState["collections"],
  };
}

/** A name the organization rules accept (same as project names), or "" when nothing is left. */
const cleanOrganizationName = cleanProjectName;

/**
 * Pure and idempotent repair of organization data on load (after repairProjects), deterministic, oldest first:
 *  - a name loses control / format characters, is NFC and at most 100 characters, and the key becomes
 *    normalizeTitle(name) (empty / reserved after cleaning becomes "Organization <id suffix>");
 *  - organizations with the same key are merged into the oldest one: the later ones are dropped and their projects
 *    point at the survivor (no project is lost);
 *  - a dangling project.organizationId becomes null.
 * Returns the same state object when there is nothing to repair. Linear in projects + organizations.
 */
export function repairOrganizations(state: WorkspaceState): WorkspaceState {
  const orgs = Object.values(state.organizations).sort((a, b) => byAge(a as unknown as Rec, b as unknown as Rec));
  let dirty = false;
  const survivors = new Map<string, WorkspaceState["organizations"][string]>();
  const byKey = new Map<string, string>();
  const redirect = new Map<string, string>();
  for (const o of orgs) {
    const name = cleanOrganizationName(o.name) || `Organization ${o.id.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "x"}`;
    const key = normalizeTitle(name);
    const owner = byKey.get(key);
    if (owner !== undefined) {
      redirect.set(o.id, owner);
      dirty = true;
      continue;
    }
    byKey.set(key, o.id);
    if (name !== o.name || key !== o.key) {
      survivors.set(o.id, { ...o, name, key });
      dirty = true;
    } else survivors.set(o.id, o);
  }
  let projects = state.projects;
  for (const p of Object.values(state.projects)) {
    if (p.organizationId === null) continue;
    const target = redirect.get(p.organizationId) ?? p.organizationId;
    const next = survivors.has(target) ? target : null;
    if (next !== p.organizationId) {
      if (projects === state.projects) projects = { ...state.projects };
      projects[p.id] = { ...p, organizationId: next };
      dirty = true;
    }
  }
  if (!dirty) return state;
  const organizations: WorkspaceState["organizations"] = {};
  for (const o of orgs) if (survivors.has(o.id)) organizations[o.id] = survivors.get(o.id)!;
  return { ...state, organizations, projects };
}

/**
 * Number of SAVED revisions with origin "agent" in a (validated) state. The validator deliberately does not
 * constrain revision origin, so an import may carry them; a UI can surface this count in an import preview.
 */
export function savedAgentOriginCount(state: WorkspaceState): number {
  return Object.values(state.revisions).filter((r) => r.status === "saved" && r.origin === "agent").length;
}
