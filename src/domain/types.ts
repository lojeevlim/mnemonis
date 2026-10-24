/**
 * Mnemonis domain types. Everything here is JSON-safe plain data so the whole
 * WorkspaceState can be serialized, persisted, or moved to a backend/MCP service.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Metadata = Record<string, Json>;

export const BUILT_IN_MEMORY_TYPES = [
  "personal_context",
  "preference",
  "project",
  "technical_decision",
  "fact",
  "research",
  "procedure",
  "meeting_note",
  "task",
  "reference",
] as const;
export type BuiltInMemoryType = (typeof BUILT_IN_MEMORY_TYPES)[number];
/** Open union: built-ins plus any custom type string. */
export type MemoryType = BuiltInMemoryType | (string & {});

export type MemoryStatus = "draft" | "committed" | "archived" | "conflict";

export interface MemoryProvenance {
  /** e.g. 'user' | 'agent' | 'import' | 'demo' */
  origin: string;
  createdBy: string;
}

/** Fields that never change after creation. */
export interface MemoryIdentity {
  id: string;
  createdAt: string;
  source: string;
  provenance: MemoryProvenance;
}

/** The versioned (revisioned) fields of a memory. */
export interface MemorySnapshot {
  title: string;
  /** Markdown. Untrusted data: never evaluated or interpreted by the domain. */
  content: string;
  type: MemoryType;
  tags: string[];
  collectionId: string | null;
  archived: boolean;
  metadata: Metadata;
}

export type MemoryFieldName = keyof MemorySnapshot;
export const MEMORY_FIELDS: readonly MemoryFieldName[] = [
  "title",
  "content",
  "type",
  "tags",
  "collectionId",
  "archived",
  "metadata",
];
export type MemoryFieldValue = string | string[] | boolean | null | Metadata;

/** Materialized view of a memory on one branch (derived, never stored). */
export interface Memory extends MemoryIdentity, MemorySnapshot {
  status: MemoryStatus;
  branchId: string;
  updatedAt: string;
  /** Latest revision visible on the branch (draft or committed). */
  revisionId: string;
}

export interface Revision {
  id: string;
  memoryId: string;
  branchId: string;
  snapshot: MemorySnapshot;
  parentRevisionId: string | null;
  /** null = uncommitted draft. Stamped exactly once when committed. */
  commitId: string | null;
  createdAt: string;
  author: string;
}

export interface RelationProvenance {
  origin: "user" | "process";
  createdBy: string;
  /** Name of the producing process/agent when origin === 'process'. */
  process?: string;
  demo?: boolean;
}

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  provenance: RelationProvenance;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  headCommitId: string | null;
  baseCommitId: string | null;
}

export type ChangeKind = "create" | "update" | "archive" | "restore";

export interface CommitChange {
  memoryId: string;
  revisionId: string;
  kind: ChangeKind;
}

/**
 * A commit records changes relative to its FIRST parent. The full snapshot
 * (memoryId -> revisionId) is reconstructed by replaying changes along the
 * first-parent chain (see commitTree / snapshotAtCommit).
 */
export interface Commit {
  id: string;
  branchId: string;
  parentIds: string[];
  message: string;
  author: string;
  timestamp: string;
  changes: CommitChange[];
}

export interface ConflictResolution {
  choice: "ours" | "theirs" | "manual";
  value: MemoryFieldValue;
}

export interface Conflict {
  id: string;
  memoryId: string;
  field: MemoryFieldName;
  base: MemoryFieldValue | undefined;
  ours: MemoryFieldValue;
  theirs: MemoryFieldValue;
  resolution: ConflictResolution | null;
}

export interface PendingMerge {
  sourceBranchId: string;
  targetBranchId: string;
  baseCommitId: string | null;
  message: string;
  author: string;
  /** Auto-merged snapshots (conflicted fields default to "ours" until resolved). */
  merged: Record<string, MemorySnapshot>;
  conflicts: Conflict[];
}

export type MergeResult =
  | { status: "up-to-date" }
  | { status: "merged"; commitId: string }
  | { status: "conflicts"; conflicts: Conflict[] };

export interface WorkspaceState {
  schemaVersion: number;
  currentBranchId: string;
  memories: Record<string, MemoryIdentity>;
  revisions: Record<string, Revision>;
  commits: Record<string, Commit>;
  branches: Record<string, Branch>;
  relations: Record<string, Relation>;
  collections: Record<string, Collection>;
  pendingMerge: PendingMerge | null;
}

/** Every mutation returns the next state plus a value. */
export interface Mutation<T = void> {
  state: WorkspaceState;
  value: T;
}
