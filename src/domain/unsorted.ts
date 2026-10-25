import { DomainError, type DomainContext } from "./context";
import { assertActor, LIMITS } from "./limits";
import { listMemories } from "./queries";
import { updateMemory } from "./memoryOps";
import { getProject } from "./projects";
import { normalizeTitle, parseTitlePrefix } from "./titlePrefix";
import type { Actor, Memory, Mutation, Project, WorkspaceState } from "./types";

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

/** projects whose key or alias equals a normalised key, built once per call. */
function keyIndex(state: WorkspaceState): Map<string, Project[]> {
  const index = new Map<string, Project[]>();
  const add = (key: string, p: Project): void => {
    const list = index.get(key);
    if (!list) index.set(key, [p]);
    else if (!list.includes(p)) list.push(p);
  };
  for (const p of Object.values(state.projects)) {
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

/**
 * Pure. Memories that could be filed into an existing project: current saved, not archived, with NO open proposal
 * (a pending proposal is never touched), whose own projectId does not resolve to a project and that sit in no
 * collection or in Unsorted. The target is the UNIQUE project their title points at; ambiguous or no match = none.
 * Idempotent: once a memory is filed (explicit projectId) it is no longer listed. Never mutates anything.
 */
export function suggestReassignments(state: WorkspaceState): Reassignment[] {
  if (Object.keys(state.projects).length === 0) return [];
  const index = keyIndex(state);
  const out: Reassignment[] = [];
  for (const m of unsortedMemories(state)) {
    if (getProject(state, m.projectId)) continue;
    const hit = uniqueProjectOfTitle(index, m.title);
    if (!hit) continue;
    const rev = Object.hasOwn(state.revisions, m.revisionId) ? state.revisions[m.revisionId] : undefined;
    const folder = hit.project.collectionId;
    out.push({
      memoryId: m.id,
      origin: rev?.origin === "user" ? "user" : "agent",
      fromCollectionId: m.collectionId,
      toProjectId: hit.project.id,
      toCollectionId: folder !== null && Object.hasOwn(state.collections, folder) ? folder : null,
      reason: hit.reason,
    });
  }
  return out;
}

/** Number of suggestions (optionally only those of one origin). */
export const suggestionCount = (state: WorkspaceState, origin?: SuggestionOrigin): number =>
  suggestReassignments(state).filter((s) => origin === undefined || s.origin === origin).length;

function requireUser(actor: Actor): void {
  assertActor(actor);
  if (actor.kind !== "user") throw new DomainError("forbidden", "Only a user can file memories into projects");
}

function applySuggestions(
  state: WorkspaceState,
  ctx: DomainContext,
  actor: Actor,
  chosen: Reassignment[],
  noteFor: (projectName: string) => string,
): Mutation<Reassignment[]> {
  const applied: Reassignment[] = [];
  let next = state;
  for (const s of chosen) {
    const project = getProject(next, s.toProjectId);
    if (!project) continue;
    // Every suggestion touches only its own memory, so the suggestions computed up front stay valid; a memory that
    // can no longer be written (a domain error) is simply skipped.
    try {
      next = updateMemory(next, ctx, { id: s.memoryId, patch: { projectId: s.toProjectId }, actor, note: noteFor(project.name) }).state;
      applied.push(s);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }
  return { state: next, value: applied };
}

/**
 * User only ("forbidden" for an agent). Files the given memories (default: every suggestion) into their suggested
 * project through updateMemory with an explicit projectId (so the memory also moves to the project's folder) and a
 * "Filed into <project>" note. Memories that no longer match are skipped. Returns the suggestions applied.
 */
export function applyReassignments(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { ids?: readonly string[]; actor: Actor },
): Mutation<Reassignment[]> {
  requireUser(args.actor);
  const wanted = args.ids === undefined ? null : new Set(args.ids);
  const chosen = suggestReassignments(state).filter((s) => wanted === null || wanted.has(s.memoryId));
  return applySuggestions(state, ctx, args.actor, chosen, (name) => `Filed into ${name}`);
}

/**
 * Files only the USER'S OWN memories (origin "user") that have a unique project match, recorded as user-attributed
 * revisions with the note "Filed automatically into <project>". Agent-written memories are never moved here.
 * `only` restricts the work to some memory ids (cheap path after one write). A non-user actor files nothing.
 */
export function autoFileOwnMemories(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { actor: Actor; only?: readonly string[] },
): Mutation<Reassignment[]> {
  assertActor(args.actor);
  if (args.actor.kind !== "user") return { state, value: [] };
  const only = args.only === undefined ? null : new Set(args.only);
  const chosen = suggestReassignments(state).filter((s) => s.origin === "user" && (only === null || only.has(s.memoryId)));
  if (chosen.length === 0) return { state, value: [] };
  return applySuggestions(state, ctx, args.actor, chosen, (name) => `Filed automatically into ${name}`);
}
