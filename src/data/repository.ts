import type {
  Actor,
  Collection,
  CreateMemoryInput,
  Memory,
  MemoryPatch,
  Mutation,
  Revision,
  Relation,
  RelationProvenance,
  ApproveAllResult,
  BulkFilter,
  RejectAllResult,
  WorkspaceState,
} from "../domain";

export type LoadIssue = "missing" | "corrupt" | "version-mismatch" | "storage-unavailable" | "unauthorized";

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
  /**
   * Optional (server-backed repositories): re-read the source of truth. Resolves the new state when it changed
   * since the last read, null when unchanged. Serialized with mutations.
   */
  refresh?(): Promise<WorkspaceState | null>;

  /**
   * Memory writes take an `actor`: a user's write is saved at once, an agent's write becomes a pending
   * proposal waiting in the Inbox (short term memory).
   */
  createMemory(input: CreateMemoryInput): Promise<Mutation<Memory>>;
  updateMemory(args: { id: string; patch: MemoryPatch; actor: Actor }): Promise<Mutation<Memory>>;
  archiveMemory(args: { id: string; actor: Actor }): Promise<Mutation<Memory>>;
  restoreMemory(args: { id: string; actor: Actor }): Promise<Mutation<Memory>>;
  rollbackMemory(args: { memoryId: string; toRevisionId: string; actor: Actor }): Promise<Mutation<Memory>>;

  /** A user's link is saved at once; an agent's link is pending until a user approves it. */
  addRelation(args: {
    fromId: string;
    toId: string;
    label: string;
    provenance: RelationProvenance;
    actor: Actor;
  }): Promise<Mutation<Relation>>;
  /** User only (an agent actor is refused with "forbidden"). Saved links are deleted; pending/rejected ones are kept as rejected. */
  removeRelation(args: { id: string; actor: Actor }): Promise<Mutation>;

  createCollection(args: { name: string; description?: string }): Promise<Mutation<Collection>>;
  updateCollection(args: { id: string; name?: string; description?: string }): Promise<Mutation<Collection>>;
  deleteCollection(args: { id: string }): Promise<Mutation>;

  /** Review decisions are user-only (the domain refuses agent actors). */
  approve(args: { revisionId: string; actor: Actor }): Promise<Mutation<Revision>>;
  reject(args: { revisionId: string; actor: Actor }): Promise<Mutation<Revision>>;
  approveRelation(args: { relationId: string; actor: Actor }): Promise<Mutation<Relation>>;
  rejectRelation(args: { relationId: string; actor: Actor }): Promise<Mutation<Relation>>;
  /** Cover pending memory proposals AND pending relations (optionally only the given ids). Value = approved/rejected revision ids. */
  approveAll(args: { actor: Actor } & BulkFilter): Promise<Mutation<string[]>>;
  rejectAll(args: { actor: Actor } & BulkFilter): Promise<Mutation<string[]>>;
  /** Same, reporting approved/rejected links and (for approve) the links skipped because they cannot be approved. */
  approveAllDetailed(args: { actor: Actor } & BulkFilter): Promise<Mutation<ApproveAllResult>>;
  rejectAllDetailed(args: { actor: Actor } & BulkFilter): Promise<Mutation<RejectAllResult>>;
}
