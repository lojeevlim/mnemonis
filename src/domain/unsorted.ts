import { DomainError, type DomainContext } from "./context";
import { assertActor, LIMITS } from "./limits";
import { getMemory, listMemories } from "./queries";
import { confirmProjectIn, getProject } from "./projects";
import { normalizeTitle, parseTitlePrefix } from "./titlePrefix";
import type { Actor, Memory, Mutation, Project, Revision, WorkspaceState } from "./types";
import { deepEqual, freshId } from "./util";

/** Who wrote the memory's current saved revision: the user's own memories are filed automatically, agent-written ones only suggested. */
export type SuggestionOrigin = "user" | "agent";

export interface Reassignment {
  memoryId: string;
  origin: SuggestionOrigin;
  fromCollectionId: string | null;
  toProjectId: string;
  /** The project's own folder (null when it has none: the memory then stays where it is). */
  toCollectionId: string | null;
  reason: string;
}

const UNSORTED_KEY = "unsorted";

/** An agent-created project nobody has confirmed yet: automatic filing never targets (or confirms) it. */
const isUnconfirmedAgentProject = (p: Project): boolean => p.autoCreated && !p.confirmed;

/** projects whose key or alias equals a normalised key, built once per call. `auto` leaves out unconfirmed agent projects. */
function keyIndex(state: WorkspaceState, auto: boolean): Map<string, Project[]> {
  const index = new Map<string, Project[]>();
  const add = (key: string, p: Project): void => {
    const list = index.get(key);
    if (!list) index.set(key, [p]);
    else if (!list.includes(p)) list.push(p);
  };
  for (const p of Object.values(state.projects)) {
    if (auto && isUnconfirmedAgentProject(p)) continue;
    add(p.key, p);
    for (const a of p.aliases) add(a, p);
  }
  return index;
}

/**
 * The unique existing project a title points at, by the projectOfMemory rules (a `<key>: ...` prefix that is not
 * a URL, else a title that is exactly a key / alias). null when nothing matches or when several projects do.
 */
function uniqueProjectOfTitle(index: Map<string, Project[]>, title: string): { project: Project; reason: string } | null {
  if (title.length > LIMITS.title) return null; // hostile / corrupt title: never scanned
  const prefix = parseTitlePrefix(title);
  if (prefix !== null && !title.slice(title.indexOf(":") + 1).startsWith("//")) {
    const hits = index.get(normalizeTitle(prefix));
    if (hits && hits.length > 0) return hits.length === 1 ? { project: hits[0], reason: `Title starts with "${prefix.trim()}:"` } : null;
  }
  const exact = index.get(normalizeTitle(title));
  if (exact && exact.length === 1) return { project: exact[0], reason: `Title is the project name "${title.trim()}"` };
  return null;
}

function isUnsortedCollection(state: WorkspaceState, collectionId: string | null): boolean {
  if (collectionId === null) return true;
  const c = Object.hasOwn(state.collections, collectionId) ? state.collections[collectionId] : undefined;
  return !c || normalizeTitle(c.name) === UNSORTED_KEY;
}

const saved = (m: Memory): boolean => m.status === "saved";

/** Memories that sit in Unsorted (or in no collection): current saved, not archived, no open proposal. */
function unsortedMemories(state: WorkspaceState): Memory[] {
  return listMemories(state).filter((m) => saved(m) && isUnsortedCollection(state, m.collectionId));
}

/** How many saved, non-archived memories are in Unsorted (or have no collection). */
export const unsortedCount = (state: WorkspaceState): number => unsortedMemories(state).length;

interface Planned {
  s: Reassignment;
  /** The memory's current saved revision (what the filing builds on). */
  headId: string;
}

/**
 * Suggestions with the revision they build on. `auto` = the automatic-filing view: unconfirmed agent projects are not
 * candidates at all. `ids` restricts the scan to those memories (no full listing), `projectId` to one target project.
 */
