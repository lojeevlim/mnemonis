import { DomainError, type DomainContext } from "./context";
import {
  ancestorSet,
  branchTree,
  changeKind,
  getBranch,
  getRevision,
  mergeBase,
  pendingChanges,
  commitTree,
} from "./queries";
import {
  MEMORY_FIELDS,
  type Commit,
  type CommitChange,
  type Conflict,
  type MemoryFieldName,
  type MemoryFieldValue,
  type Metadata,
  type MemorySnapshot,
  type MergeResult,
  type Mutation,
  type PendingMerge,
  type Revision,
  type WorkspaceState,
} from "./types";
import { checkCollection } from "./memoryOps";
import { cloneJson, deepEqual, isJsonValue, isPlainObject, normalizeTags, requireText, safeGet } from "./util";

function mergeSnapshots(
  base: MemorySnapshot | undefined,
  ours: MemorySnapshot,
  theirs: MemorySnapshot,
): { merged: MemorySnapshot; conflicts: Omit<Conflict, "id" | "memoryId" | "resolution">[] } {
  const merged = cloneJson(ours) as unknown as Record<string, unknown>;
  const conflicts: Omit<Conflict, "id" | "memoryId" | "resolution">[] = [];
  for (const field of MEMORY_FIELDS) {
    const o = ours[field] as MemoryFieldValue;
    const t = theirs[field] as MemoryFieldValue;
    const b = base?.[field] as MemoryFieldValue | undefined;
    if (deepEqual(o, t)) continue;
    if (base && deepEqual(b, o)) merged[field] = cloneJson(t);
    else if (base && deepEqual(b, t)) continue; // only ours changed
    else conflicts.push({ field, base: b, ours: o, theirs: t });
  }
  return { merged: merged as unknown as MemorySnapshot, conflicts };
}

/**
 * Starts a 3-way merge of `sourceBranchId` into `targetBranchId` (default: current).
 * Clean merges are committed immediately (merge commit with parents [targetHead, sourceHead]).
 * With conflicts the state records `pendingMerge`; call resolveConflict for each and then completeMerge.
 * Merge is field-level on memory snapshots; `content` is merged as a whole field.
 */
export function mergeBranch(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { sourceBranchId: string; targetBranchId?: string; author: string; message?: string },
): Mutation<MergeResult> {
  const targetId = args.targetBranchId ?? state.currentBranchId;
  const source = getBranch(state, args.sourceBranchId);
  const target = getBranch(state, targetId);
  if (source.id === target.id) throw new DomainError("invalid_input", "Cannot merge a branch into itself");
  if (state.pendingMerge) throw new DomainError("merge_in_progress", "A merge is already in progress");
  // pendingChanges ignores no-op drafts (equal to the committed state) and pendingRevisionMap ignores
  // stale ones (rooted at a superseded tree revision), so a leftover draft can neither block nor
  // shadow the merge result.
  if (pendingChanges(state, target.id).length > 0) {
    throw new DomainError("uncommitted_changes", "Save a version or discard drafts on the target branch before merging");
  }
  if (!source.headCommitId || ancestorSet(state, target.headCommitId).has(source.headCommitId)) {
    return { state, value: { status: "up-to-date" } };
  }

  const baseCommitId = mergeBase(state, target.headCommitId, source.headCommitId);
  const baseTree = commitTree(state, baseCommitId);
  const oursTree = branchTree(state, target.id);
  const theirsTree = branchTree(state, source.id);
  const snap = (rid: string | undefined) => (rid ? getRevision(state, rid).snapshot : undefined);

  const merged: Record<string, MemorySnapshot> = {};
  const conflicts: Conflict[] = [];
  for (const memoryId of Object.keys(theirsTree)) {
    const theirs = snap(safeGet(theirsTree, memoryId)) as MemorySnapshot;
    const ours = snap(safeGet(oursTree, memoryId));
    if (!ours) {
      merged[memoryId] = cloneJson(theirs);
      continue;
    }
    const r = mergeSnapshots(snap(safeGet(baseTree, memoryId)), ours, theirs);
    merged[memoryId] = r.merged;
    for (const c of r.conflicts) {
      conflicts.push({ ...c, id: ctx.newId("conflict"), memoryId, resolution: null });
    }
  }

  const pending: PendingMerge = {
    sourceBranchId: source.id,
    targetBranchId: target.id,
    baseCommitId,
    message: args.message?.trim() || `Merge ${source.name} into ${target.name}`,
    author: args.author,
    merged,
    conflicts,
  };
  if (conflicts.length > 0) {
    return { state: { ...state, pendingMerge: pending }, value: { status: "conflicts", conflicts } };
  }
  const done = applyMerge(state, ctx, pending);
  return { state: done.state, value: { status: "merged", commitId: done.value.id } };
}

