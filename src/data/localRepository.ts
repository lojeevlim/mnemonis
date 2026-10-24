import {
  addRelation,
  approveAll,
  approveAllDetailed,
  approveRelation,
  approveRevision,
  archiveMemory,
  createCollection,
  createEmptyWorkspace,
  createMemory,
  deleteCollection,
  migrateWorkspaceState,
  rejectAll,
  rejectAllDetailed,
  rejectRelation,
  rejectRevision,
  removeRelation,
  restoreMemory,
  rollbackMemory,
  updateCollection,
  updateMemory,
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
/** Pre-refactor (branches / commits) storage key. Read once for migration; NEVER deleted by the app on load. */
export const LEGACY_STORAGE_KEY = "mnemonis.workspace.v1";
/** Separate backup slot for an unreadable legacy v1 payload (the v1 key itself is never modified). */
export const LEGACY_CORRUPT_BACKUP_KEY = `${LEGACY_STORAGE_KEY}.corrupt`;

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
  /** Untrusted until migrateWorkspaceState has validated it. */
  state: unknown;
}

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access can throw (privacy mode / sandboxed iframes)
  }
}

/** Set once the browser workspace was copied to an account, so Settings stops offering the copy. */
export const BROWSER_COPIED_KEY = "mnemonis.browserCopied.v1";

/** True when this browser still holds a workspace from the old "use without an account" mode and it was not copied yet. */
export function hasUncopiedBrowserData(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage || storage.getItem(BROWSER_COPIED_KEY)) return false;
    return storage.getItem(STORAGE_KEY) !== null || storage.getItem(LEGACY_STORAGE_KEY) !== null;
  } catch {
    return false;
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
    // Accepts v1 or v2, wrapped in an export envelope or bare.
    const wrapped = (parsed as Partial<Envelope> | null)?.state;
    const v = migrateWorkspaceState(wrapped ?? parsed);
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
  removeRelation: MemoryRepository["removeRelation"] = (a) => this.apply((s, c) => removeRelation(s, a, c));
  createCollection: MemoryRepository["createCollection"] = (a) => this.apply((s, c) => createCollection(s, c, a));
  updateCollection: MemoryRepository["updateCollection"] = (a) => this.apply((s) => updateCollection(s, a));
  deleteCollection: MemoryRepository["deleteCollection"] = (a) => this.apply((s) => deleteCollection(s, a));
  approve: MemoryRepository["approve"] = (a) => this.apply((s, c) => approveRevision(s, c, a));
  reject: MemoryRepository["reject"] = (a) => this.apply((s, c) => rejectRevision(s, c, a));
  approveRelation: MemoryRepository["approveRelation"] = (a) => this.apply((s, c) => approveRelation(s, c, a));
  rejectRelation: MemoryRepository["rejectRelation"] = (a) => this.apply((s, c) => rejectRelation(s, c, a));
  approveAll: MemoryRepository["approveAll"] = (a) => this.apply((s, c) => approveAll(s, c, a));
  rejectAll: MemoryRepository["rejectAll"] = (a) => this.apply((s, c) => rejectAll(s, c, a));
  approveAllDetailed: MemoryRepository["approveAllDetailed"] = (a) =>
    this.apply((s, c) => approveAllDetailed(s, c, a));
  rejectAllDetailed: MemoryRepository["rejectAllDetailed"] = (a) =>
    this.apply((s, c) => rejectAllDetailed(s, c, a));

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
    if (raw === null) return this.readLegacy(this.storage, "missing");
    let issue: LoadIssue;
    try {
      const parsed = JSON.parse(raw) as Partial<Envelope> | null;
      const v = migrateWorkspaceState(parsed?.state);
      if (v.ok && parsed?.schemaVersion === SCHEMA_VERSION) return { state: v.state, issue: null };
      issue = v.ok ? "corrupt" : v.reason;
    } catch {
      issue = "corrupt";
    }
    this.backupCorrupt(this.storage, CORRUPT_BACKUP_KEY, raw);
    // The v2 data is unreadable, but an intact legacy v1 copy may still exist: try it before the seed.
    return this.readLegacy(this.storage, issue);
  }

  /**
   * Look for the legacy v1 envelope, migrate it and persist it under the v2 key. The v1 key is left
   * untouched (it is the user's only copy of their old data, and a rollback path). `fallbackIssue` is
   * reported when nothing usable is found ("missing" when v2 was absent, else why v2 was unreadable).
   */
  private readLegacy(
    storage: StorageLike,
    fallbackIssue: LoadIssue,
  ): { state: WorkspaceState | null; issue: LoadIssue | null } {
    let legacy: string | null;
    try {
      legacy = storage.getItem(LEGACY_STORAGE_KEY);
    } catch {
      return { state: null, issue: fallbackIssue };
    }
    if (legacy === null) return { state: null, issue: fallbackIssue };
    let issue: LoadIssue = "corrupt";
    try {
      const parsed = JSON.parse(legacy) as Partial<Envelope> | null;
      const v = migrateWorkspaceState(parsed?.state);
      if (v.ok && parsed?.schemaVersion === 1) {
        this.state = v.state;
        this.persist();
        return { state: v.state, issue: null };
      }
      issue = v.ok ? "corrupt" : v.reason;
    } catch {
      /* unreadable legacy data: fall through */
    }
    // Keep a copy in its own slot (the v1 key itself is never touched), then start fresh.
    this.backupCorrupt(storage, LEGACY_CORRUPT_BACKUP_KEY, legacy);
    return { state: null, issue: fallbackIssue === "missing" ? issue : fallbackIssue };
  }

  /**
   * Keep the unreadable payload so data is never silently destroyed. Single slot per source, FIRST backup
   * wins: a later corrupt load never overwrites an earlier backup (the earliest unreadable
   * payload is the likeliest to be recoverable). "Clear all local data" removes it.
   */
  private backupCorrupt(storage: StorageLike, backupKey: string, raw: string): void {
    try {
      if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
    } catch {
      /* ignore */
    }
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