function plan(state: WorkspaceState, opts: { auto: boolean; ids?: ReadonlySet<string> | null; projectId?: string }): Planned[] {
  if (Object.keys(state.projects).length === 0) return [];
  const index = keyIndex(state, opts.auto);
  if (index.size === 0) return [];
  const candidates: Memory[] = opts.ids
    ? [...opts.ids].flatMap((id) => {
        const m = getMemory(state, id);
        return m && saved(m) && isUnsortedCollection(state, m.collectionId) ? [m] : [];
      })
    : unsortedMemories(state);
  const out: Planned[] = [];
  for (const m of candidates) {
    if (getProject(state, m.projectId)) continue;
    const hit = uniqueProjectOfTitle(index, m.title);
    if (!hit || (opts.projectId !== undefined && hit.project.id !== opts.projectId)) continue;
    const rev = Object.hasOwn(state.revisions, m.revisionId) ? state.revisions[m.revisionId] : undefined;
    const folder = hit.project.collectionId;
    out.push({
      headId: m.revisionId,
      s: {
        memoryId: m.id,
        origin: rev?.origin === "user" ? "user" : "agent",
        fromCollectionId: m.collectionId,
        toProjectId: hit.project.id,
        toCollectionId: folder !== null && Object.hasOwn(state.collections, folder) ? folder : null,
        reason: hit.reason,
      },
    });
  }
  return out;
}

/**
 * Pure. Memories that could be filed into an existing project: current saved, not archived, with NO open proposal
 * (a pending proposal is never touched), whose own projectId does not resolve to a project and that sit in no
 * collection or in Unsorted. The target is the UNIQUE project their title points at; ambiguous or no match = none.
 * Unconfirmed agent projects ARE candidates here (the user is shown and decides); automatic filing never uses them.
 * Idempotent: once a memory is filed (explicit projectId) it is no longer listed. Never mutates anything.
 */
export function suggestReassignments(state: WorkspaceState): Reassignment[] {
  return plan(state, { auto: false }).map((p) => p.s);
}

/** Number of suggestions (optionally only those of one origin). */
export const suggestionCount = (state: WorkspaceState, origin?: SuggestionOrigin): number =>
  suggestReassignments(state).filter((s) => origin === undefined || s.origin === origin).length;

function requireUser(actor: Actor): void {
  assertActor(actor);
  if (actor.kind !== "user") throw new DomainError("forbidden", "Only a user can file memories into projects");
}

/**
 * Files the planned memories in ONE pass: each gets one new user-attributed saved revision (parent = the current
 * saved revision, snapshot = the old one with the project and, when the project has a folder, that folder), built
 * from a single copy of the revisions map. Every plan touches only its own memory, so the plans computed up front
 * stay valid. `confirm` = an explicit user action: the target projects are confirmed afterwards (once each); the
 * automatic paths pass false and also never touch an unconfirmed agent project, whatever the plan says.
 */
function applyPlans(
  state: WorkspaceState,
  ctx: DomainContext,
  actor: Actor,
  planned: Planned[],
  noteFor: (projectName: string) => string,
  confirm: boolean,
): Mutation<Reassignment[]> {
  const revisions: Record<string, Revision> = { ...state.revisions };
  const now = ctx.now();
  const applied: Reassignment[] = [];
  const targets = new Set<string>();
  for (const { s, headId } of planned) {
    const project = getProject(state, s.toProjectId);
    const head = Object.hasOwn(state.revisions, headId) ? state.revisions[headId] : undefined;
    if (!project || !head || head.status !== "saved" || (!confirm && isUnconfirmedAgentProject(project))) continue;
    const snapshot = { ...head.snapshot, projectId: project.id, collectionId: s.toCollectionId ?? head.snapshot.collectionId };
    if (deepEqual(snapshot, head.snapshot)) continue;
    const rev: Revision = {
      id: freshId(ctx, "rev", (id) => Object.hasOwn(revisions, id)),
      memoryId: s.memoryId,
      snapshot,
      parentRevisionId: head.id,
      createdAt: now,
      author: actor.name,
      origin: "user",
      status: "saved",
      note: noteFor(project.name),
      savedAt: now,
      decidedAt: now,
    };
    revisions[rev.id] = rev;
    applied.push(s);
    targets.add(project.id);
  }
  if (applied.length === 0) return { state, value: [] };
  let next: WorkspaceState = { ...state, revisions };
  if (confirm) for (const id of targets) next = confirmProjectIn(next, id);
  return { state: next, value: applied };
}

/**
 * User only ("forbidden" for an agent). Files the given memories (default: every suggestion) into their suggested
 * project (the memory also moves to the project's folder) as a user-attributed revision with a "Filed into <project>"
 * note. This is an explicit user action, so it may use an unconfirmed agent project and then confirms it.
 * Memories that no longer match are skipped. Returns the suggestions applied.
 */
