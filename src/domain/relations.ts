import { DomainError, type DomainContext } from "./context";
import type { Collection, Mutation, Relation, RelationProvenance, WorkspaceState } from "./types";
import { assertSafeId, requireText, safeGet } from "./util";
import { listMemories } from "./queries";

export function addRelation(
  state: WorkspaceState,
  ctx: DomainContext,
  args: {
    fromId: string;
    toId: string;
    label: string;
    provenance: RelationProvenance;
    id?: string;
  },
): Mutation<Relation> {
  const label = requireText(args.label, "label");
  if (args.fromId === args.toId) throw new DomainError("invalid_input", "A memory cannot relate to itself");
  for (const id of [args.fromId, args.toId]) {
    if (!safeGet(state.memories, id)) throw new DomainError("memory_not_found", `Memory not found: ${id}`);
  }
  const dup = Object.values(state.relations).some(
    (r) => r.fromId === args.fromId && r.toId === args.toId && r.label === label,
  );
  if (dup) throw new DomainError("duplicate_relation", "Relation already exists");
  if (args.id !== undefined) assertSafeId(args.id, "relation");
  const rel: Relation = {
    id: args.id ?? ctx.newId("rel"),
    fromId: args.fromId,
    toId: args.toId,
    label,
    provenance: args.provenance,
    createdAt: ctx.now(),
  };
  return { state: { ...state, relations: { ...state.relations, [rel.id]: rel } }, value: rel };
}

export function removeRelation(state: WorkspaceState, args: { id: string }): Mutation {
  if (!safeGet(state.relations, args.id)) throw new DomainError("relation_not_found", `Relation not found: ${args.id}`);
  const relations = { ...state.relations };
  delete relations[args.id];
  return { state: { ...state, relations }, value: undefined };
}

export function listRelations(state: WorkspaceState, memoryId?: string): Relation[] {
  const all = Object.values(state.relations);
  return memoryId ? all.filter((r) => r.fromId === memoryId || r.toId === memoryId) : all;
}

export function createCollection(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { name: string; description?: string; id?: string },
): Mutation<Collection> {
  const name = requireText(args.name, "name");
  const col: Collection = {
    id: args.id ?? ctx.newId("col"),
    name,
    description: args.description ?? "",
    createdAt: ctx.now(),
  };
  assertSafeId(col.id, "collection");
  if (safeGet(state.collections, col.id)) throw new DomainError("duplicate_id", `Collection exists: ${col.id}`);
  return { state: { ...state, collections: { ...state.collections, [col.id]: col } }, value: col };
}

export function updateCollection(
  state: WorkspaceState,
  args: { id: string; name?: string; description?: string },
): Mutation<Collection> {
  const cur = safeGet(state.collections, args.id);
  if (!cur) throw new DomainError("collection_not_found", `Collection not found: ${args.id}`);
  const next: Collection = {
    ...cur,
    ...(args.name !== undefined && { name: requireText(args.name, "name") }),
    ...(args.description !== undefined && { description: args.description }),
  };
  return { state: { ...state, collections: { ...state.collections, [cur.id]: next } }, value: next };
}

/** Refuses to delete a collection any branch view still references. */
export function deleteCollection(state: WorkspaceState, args: { id: string }): Mutation {
  if (!safeGet(state.collections, args.id)) throw new DomainError("collection_not_found", `Collection not found: ${args.id}`);
  for (const branchId of Object.keys(state.branches)) {
    if (listMemories(state, branchId).some((m) => m.collectionId === args.id)) {
      throw new DomainError("collection_not_empty", "Collection still has memories");
    }
  }
  const collections = { ...state.collections };
  delete collections[args.id];
  return { state: { ...state, collections }, value: undefined };
}
