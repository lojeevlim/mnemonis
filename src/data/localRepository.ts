import {
  abortMerge,
  addRelation,
  archiveMemory,
  commitDrafts,
  completeMerge,
  createBranch,
  createCollection,
  createEmptyWorkspace,
  createMemory,
  deleteCollection,
  mergeBranch,
  removeRelation,
  resolveConflict,
  restoreMemory,
  rollbackMemory,
  switchBranch,
  updateCollection,
  updateMemory,
  validateWorkspaceState,
  MAX_IMPORT_BYTES,
  SCHEMA_VERSION,
  type DomainContext,
  type Mutation,
  type WorkspaceState,
} from "../domain";
import { createSeedWorkspace } from "./seed";
import { createSystemContext } from "./systemContext";
import type { LoadIssue, MemoryRepository, RepositoryStatus } from "./repository";

export const STORAGE_KEY = `mnemonis.workspace.v${SCHEMA_VERSION}`;
export const CORRUPT_BACKUP_KEY = `${STORAGE_KEY}.corrupt`;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalRepositoryOptions {
  storage?: StorageLike | null;
  ctx?: DomainContext;
  /** Builds the initial workspace when nothing valid is stored. */
  createInitial?: () => WorkspaceState;
}

interface Envelope {
  schemaVersion: number;
  state: WorkspaceState;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access can throw (privacy mode / sandboxed iframes)
  }
}

export class LocalRepository implements MemoryRepository {
  private state: WorkspaceState | null = null;
  private readonly storage: StorageLike | null;
  private readonly ctx: DomainContext;
  private readonly createInitial: () => WorkspaceState;
  private status: RepositoryStatus = { loadIssue: null, persistError: null };

  constructor(opts: LocalRepositoryOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.ctx = opts.ctx ?? createSystemContext();
    this.createInitial = opts.createInitial ?? createSeedWorkspace;
  }

  getStatus(): RepositoryStatus {
    return { ...this.status };
  }

  async load(): Promise<WorkspaceState> {
    const { state, issue } = this.readStored();
    this.status.loadIssue = issue;
    this.state = state ?? this.createInitial();
    if (!state) this.persist();
    return this.state;
  }

  save(state: WorkspaceState): Promise<void> {
    return this.enqueue(() => {
      this.state = state;
      this.persist();
    });
  }

  export(): Promise<string> {
    return this.enqueue(async () =>
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, state: await this.current() }, null, 2),
    );
  }

  importJson(json: string): Promise<WorkspaceState> {
    return this.enqueue(() => this.doImport(json));
  }

  private doImport(json: string): WorkspaceState {
    if (json.length > MAX_IMPORT_BYTES) throw new Error("Import failed: file is too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Import failed: not valid JSON");
    }
    const candidate = (parsed as Partial<Envelope> | null)?.state ?? parsed;
    const v = validateWorkspaceState(candidate);
    if (!v.ok) throw new Error(`Import failed: ${v.reason}`);
    this.state = v.state;
    this.persist();
    return v.state;
  }

  reset(opts: { seed?: boolean } = {}): Promise<WorkspaceState> {
    return this.enqueue(() => {
      const next = opts.seed === false ? createEmptyWorkspace() : this.createInitial();
      this.state = next;
      this.status.loadIssue = null;
      this.persist();
      return next;
    });
  }

  // ---- mutations -------------------------------------------------------

  createMemory: MemoryRepository["createMemory"] = (input) => this.apply((s, c) => createMemory(s, c, input));
  updateMemory: MemoryRepository["updateMemory"] = (a) => this.apply((s, c) => updateMemory(s, c, a));
  archiveMemory: MemoryRepository["archiveMemory"] = (a) => this.apply((s, c) => archiveMemory(s, c, a));
  restoreMemory: MemoryRepository["restoreMemory"] = (a) => this.apply((s, c) => restoreMemory(s, c, a));
  rollbackMemory: MemoryRepository["rollbackMemory"] = (a) => this.apply((s, c) => rollbackMemory(s, c, a));
  addRelation: MemoryRepository["addRelation"] = (a) => this.apply((s, c) => addRelation(s, c, a));
  removeRelation: MemoryRepository["removeRelation"] = (a) => this.apply((s) => removeRelation(s, a));
  createCollection: MemoryRepository["createCollection"] = (a) => this.apply((s, c) => createCollection(s, c, a));
  updateCollection: MemoryRepository["updateCollection"] = (a) => this.apply((s) => updateCollection(s, a));
  deleteCollection: MemoryRepository["deleteCollection"] = (a) => this.apply((s) => deleteCollection(s, a));
  commit: MemoryRepository["commit"] = (a) => this.apply((s, c) => commitDrafts(s, c, a));
  createBranch: MemoryRepository["createBranch"] = (a) => this.apply((s, c) => createBranch(s, c, a));
  switchBranch: MemoryRepository["switchBranch"] = (a) => this.apply((s) => switchBranch(s, a));
  merge: MemoryRepository["merge"] = (a) => this.apply((s, c) => mergeBranch(s, c, a));
  resolveConflict: MemoryRepository["resolveConflict"] = (a) => this.apply((s) => resolveConflict(s, a));
  completeMerge: MemoryRepository["completeMerge"] = () => this.apply((s, c) => completeMerge(s, c));
  abortMerge: MemoryRepository["abortMerge"] = () => this.apply((s) => abortMerge(s));

  // ---- internals ---------------------------------------------------------

  private async current(): Promise<WorkspaceState> {
    return this.state ?? (await this.load());
  }

  /** Tail of the operation queue. Operations run strictly one after another (a failure does not stall the queue). */
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Serialized read-modify-write: each mutation starts from the state left by the previous one. */
  private apply<T>(fn: (s: WorkspaceState, c: DomainContext) => Mutation<T>): Promise<Mutation<T>> {
    return this.enqueue(async () => {
      const result = fn(await this.current(), this.ctx); // throws => state untouched
      this.state = result.state;
      this.persist();
      return result;
    });
  }

  private readStored(): { state: WorkspaceState | null; issue: LoadIssue | null } {
    if (!this.storage) return { state: null, issue: "storage-unavailable" };
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return { state: null, issue: "storage-unavailable" };
    }
    if (raw === null) return { state: null, issue: "missing" };
    let issue: LoadIssue;
    try {
      const parsed = JSON.parse(raw) as Partial<Envelope> | null;
      const v = validateWorkspaceState(parsed?.state);
      if (v.ok && parsed?.schemaVersion === SCHEMA_VERSION) return { state: v.state, issue: null };
      issue = v.ok ? "corrupt" : v.reason;
    } catch {
      issue = "corrupt";
    }
    // Keep the unreadable payload so data is never silently destroyed. Single slot, FIRST backup
    // wins: a later corrupt load never overwrites an earlier backup (the earliest unreadable
    // payload is the likeliest to be recoverable). "Clear all local data" removes it.
    try {
      if (this.storage.getItem(CORRUPT_BACKUP_KEY) === null) this.storage.setItem(CORRUPT_BACKUP_KEY, raw);
    } catch {
      /* ignore */
    }
    return { state: null, issue };
  }

  private persist(): void {
    if (!this.storage || !this.state) {
      this.status.persistError = this.storage ? null : "Storage unavailable";
      return;
    }
    try {
      const env: Envelope = { schemaVersion: SCHEMA_VERSION, state: this.state };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(env));
      this.status.persistError = null;
    } catch (e) {
      this.status.persistError = e instanceof Error ? e.message : "Failed to persist workspace";
    }
  }
}