export function applyReassignments(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { ids?: readonly string[]; actor: Actor },
): Mutation<Reassignment[]> {
  requireUser(args.actor);
  const wanted = args.ids === undefined ? null : new Set(args.ids);
  const chosen = plan(state, { auto: false }).filter((p) => wanted === null || wanted.has(p.s.memoryId));
  return applyPlans(state, ctx, args.actor, chosen, (name) => `Filed into ${name}`, true);
}

/** Memories one bulk automatic pass may file. */
export const AUTO_FILE_BULK_LIMIT = 50;
/** Used when the context does not know the store's size cap (the API's default; browsers keep about 5 MB too). */
export const DEFAULT_WORKSPACE_QUOTA_BYTES = 5 * 1024 * 1024;
/** Automatic filing stays out of the last 10% of the size cap. */
const AUTO_FILE_QUOTA_SHARE = 0.9;
/** A new revision costs its snapshot plus this much bookkeeping (ids, timestamps, note). */
const REVISION_OVERHEAD_BYTES = 512;
/** A single-memory filing below this estimated size is not worth measuring the workspace for. */
const SMALL_FILING_BYTES = 16 * 1024;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** The part of `planned` that fits in the room below 90% of the size cap (none when the workspace is already past it). */
function withinQuota(state: WorkspaceState, ctx: DomainContext, planned: Planned[], measureAlways: boolean): Planned[] {
  const cost = (p: Planned): number => utf8Length(JSON.stringify(state.revisions[p.headId]?.snapshot ?? {})) + REVISION_OVERHEAD_BYTES;
  const costs = planned.map(cost);
  if (!measureAlways && costs.reduce((a, b) => a + b, 0) < SMALL_FILING_BYTES) return planned;
  const limit = (ctx.workspaceQuotaBytes ?? DEFAULT_WORKSPACE_QUOTA_BYTES) * AUTO_FILE_QUOTA_SHARE;
  let used = utf8Length(JSON.stringify(state));
  const out: Planned[] = [];
  for (let i = 0; i < planned.length; i++) {
    if (used + costs[i] > limit) break;
    used += costs[i];
    out.push(planned[i]);
  }
  return out;
}

/**
 * Files the USER'S OWN memories (origin "user") that have a unique project match, recorded as user-attributed
 * revisions with the note "Filed automatically into <project>". Agent-written memories are never moved here, and
 * neither is anything into an UNCONFIRMED agent project (such a project is not even looked at, and is never
 * confirmed by this call). A non-user actor files nothing. It never throws a DomainError: when it cannot work (it
 * would not fit the size cap) it silently reports 0.
 *  - `only`: just those memory ids (the cheap path after one user write).
 *  - without `only` (bulk): at most AUTO_FILE_BULK_LIMIT memories per call, and only memories whose saved history is
 *    that one revision (a memory the user has edited is never rewritten); `projectId` limits it to one target.
 *  - the workspace must stay below 90% of its size cap (ctx.workspaceQuotaBytes).
 * LIMITATION: an explicit "no project" (projectId: null on create / update) is honoured when written but is not
 * remembered (the snapshot schema has no field for it), so a never-edited memory created that way can be filed by
 * a later bulk pass when its title matches a newly created project; edited memories (2+ saved revisions) never are.
 */
export function autoFileOwnMemories(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { actor: Actor; only?: readonly string[]; projectId?: string },
): Mutation<Reassignment[]> {
  assertActor(args.actor);
  const none: Mutation<Reassignment[]> = { state, value: [] };
  if (args.actor.kind !== "user") return none;
  const bulk = args.only === undefined;
  let chosen = plan(state, { auto: true, ids: bulk ? null : new Set(args.only), projectId: args.projectId }).filter((p) => p.s.origin === "user");
  if (chosen.length === 0) return none;
  if (bulk) {
    const savedCount = new Map<string, number>();
    for (const r of Object.values(state.revisions)) if (r.status === "saved") savedCount.set(r.memoryId, (savedCount.get(r.memoryId) ?? 0) + 1);
    chosen = chosen.filter((p) => savedCount.get(p.s.memoryId) === 1).slice(0, AUTO_FILE_BULK_LIMIT);
  }
  try {
    chosen = withinQuota(state, ctx, chosen, bulk);
    if (chosen.length === 0) return none;
    return applyPlans(state, ctx, args.actor, chosen, (name) => `Filed automatically into ${name}`, false);
  } catch (e) {
    if (e instanceof DomainError) return none;
    throw e;
  }
}
