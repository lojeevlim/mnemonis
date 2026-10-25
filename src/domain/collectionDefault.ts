import { DomainError, type DomainContext } from "./context";
import { LIMITS } from "./limits";
import { assertCollectionRoom, createCollection } from "./relations";
import { normalizeTitle, parseTitlePrefix } from "./titlePrefix";
import type { Actor, Collection, Origin, WorkspaceState } from "./types";
import { assertSafeId, safeGet } from "./util";

export const UNSORTED_NAME = "Unsorted";
/** Preferred id of the fallback collection (a fresh id is used if that one is somehow taken). */
const UNSORTED_ID = "col_unsorted";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export interface ResolveCollectionInput {
  /** undefined = apply the rule; null = the user chose "No collection" (respected); string = that collection id. */
  collectionId?: string | null;
  /** An existing collection id or name (case-insensitive). An unknown name is an error for agents, created for users. */
  collection?: string;
  title: string;
  actor: Actor;
  origin?: Origin;
  /** True while migrating stored data: no default is applied. */
  migrating?: boolean;
  /** False for updates: only an explicit collection/collectionId is honoured, nothing is ever re-defaulted. */
  applyDefault?: boolean;
}

const invalid = (msg: string) => new DomainError("invalid_input", msg);

/**
 * The collection whose name matches `name` (trimmed, whitespace-collapsed, case-insensitive). Names are not
 * unique ("Work" and "work" can both exist), so a collision is broken deterministically, independent of
 * insertion order: the OLDEST collection wins (earliest createdAt, then smallest id).
 * Creation is deliberately left unchanged (duplicates stay allowed) because stored workspaces, imports and
 * existing tests may already contain equal names; rejecting them could break existing data.
 */
const findByName = (state: WorkspaceState, name: string): Collection | undefined => {
  const key = normalizeTitle(name);
  let best: Collection | undefined;
  for (const c of Object.values(state.collections)) {
    if (normalizeTitle(c.name) !== key) continue;
    if (!best || c.createdAt < best.createdAt || (c.createdAt === best.createdAt && c.id < best.id)) best = c;
  }
  return best;
};

/** `collection` (id or name) and `collectionId` are alternatives: giving both, even `collectionId: null`, is ambiguous. */
export function assertNotBothCollectionFields(collectionId: unknown, collection: unknown): void {
  if (collectionId !== undefined && collection !== undefined) {
    throw invalid("give either collection or collectionId, not both");
  }
}

/** A caller-supplied collection name: a string of 1-100 chars (after trimming) without control characters. */
function checkName(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("collection must be a string");
  const name = raw.trim();
  if (!name) throw invalid("collection must not be empty");
  if (name.length > LIMITS.collectionName) {
    throw new DomainError("too_large", `Collection name is too long (max ${LIMITS.collectionName} characters)`);
  }
  if (CONTROL_CHARS.test(name)) throw invalid("collection must not contain control characters");
  return name;
}

/**
 * Decides which collection a memory goes to. Order: (1) explicit `collectionId` (null = none, respected);
 * (2) explicit `collection`, as an id then as a case-insensitive name (unknown name: error for an agent, never
 * auto-created; created for a user, within the caps); (3) the `<project>:` title prefix matched against EXISTING
 * collection names; (4) the "Unsorted" collection, created on first use. Imports, system writes and migrations
 * get no default (null).
 *
 * Returns the (possibly extended) state. A newly created collection exists IMMEDIATELY, even when the memory
 * itself is only a pending agent proposal: the assignment lives in the revision snapshot, so the memory stays
 * out of the collection until a user approves it, and a rejected proposal leaves behind an empty collection
 * that `deleteCollection` can remove.
 */
export function resolveCollection(
  state: WorkspaceState,
  ctx: DomainContext,
  input: ResolveCollectionInput,
): { state: WorkspaceState; collectionId: string | null } {
  const { collectionId, collection, actor } = input;
  assertNotBothCollectionFields(collectionId, collection);

  if (collectionId !== undefined) {
    if (collectionId === null) return { state, collectionId: null };
    if (typeof collectionId !== "string") throw invalid("collectionId must be a string or null");
    assertSafeId(collectionId, "collection");
    if (!safeGet(state.collections, collectionId)) {
      throw new DomainError("collection_not_found", `Collection not found: ${collectionId}`);
    }
    return { state, collectionId };
  }

  if (collection !== undefined) {
    const name = checkName(collection);
    // Reserved keys are only invalid as IDs (the explicit collectionId path); as a name, "constructor" is just
    // text. The id lookup below is own-property only, so it cannot reach Object.prototype.
    const byId = safeGet(state.collections, name);
    if (byId) return { state, collectionId: byId.id };
    const byName = findByName(state, name);
    if (byName) return { state, collectionId: byName.id };
    if (actor.kind === "agent") {
      throw new DomainError("collection_not_found", `Collection not found: ${name} (agents cannot create collections)`);
    }
    assertCollectionRoom(state, name);
    const created = createCollection(state, ctx, { name });
    return { state: created.state, collectionId: created.value.id };
  }

  const origin = input.origin ?? actor.kind;
  if (input.applyDefault === false || input.migrating || origin === "import" || origin === "system") {
    return { state, collectionId: null };
  }

  const prefix = parseTitlePrefix(input.title);
  const byPrefix = prefix === null ? undefined : findByName(state, prefix);
  if (byPrefix) return { state, collectionId: byPrefix.id };

  const unsorted = findByName(state, UNSORTED_NAME);
  if (unsorted) return { state, collectionId: unsorted.id };
  try {
    assertCollectionRoom(state, UNSORTED_NAME);
  } catch (e) {
    if (e instanceof DomainError && e.code === "too_large") return { state, collectionId: null }; // cap reached: no default
    throw e;
  }
  const id = Object.hasOwn(state.collections, UNSORTED_ID) ? undefined : UNSORTED_ID;
  const created = createCollection(state, ctx, {
    name: UNSORTED_NAME,
    id,
    description: "Memories without a more specific collection",
  });
  return { state: created.state, collectionId: created.value.id };
}
