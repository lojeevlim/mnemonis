import { DomainError, type DomainContext } from "./context";
import {
  getBranch,
  getRevision,
  latestRevisionId,
  listMemories,
} from "./queries";
import type {
  Memory,
  MemoryProvenance,
  MemorySnapshot,
  MemoryType,
  Metadata,
  Mutation,
  Revision,
  WorkspaceState,
} from "./types";
import { assertSafeId, cloneJson, deepEqual, normalizeTags, requireText, safeGet } from "./util";

export interface CreateMemoryInput {
  /** Optional explicit id (used by seed data); must be unused. */
  id?: string;
  title: string;
  content?: string;
  type?: MemoryType;
  tags?: string[];
  collectionId?: string | null;
  source?: string;
  provenance?: MemoryProvenance;
  metadata?: Metadata;
  author: string;
  branchId?: string;
}

export type MemoryPatch = Partial<
  Pick<MemorySnapshot, "title" | "content" | "type" | "tags" | "collectionId" | "metadata">
>;

function guardBranchWritable(state: WorkspaceState, branchId: string): void {
  getBranch(state, branchId);
  if (state.pendingMerge && state.pendingMerge.targetBranchId === branchId) {
    throw new DomainError("merge_in_progress", "Resolve or abort the in-progress merge first");
  }
}

export function checkCollection(state: WorkspaceState, collectionId: string | null): void {
  if (collectionId !== null && !safeGet(state.collections, collectionId)) {
    throw new DomainError("collection_not_found", `Collection not found: ${collectionId}`);
  }
}

/** Appends a new (draft) revision. Never mutates existing revisions. */
export function appendDraftRevision(
  state: WorkspaceState,
  ctx: DomainContext,
  p: { memoryId: string; branchId: string; snapshot: MemorySnapshot; author: string },
): Mutation<Revision> {
  const rev: Revision = {
    id: ctx.newId("rev"),
    memoryId: p.memoryId,
    branchId: p.branchId,
    snapshot: p.snapshot,
    parentRevisionId: latestRevisionId(state, p.branchId, p.memoryId),
    commitId: null,
    createdAt: ctx.now(),
    author: p.author,
  };
  return { state: { ...state, revisions: { ...state.revisions, [rev.id]: rev } }, value: rev };
}

function currentSnapshot(state: WorkspaceState, branchId: string, memoryId: string): MemorySnapshot {
  const rid = latestRevisionId(state, branchId, memoryId);
  if (!rid) throw new DomainError("memory_not_found", `Memory not found on branch ${branchId}: ${memoryId}`);
  return getRevision(state, rid).snapshot;
}

export function createMemory(
  state: WorkspaceState,
  ctx: DomainContext,
  input: CreateMemoryInput,
): Mutation<Memory> {
  const branchId = input.branchId ?? state.currentBranchId;
  guardBranchWritable(state, branchId);
  const title = requireText(input.title, "title");
  const collectionId = input.collectionId ?? null;
  checkCollection(state, collectionId);
  const id = input.id ?? ctx.newId("mem");
  assertSafeId(id, "memory");
  if (safeGet(state.memories, id)) throw new DomainError("duplicate_id", `Memory id already exists: ${id}`);
  const createdAt = ctx.now();
  const identity = {
    id,
    createdAt,
    source: input.source ?? "manual",
    provenance: input.provenance ?? { origin: "user", createdBy: input.author },
  };
  const snapshot: MemorySnapshot = {
    title,
    content: input.content ?? "",
    type: requireText(input.type ?? "fact", "type"),
    tags: normalizeTags(input.tags),
    collectionId,
    archived: false,
    metadata: cloneJson(input.metadata ?? {}),
  };
  const withIdentity: WorkspaceState = { ...state, memories: { ...state.memories, [id]: identity } };
  const { state: next } = appendDraftRevision(withIdentity, ctx, {
    memoryId: id,
    branchId,
    snapshot,
    author: input.author,
  });
  return { state: next, value: listMemories(next, branchId).find((m) => m.id === id) as Memory };
}

function applySnapshot(
  state: WorkspaceState,
  ctx: DomainContext,
  memoryId: string,
  branchId: string,
  author: string,
  snapshot: MemorySnapshot,
): WorkspaceState {
  const before = currentSnapshot(state, branchId, memoryId);
  if (deepEqual(before, snapshot)) return state; // no-op edits do not create revisions
  return appendDraftRevision(state, ctx, { memoryId, branchId, snapshot, author }).state;
}

export function updateMemory(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { id: string; patch: MemoryPatch; author: string; branchId?: string },
): Mutation<Memory> {
  const branchId = args.branchId ?? state.currentBranchId;
  guardBranchWritable(state, branchId);
  const before = currentSnapshot(state, branchId, args.id);
  if (before.archived) throw new DomainError("memory_archived", "Restore the memory before editing it");
  const { patch } = args;
  const snapshot: MemorySnapshot = {
    ...before,
    ...(patch.title !== undefined && { title: requireText(patch.title, "title") }),
    ...(patch.content !== undefined && { content: patch.content }),
    ...(patch.type !== undefined && { type: requireText(patch.type, "type") }),
    ...(patch.tags !== undefined && { tags: normalizeTags(patch.tags) }),
    ...(patch.collectionId !== undefined && { collectionId: patch.collectionId }),
    ...(patch.metadata !== undefined && { metadata: cloneJson(patch.metadata) }),
  };
  checkCollection(state, snapshot.collectionId);
  const next = applySnapshot(state, ctx, args.id, branchId, args.author, snapshot);
  return { state: next, value: listMemories(next, branchId).find((m) => m.id === args.id) as Memory };
}

function setArchived(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { id: string; author: string; branchId?: string },
  archived: boolean,
): Mutation<Memory> {
  const branchId = args.branchId ?? state.currentBranchId;
  guardBranchWritable(state, branchId);
  const before = currentSnapshot(state, branchId, args.id);
  const next = applySnapshot(state, ctx, args.id, branchId, args.author, { ...before, archived });
  return { state: next, value: listMemories(next, branchId).find((m) => m.id === args.id) as Memory };
}

/** Archive as a DRAFT change (soft delete; nothing is ever removed). */
export const archiveMemory = (
  state: WorkspaceState,
  ctx: DomainContext,
  args: { id: string; author: string; branchId?: string },
) => setArchived(state, ctx, args, true);

export const restoreMemory = (
  state: WorkspaceState,
  ctx: DomainContext,
  args: { id: string; author: string; branchId?: string },
) => setArchived(state, ctx, args, false);

/**
 * Rollback = append a NEW draft revision restoring an earlier revision's snapshot.
 * History is never rewritten.
 */
export function rollbackMemory(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { memoryId: string; toRevisionId: string; author: string; branchId?: string },
): Mutation<Memory> {
  const branchId = args.branchId ?? state.currentBranchId;
  guardBranchWritable(state, branchId);
  const target = getRevision(state, args.toRevisionId);
  if (target.memoryId !== args.memoryId) {
    throw new DomainError("invalid_input", "Revision does not belong to this memory");
  }
  currentSnapshot(state, branchId, args.memoryId); // existence check
  const snapshot = cloneJson(target.snapshot);
  if (snapshot.collectionId !== null && !safeGet(state.collections, snapshot.collectionId)) {
    snapshot.collectionId = null;
  }
  const next = applySnapshot(state, ctx, args.memoryId, branchId, args.author, snapshot);
  return { state: next, value: listMemories(next, branchId).find((m) => m.id === args.memoryId) as Memory };
}

