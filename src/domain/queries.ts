import { DomainError } from "./context";
import type {
  Branch,
  ChangeKind,
  Commit,
  Memory,
  MemorySnapshot,
  Revision,
  WorkspaceState,
} from "./types";
import { deepEqual, safeGet } from "./util";

/** memoryId -> revisionId */
export type Tree = Record<string, string>;

export interface PendingChange {
  memoryId: string;
  revisionId: string;
  kind: ChangeKind;
  title: string;
}

export function getBranch(state: WorkspaceState, branchId: string): Branch {
  const b = safeGet(state.branches, branchId);
  if (!b) throw new DomainError("branch_not_found", `Branch not found: ${branchId}`);
  return b;
}

export function getCommit(state: WorkspaceState, commitId: string): Commit {
  const c = safeGet(state.commits, commitId);
  if (!c) throw new DomainError("commit_not_found", `Version not found: ${commitId}`);
  return c;
}

export function getRevision(state: WorkspaceState, revisionId: string): Revision {
  const r = safeGet(state.revisions, revisionId);
  if (!r) throw new DomainError("revision_not_found", `Revision not found: ${revisionId}`);
  return r;
}

/** Reconstructs the memoryId -> revisionId map at a commit by replaying first-parent changes. */
export function commitTree(state: WorkspaceState, commitId: string | null): Tree {
  const chain: Commit[] = [];
  let cur: string | null = commitId;
  while (cur) {
    const c = getCommit(state, cur);
    chain.push(c);
    cur = c.parentIds[0] ?? null;
  }
  // Null prototype: a (hostile) memory id such as "__proto__" becomes a plain own key.
  const tree: Tree = Object.create(null) as Tree;
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const ch of chain[i].changes) tree[ch.memoryId] = ch.revisionId;
  }
  return tree;
}

export function branchTree(state: WorkspaceState, branchId: string): Tree {
  return commitTree(state, getBranch(state, branchId).headCommitId);
}

/** Full snapshot (memoryId -> MemorySnapshot) at a commit. */
export function snapshotAtCommit(
  state: WorkspaceState,
  commitId: string | null,
): Record<string, MemorySnapshot> {
  const out: Record<string, MemorySnapshot> = {};
  for (const [mid, rid] of Object.entries(commitTree(state, commitId))) {
    out[mid] = getRevision(state, rid).snapshot;
  }
  return out;
}

/**
 * Latest uncommitted revision per memory on a branch (insertion order = append order).
 * A draft only counts when its chain of drafts is rooted at the memory's CURRENT branch-tree
 * revision. Drafts left over from before the tree moved (e.g. a no-op draft that survived a
 * merge) are stale and ignored, so they can never shadow or revert newer committed content.
 */
export function pendingRevisionMap(
  state: WorkspaceState,
  branchId: string,
): Record<string, Revision> {
  const tree = branchTree(state, branchId);
  const out: Record<string, Revision> = {};
  for (const r of Object.values(state.revisions)) {
    if (r.commitId !== null || r.branchId !== branchId) continue;
    if (draftBase(state, r) !== (safeGet(tree, r.memoryId) ?? null)) continue;
    out[r.memoryId] = r;
  }
  return out;
}

/** The non-draft revision id (or null) that a draft chain is based on. */
function draftBase(state: WorkspaceState, draft: Revision): string | null {
  const seen = new Set<string>([draft.id]);
  let cur = draft;
  while (cur.parentRevisionId !== null) {
    const parent = safeGet(state.revisions, cur.parentRevisionId);
    if (!parent || parent.commitId !== null || parent.branchId !== draft.branchId || seen.has(parent.id)) break;
    seen.add(parent.id);
    cur = parent;
  }
  return cur.parentRevisionId;
}

export function changeKind(before: MemorySnapshot | undefined, after: MemorySnapshot): ChangeKind {
  if (!before) return "create";
  if (!before.archived && after.archived) return "archive";
  if (before.archived && !after.archived) return "restore";
  return "update";
}