const wrongType = (field: string) => new DomainError("invalid_input", `Manual value has the wrong type for ${field}`);

/** Same rules as memoryOps.updateMemory: normalised tags, existing collection, non-empty title/type, JSON-safe metadata. */
function validateManualValue(state: WorkspaceState, field: MemoryFieldName, v: MemoryFieldValue): MemoryFieldValue {
  switch (field) {
    case "title":
    case "type":
      if (typeof v !== "string") throw wrongType(field);
      return requireText(v, field);
    case "content":
      if (typeof v !== "string") throw wrongType(field);
      return v;
    case "tags":
      if (!Array.isArray(v) || v.some((t) => typeof t !== "string")) throw wrongType(field);
      return normalizeTags(v);
    case "collectionId":
      if (v !== null && typeof v !== "string") throw wrongType(field);
      checkCollection(state, v);
      return v;
    case "archived":
      if (typeof v !== "boolean") throw wrongType(field);
      return v;
    case "metadata":
      if (!isPlainObject(v) || !isJsonValue(v)) throw wrongType(field);
      return cloneJson(v) as Metadata;
  }
}

/** Records the choice for one conflict. `manual` requires a value matching the field's type. */
export function resolveConflict(
  state: WorkspaceState,
  args: { conflictId: string; choice: "ours" | "theirs" | "manual"; value?: MemoryFieldValue },
): Mutation {
  const pm = state.pendingMerge;
  const conflict = pm?.conflicts.find((c) => c.id === args.conflictId);
  if (!pm || !conflict) throw new DomainError("conflict_not_found", `Conflict not found: ${args.conflictId}`);
  let value: MemoryFieldValue;
  if (args.choice === "ours") value = conflict.ours;
  else if (args.choice === "theirs") value = conflict.theirs;
  else {
    if (args.value === undefined) throw new DomainError("invalid_input", "Manual resolution requires a value");
    value = validateManualValue(state, conflict.field, args.value);
  }
  const conflicts = pm.conflicts.map((c) =>
    c.id === conflict.id ? { ...c, resolution: { choice: args.choice, value } } : c,
  );
  return { state: { ...state, pendingMerge: { ...pm, conflicts } }, value: undefined };
}

export function completeMerge(state: WorkspaceState, ctx: DomainContext): Mutation<Commit> {
  const pm = state.pendingMerge;
  if (!pm) throw new DomainError("no_merge", "No merge in progress");
  if (pm.conflicts.some((c) => !c.resolution)) {
    throw new DomainError("unresolved_conflicts", "Resolve all conflicts before completing the merge");
  }
  const merged: Record<string, MemorySnapshot> = cloneJson(pm.merged);
  for (const c of pm.conflicts) {
    (merged[c.memoryId] as unknown as Record<string, unknown>)[c.field] = (c.resolution as { value: unknown }).value;
  }
  return applyMerge(state, ctx, { ...pm, merged });
}

export function abortMerge(state: WorkspaceState): Mutation {
  if (!state.pendingMerge) throw new DomainError("no_merge", "No merge in progress");
  return { state: { ...state, pendingMerge: null }, value: undefined };
}

function applyMerge(state: WorkspaceState, ctx: DomainContext, pm: PendingMerge): Mutation<Commit> {
  const source = getBranch(state, pm.sourceBranchId);
  const target = getBranch(state, pm.targetBranchId);
  const oursTree = branchTree(state, target.id);
  const commitId = ctx.newId("commit");
  const timestamp = ctx.now();
  const revisions = { ...state.revisions };
  const changes: CommitChange[] = [];

  for (const [memoryId, snapshot] of Object.entries(pm.merged)) {
    const oursRevId = safeGet(oursTree, memoryId);
    const oursRev = oursRevId ? getRevision(state, oursRevId) : undefined;
    if (oursRev && deepEqual(oursRev.snapshot, snapshot)) continue;
    const rev: Revision = {
      id: ctx.newId("rev"),
      memoryId,
      branchId: target.id,
      snapshot,
      parentRevisionId: oursRev?.id ?? null,
      commitId,
      createdAt: timestamp,
      author: pm.author,
    };
    revisions[rev.id] = rev;
    changes.push({ memoryId, revisionId: rev.id, kind: changeKind(oursRev?.snapshot, snapshot) });
  }
  const commit: Commit = {
    id: commitId,
    branchId: target.id,
    parentIds: [target.headCommitId, source.headCommitId].filter((x): x is string => x !== null),
    message: pm.message,
    author: pm.author,
    timestamp,
    changes,
  };
  return {
    state: {
      ...state,
      revisions,
      commits: { ...state.commits, [commit.id]: commit },
      branches: { ...state.branches, [target.id]: { ...target, headCommitId: commit.id } },
      pendingMerge: null,
    },
    value: commit,
  };
}
