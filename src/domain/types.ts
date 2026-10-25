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

/** saved = long term; pending = a proposal is waiting for review (short term). */
export type MemoryStatus = "saved" | "pending" | "archived";

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
  /** The project this memory belongs to (null = none). May dangle in history; reads check existence. */
  projectId: string | null;
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
  "projectId",
  "archived",
  "metadata",
];
export type MemoryFieldValue = string | string[] | boolean | null | Metadata;

/** Materialized view of a memory (derived, never stored). */
export interface Memory extends MemoryIdentity, MemorySnapshot {
  status: MemoryStatus;
  /** True when an unreviewed proposal (pending revision) exists for this memory. */
  hasPending: boolean;
  /** savedAt of the current saved revision (createdAt of the proposal for pending-only memories). */
  updatedAt: string;
  /** Current saved revision id (the pending revision id for a memory that has never been saved). */
  revisionId: string;
}

export type RevisionStatus = "saved" | "pending" | "rejected" | "superseded";
export type Origin = "user" | "agent" | "import" | "system";
export const REVISION_STATUSES: readonly RevisionStatus[] = ["saved", "pending", "rejected", "superseded"];
export const ORIGINS: readonly Origin[] = ["user", "agent", "import", "system"];

/** Who performs a write. Agents never save directly: their writes become pending revisions. */
export interface Actor {
  kind: "user" | "agent";
  name: string;
}

/** The single unit of change: one immutable snapshot of one memory plus its review state. */
export interface Revision {
  id: string;
  memoryId: string;
  snapshot: MemorySnapshot;
  parentRevisionId: string | null;
  createdAt: string;
  author: string;
  origin: Origin;
  status: RevisionStatus;
  note: string;
  /** Stamped when the revision becomes saved (user edit or approval). */
  savedAt: string | null;
  /** When it was saved / rejected / superseded. */
  decidedAt: string | null;
}

export interface RelationProvenance {
  origin: "user" | "process";
  createdBy: string;
  /** Name of the producing process/agent when origin === 'process'. */
  process?: string;
  demo?: boolean;
}

/** saved = visible link; pending = proposed by an agent, waiting for review; rejected = kept for the record. */
export type RelationStatus = "saved" | "pending" | "rejected";
export const RELATION_STATUSES: readonly RelationStatus[] = ["saved", "pending", "rejected"];

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  provenance: RelationProvenance;
  createdAt: string;
  /** Absent in older stored data (normalised to "saved" on load / migrate / import). */
  status: RelationStatus;
  /** When the relation was saved / rejected (null while pending). */
  decidedAt: string | null;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** The project this collection is the default folder of (absent / null = none). */
  projectId?: string | null;
}

export type ProjectSourceKind = "repo" | "workspace" | "prefix" | "manual";
export const PROJECT_SOURCE_KINDS: readonly ProjectSourceKind[] = ["repo", "workspace", "prefix", "manual"];

/**
 * Where a project was recognised from. repo = normalised "host/owner/repo"; workspace = opaque client-computed id
 * (never a path); prefix = a title-prefix key; manual = free text typed by a user.
 */
export interface ProjectSource {
  kind: ProjectSourceKind;
  ref: string;
}

export interface Project {
  /** "prj_<16 hex of sha256(key)>" for migrated projects, a fresh safe id for new ones. */
  id: string;
  /** normalizeTitle(name); unique among projects. */
  key: string;
  name: string;
  /** Other normalised keys that resolve to this project (e.g. an old name). */
  aliases: string[];
  sources: ProjectSource[];
  /** Default folder of the project (kept in sync with Collection.projectId). */
  collectionId: string | null;
  createdAt: string;
  createdBy: string;
  /** Created by an agent (not a user) or derived. */
  autoCreated: boolean;
  /** False while an agent-created project has not been approved / acknowledged by a user. */
  confirmed: boolean;
}

export type ChangeKind = "create" | "update" | "archive" | "restore";

export interface WorkspaceState {
  schemaVersion: 3;
  memories: Record<string, MemoryIdentity>;
  revisions: Record<string, Revision>;
  relations: Record<string, Relation>;
  collections: Record<string, Collection>;
  projects: Record<string, Project>;
}

/** Every mutation returns the next state plus a value. */
export interface Mutation<T = void> {
  state: WorkspaceState;
  value: T;
}