/** Drafts whose content actually differs from the committed state of the branch. */
export function pendingChanges(
  state: WorkspaceState,
  branchId: string = state.currentBranchId,
): PendingChange[] {
  const tree = branchTree(state, branchId);
  const out: PendingChange[] = [];
  for (const [memoryId, rev] of Object.entries(pendingRevisionMap(state, branchId))) {
    const committedId = safeGet(tree, memoryId);
    const committed = committedId ? getRevision(state, committedId).snapshot : undefined;
    if (committed && deepEqual(committed, rev.snapshot)) continue;
    out.push({
      memoryId,
      revisionId: rev.id,
      kind: changeKind(committed, rev.snapshot),
      title: rev.snapshot.title,
    });
  }
  return out;
}

/** Latest revision id for a memory on a branch (draft first, else committed). */
export function latestRevisionId(
  state: WorkspaceState,
  branchId: string,
  memoryId: string,
): string | null {
  const pending = safeGet(pendingRevisionMap(state, branchId), memoryId);
  if (pending) return pending.id;
  return safeGet(branchTree(state, branchId), memoryId) ?? null;
}

export function listMemories(
  state: WorkspaceState,
  branchId: string = state.currentBranchId,
): Memory[] {
  const tree = branchTree(state, branchId);
  const pending = pendingRevisionMap(state, branchId);
  const pm = state.pendingMerge;
  const conflicted = new Set(
    pm && pm.targetBranchId === branchId
      ? pm.conflicts.filter((c) => !c.resolution).map((c) => c.memoryId)
      : [],
  );
  const ids = new Set([...Object.keys(tree), ...Object.keys(pending)]);
  const out: Memory[] = [];
  for (const id of ids) {
    const identity = safeGet(state.memories, id);
    if (!identity) continue;
    const draft = safeGet(pending, id);
    const treeRevId = safeGet(tree, id);
    const rev = draft ?? getRevision(state, treeRevId as string);
    const committed = treeRevId ? getRevision(state, treeRevId).snapshot : undefined;
    const isDraft = !!draft && !(committed && deepEqual(committed, draft.snapshot));
    const snap = rev.snapshot;
    const status = conflicted.has(id)
      ? "conflict"
      : isDraft
        ? "draft"
        : snap.archived
          ? "archived"
          : "committed";
    out.push({
      ...identity,
      ...snap,
      tags: [...snap.tags],
      status,
      branchId,
      updatedAt: rev.createdAt,
      revisionId: rev.id,
    });
  }
  return out.sort((a, b) =>
    a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : a.updatedAt < b.updatedAt ? 1 : -1,
  );
}

export function getMemory(
  state: WorkspaceState,
  memoryId: string,
  branchId: string = state.currentBranchId,
): Memory | undefined {
  return listMemories(state, branchId).find((m) => m.id === memoryId);
}

/** Revisions of a memory visible on a branch, newest first (follows parentRevisionId). */
export function memoryHistory(
  state: WorkspaceState,
  memoryId: string,
  branchId: string = state.currentBranchId,
): Revision[] {
  const out: Revision[] = [];
  let cur = latestRevisionId(state, branchId, memoryId);
  while (cur) {
    const r = getRevision(state, cur);
    out.push(r);
    cur = r.parentRevisionId;
  }
  return out;
}

/** All ancestor commits of a branch head (inclusive), newest first. */
export function commitLog(
  state: WorkspaceState,
  branchId: string = state.currentBranchId,
): Commit[] {
  const head = getBranch(state, branchId).headCommitId;
  const seen = new Map<string, Commit>();
  const queue = head ? [head] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    const c = getCommit(state, id);
    seen.set(id, c);
    queue.push(...c.parentIds);
  }
  const order = [...seen.values()];
  return order
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.timestamp === b.c.timestamp ? a.i - b.i : a.c.timestamp < b.c.timestamp ? 1 : -1))
    .map((x) => x.c);
}

export function ancestorSet(state: WorkspaceState, commitId: string | null): Set<string> {
  const seen = new Set<string>();
  const stack = commitId ? [commitId] : [];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...getCommit(state, id).parentIds);
  }
  return seen;
}

/** Nearest common ancestor commit of two commits (null when histories are unrelated). */
export function mergeBase(
  state: WorkspaceState,
  a: string | null,
  b: string | null,
): string | null {
  const ancestorsOfA = ancestorSet(state, a);
  const seen = new Set<string>();
  const queue = b ? [b] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (ancestorsOfA.has(id)) return id;
    queue.push(...getCommit(state, id).parentIds);
  }
  return null;
}
