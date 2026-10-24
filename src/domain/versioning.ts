import { DomainError, type DomainContext } from "./context";
import {
  getBranch,
  getCommit,
  pendingChanges,
} from "./queries";
import type { Branch, Commit, Mutation, Revision, WorkspaceState } from "./types";
import { assertSafeId, requireText, safeGet } from "./util";

/**
 * Commits ALL pending drafts of a branch atomically: every check runs before any
 * state is produced, and the result is a single new state object (all or nothing).
 */
export function commitDrafts(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { message: string; author: string; branchId?: string },
): Mutation<Commit> {
  const branchId = args.branchId ?? state.currentBranchId;
  const branch = getBranch(state, branchId);
  const message = requireText(args.message, "version note");
  if (state.pendingMerge && state.pendingMerge.targetBranchId === branchId) {
    throw new DomainError("merge_in_progress", "Resolve or abort the in-progress merge first");
  }
  const changes = pendingChanges(state, branchId);
  if (changes.length === 0) throw new DomainError("nothing_to_commit", "Nothing to save: no pending drafts");

  const commit: Commit = {
    id: ctx.newId("commit"),
    branchId,
    parentIds: branch.headCommitId ? [branch.headCommitId] : [],
    message,
    author: args.author,
    timestamp: ctx.now(),
    changes: changes.map((c) => ({ memoryId: c.memoryId, revisionId: c.revisionId, kind: c.kind })),
  };
  // Stamp commitId on the committed revisions AND the superseded drafts they were built on
  // (their parentRevisionId chain), so memoryHistory never shows an unstamped intermediate.
  // Drafts the commit does not reference (e.g. a no-op draft equal to the committed state)
  // are left untouched: they stay invisible to history and cannot be committed by mistake.
  const stamp = new Set<string>();
  for (const c of changes) {
    let cur: Revision | undefined = safeGet(state.revisions, c.revisionId);
    while (cur && cur.commitId === null && cur.branchId === branchId && !stamp.has(cur.id)) {
      stamp.add(cur.id);
      cur = safeGet(state.revisions, cur.parentRevisionId);
    }
  }
  const revisions: Record<string, Revision> = {};
  for (const [id, r] of Object.entries(state.revisions)) {
    revisions[id] = stamp.has(id) ? { ...r, commitId: commit.id } : r;
  }
  return {
    state: {
      ...state,
      revisions,
      commits: { ...state.commits, [commit.id]: commit },
      branches: { ...state.branches, [branchId]: { ...branch, headCommitId: commit.id } },
    },
    value: commit,
  };
}

export function createBranch(
  state: WorkspaceState,
  ctx: DomainContext,
  args: { name: string; fromCommitId?: string | null; switchTo?: boolean; id?: string },
): Mutation<Branch> {
  const name = requireText(args.name, "branch name");
  if (Object.values(state.branches).some((b) => b.name === name)) {
    throw new DomainError("duplicate_branch", `Branch name already exists: ${name}`);
  }
  const from =
    args.fromCommitId === undefined ? getBranch(state, state.currentBranchId).headCommitId : args.fromCommitId;
  if (from !== null) getCommit(state, from);
  const branch: Branch = { id: args.id ?? ctx.newId("branch"), name, headCommitId: from, baseCommitId: from };
  assertSafeId(branch.id, "branch");
  if (safeGet(state.branches, branch.id)) throw new DomainError("duplicate_id", `Branch id exists: ${branch.id}`);
  return {
    state: {
      ...state,
      branches: { ...state.branches, [branch.id]: branch },
      currentBranchId: args.switchTo ? branch.id : state.currentBranchId,
    },
    value: branch,
  };
}

export function switchBranch(state: WorkspaceState, args: { branchId: string }): Mutation {
  getBranch(state, args.branchId);
  return { state: { ...state, currentBranchId: args.branchId }, value: undefined };
}

