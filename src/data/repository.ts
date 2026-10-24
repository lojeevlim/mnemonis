import type {
  Branch,
  Collection,
  Commit,
  CreateMemoryInput,
  Memory,
  MemoryFieldValue,
  MemoryPatch,
  MergeResult,
  Mutation,
  Relation,
  RelationProvenance,
  WorkspaceState,
} from "../domain";

export type LoadIssue = "missing" | "corrupt" | "version-mismatch" | "storage-unavailable";

export interface RepositoryStatus {
  /** Why the last load fell back to a fresh/seed workspace (null = loaded persisted data). */
  loadIssue: LoadIssue | null;
  /** Last persistence failure (quota, disabled storage...). In-memory state is still valid. */
  persistError: string | null;
}

/**
 * Async facade over the pure domain operations. Reads are done with the pure
 * domain query functions on the returned WorkspaceState; every mutation returns
 * the next state (already persisted) plus a value. Swappable for a backend later.
 * Mutations reject with DomainError on invalid input; state is unchanged then.
 */
export interface MemoryRepository {
  load(): Promise<WorkspaceState>;
  save(state: WorkspaceState): Promise<void>;
  /** Pretty JSON of the workspace for download. */
  export(): Promise<string>;
  /** Replace the workspace from exported JSON (validated). */
  importJson(json: string): Promise<WorkspaceState>;
  /** Reset to the demo seed (default) or an empty workspace. */
  reset(opts?: { seed?: boolean }): Promise<WorkspaceState>;
  getStatus(): RepositoryStatus;

  createMemory(input: CreateMemoryInput): Promise<Mutation<Memory>>;
  updateMemory(args: { id: string; patch: MemoryPatch; author: string; branchId?: string }): Promise<Mutation<Memory>>;
  archiveMemory(args: { id: string; author: string; branchId?: string }): Promise<Mutation<Memory>>;
  restoreMemory(args: { id: string; author: string; branchId?: string }): Promise<Mutation<Memory>>;
  rollbackMemory(args: { memoryId: string; toRevisionId: string; author: string; branchId?: string }): Promise<Mutation<Memory>>;

  addRelation(args: { fromId: string; toId: string; label: string; provenance: RelationProvenance }): Promise<Mutation<Relation>>;
  removeRelation(args: { id: string }): Promise<Mutation>;

  createCollection(args: { name: string; description?: string }): Promise<Mutation<Collection>>;
  updateCollection(args: { id: string; name?: string; description?: string }): Promise<Mutation<Collection>>;
  deleteCollection(args: { id: string }): Promise<Mutation>;

  commit(args: { message: string; author: string; branchId?: string }): Promise<Mutation<Commit>>;
  createBranch(args: { name: string; fromCommitId?: string | null; switchTo?: boolean }): Promise<Mutation<Branch>>;
  switchBranch(args: { branchId: string }): Promise<Mutation>;

  merge(args: { sourceBranchId: string; targetBranchId?: string; author: string; message?: string }): Promise<Mutation<MergeResult>>;
  resolveConflict(args: { conflictId: string; choice: "ours" | "theirs" | "manual"; value?: MemoryFieldValue }): Promise<Mutation>;
  completeMerge(): Promise<Mutation<Commit>>;
  abortMerge(): Promise<Mutation>;
}
