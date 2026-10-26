import {
  createEmptyWorkspace,
  DomainError,
  SCHEMA_VERSION,
  type Actor,
  type Mutation,
  type WorkspaceState,
} from "../domain";
import { createSeedWorkspace } from "./seed";
import type { LoadIssue, MemoryRepository, RepositoryStatus } from "./repository";

export interface RemoteRepositoryOptions {
  baseUrl: string;
  /** A fixed token (tests). In the app pass `getToken` so the session is read at request time. */
  token?: string;
  /** Returns the current session token (null when signed out). Takes precedence over `token`. */
  getToken?: () => string | null;
  /** Called once per 401 so the app can clear the session and send the user to /sign-in. */
  onUnauthorized?: () => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Transport-level failure (not a domain rule): the server is unreachable, rejected the token, or broke. */
export class RemoteError extends Error {
  readonly kind: "network" | "unauthorized" | "http";
  readonly status: number | null;
  constructor(kind: RemoteError["kind"], message: string, status: number | null = null) {
    super(message);
    this.name = "RemoteError";
    this.kind = kind;
    this.status = status;
  }
}

const UNAUTHORIZED_MSG = "Your session is no longer valid (401). Sign in again.";

/** Ops where the server always acts as the human user; an agent actor is refused client-side like the local domain does. */
const USER_ONLY = new Set([
  "approve",
  "reject",
  "approveRelation",
  "rejectRelation",
  "approveAll",
  "rejectAll",
  "approveAllDetailed",
  "rejectAllDetailed",
  "removeRelation",
  "createProject",
  "confirmProject",
  "renameProject",
  "deleteProject",
  "createOrganization",
  "renameOrganization",
  "deleteOrganization",
  "confirmOrganization",
  "assignProjectOrganization",
  "fileUnsorted",
]);

/** A server that predates organizations (schema 3) sends no `organizations` / `organizationId`: read it as "none". */
function withOrganizations(state: WorkspaceState): WorkspaceState {
  if (state.organizations !== undefined) return state;
  return {
    ...state,
    organizations: {},
    projects: Object.fromEntries(Object.entries(state.projects ?? {}).map(([id, p]) => [id, { ...p, organizationId: null }])),
  };
}

const etag = (rev: number) => `"${rev}"`;

/**
 * MemoryRepository backed by the Mnemonis server (mnemonis_mcp). The server is the source of truth:
 * - `save()` is a no-op (every mutation is already persisted server-side by its own POST /api/ops call).
 * - mutations send the same args as LocalRepository minus `actor`; an `actor` is sent ONLY when it is an
 *   agent (downgrade-only: the write becomes a pending proposal). The server always acts as the user otherwise.
 * - all requests are serialized (one at a time), so a poll never overlaps a local mutation.
 */
export class RemoteRepository implements MemoryRepository {
  private readonly base: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized: (() => void) | undefined;
  private readonly fetchFn: typeof fetch;
  private state: WorkspaceState | null = null;
  private rev: number | null = null;
  private status: RepositoryStatus = { loadIssue: null, persistError: null };

  constructor(opts: RemoteRepositoryOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.getToken = opts.getToken ?? (() => opts.token ?? null);
    this.onUnauthorized = opts.onUnauthorized;
    this.fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  }

  getStatus(): RepositoryStatus {
    return { ...this.status };
  }

  /** Latest server revision seen (null before the first load). */
  getRev(): number | null {
    return this.rev;
  }

  // ---- reads / whole-workspace ------------------------------------------

  load(): Promise<WorkspaceState> {
    return this.enqueue(async () => {
      try {
        const r = await this.send("GET", "/api/state", { headers: this.rev !== null && this.state ? { "If-None-Match": etag(this.rev) } : {} });
        if (r.status === 304 && this.state) return this.state;
        const state = await this.adopt(r);
        this.status.loadIssue = null;
        this.status.persistError = null;
        return state;
      } catch (e) {
        this.status.loadIssue = this.issueFor(e);
        throw e;
      }
    });
  }

  /** Polls the server: resolves the new state when the revision changed, null when unchanged. */
  refresh(): Promise<WorkspaceState | null> {
    return this.enqueue(async () => {
      if (this.rev === null || !this.state) return this.loadNow();
      const r = await this.send("GET", "/api/state", { headers: { "If-None-Match": etag(this.rev) } });
      if (r.status === 304) return null;
      return this.adopt(r);
    });
  }

  private async loadNow(): Promise<WorkspaceState> {
    return this.adopt(await this.send("GET", "/api/state"));
  }

  /** No-op: the server is the source of truth and every mutation is persisted by its own request. */
  async save(): Promise<void> {}

  export(): Promise<string> {
    return this.enqueue(async () => (await this.send("GET", "/api/export")).text());
  }

  importJson(json: string): Promise<WorkspaceState> {
    return this.enqueue(() => this.putState(json));
  }

  /** The server has no reset endpoint: replace the data with the demo seed (default) or an empty workspace. */
  reset(opts: { seed?: boolean } = {}): Promise<WorkspaceState> {
    return this.enqueue(() => {
      const state = opts.seed === false ? createEmptyWorkspace() : createSeedWorkspace();
      return this.putState(JSON.stringify({ schemaVersion: SCHEMA_VERSION, state }));
    });
  }

  private async putState(json: string): Promise<WorkspaceState> {
    if (this.rev === null) await this.loadNow();
    const r = await this.send("PUT", "/api/state", {
      headers: { "If-Match": etag(this.rev!), "Content-Type": "application/json" },
      body: json,
    });
    const state = await this.adopt(r);
    this.status.loadIssue = null;
    return state;
  }

  // ---- mutations ---------------------------------------------------------

  createMemory: MemoryRepository["createMemory"] = ({ actor, ...args }) => this.op("createMemory", args, actor);
  updateMemory: MemoryRepository["updateMemory"] = ({ actor, ...args }) => this.op("updateMemory", args, actor);
  archiveMemory: MemoryRepository["archiveMemory"] = ({ actor, ...args }) => this.op("archiveMemory", args, actor);
  restoreMemory: MemoryRepository["restoreMemory"] = ({ actor, ...args }) => this.op("restoreMemory", args, actor);
  rollbackMemory: MemoryRepository["rollbackMemory"] = ({ actor, ...args }) => this.op("rollbackMemory", args, actor);
  addRelation: MemoryRepository["addRelation"] = ({ actor, ...args }) => this.op("addRelation", args, actor);
  removeRelation: MemoryRepository["removeRelation"] = ({ actor, ...args }) => this.op("removeRelation", args, actor);
  createCollection: MemoryRepository["createCollection"] = (a) => this.op("createCollection", a);
  updateCollection: MemoryRepository["updateCollection"] = (a) => this.op("updateCollection", a);
  deleteCollection: MemoryRepository["deleteCollection"] = (a) => this.op("deleteCollection", a);
  createProject: MemoryRepository["createProject"] = ({ actor, ...args }) => this.op("createProject", args, actor);
  confirmProject: MemoryRepository["confirmProject"] = ({ actor, ...args }) => this.op("confirmProject", args, actor);
  renameProject: MemoryRepository["renameProject"] = ({ actor, ...args }) => this.op("renameProject", args, actor);
  deleteProject: MemoryRepository["deleteProject"] = ({ actor, ...args }) => this.op("deleteProject", args, actor);
  createOrganization: MemoryRepository["createOrganization"] = ({ actor, ...args }) => this.op("createOrganization", args, actor);
  renameOrganization: MemoryRepository["renameOrganization"] = ({ actor, ...args }) => this.op("renameOrganization", args, actor);
  deleteOrganization: MemoryRepository["deleteOrganization"] = ({ actor, ...args }) => this.op("deleteOrganization", args, actor);
  confirmOrganization: MemoryRepository["confirmOrganization"] = ({ actor, ...args }) => this.op("confirmOrganization", args, actor);
  assignProjectOrganization: MemoryRepository["assignProjectOrganization"] = ({ actor, ...args }) =>
    this.op("assignProjectOrganization", args, actor);
  fileUnsorted: MemoryRepository["fileUnsorted"] = ({ actor, ...args }) => this.op("fileUnsorted", args, actor);
  approve: MemoryRepository["approve"] = ({ actor, ...args }) => this.op("approve", args, actor);
  reject: MemoryRepository["reject"] = ({ actor, ...args }) => this.op("reject", args, actor);
  approveRelation: MemoryRepository["approveRelation"] = ({ actor, ...args }) => this.op("approveRelation", args, actor);
  rejectRelation: MemoryRepository["rejectRelation"] = ({ actor, ...args }) => this.op("rejectRelation", args, actor);
  approveAll: MemoryRepository["approveAll"] = ({ actor, ...args }) => this.op("approveAll", args, actor);
  rejectAll: MemoryRepository["rejectAll"] = ({ actor, ...args }) => this.op("rejectAll", args, actor);
  approveAllDetailed: MemoryRepository["approveAllDetailed"] = ({ actor, ...args }) =>
    this.op("approveAllDetailed", args, actor);
  rejectAllDetailed: MemoryRepository["rejectAllDetailed"] = ({ actor, ...args }) =>
    this.op("rejectAllDetailed", args, actor);

  private op<T>(name: string, args: object, actor?: Actor): Promise<Mutation<T>> {
    return this.enqueue(async () => {
      const isAgent = actor?.kind === "agent";
      if (isAgent && USER_ONLY.has(name)) {
        throw new DomainError("forbidden", "Only a user can do this; an agent actor is refused.");
      }
      const body = isAgent ? { ...args, actor: { kind: "agent", name: actor.name } } : args;
      const r = await this.send("POST", `/api/ops/${name}`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await this.readJson(r)) as { rev: number; state: WorkspaceState; value: T | null };
      this.take(json.rev, json.state);
      return { state: this.state as WorkspaceState, value: (json.value ?? undefined) as T };
    });
  }

  // ---- internals ---------------------------------------------------------

  private queue: Promise<unknown> = Promise.resolve();

  /** Strictly one request at a time (a failure does not stall the queue). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private take(rev: number, state: WorkspaceState) {
    if (typeof rev !== "number" || !state || typeof state !== "object") {
      throw new RemoteError("http", "The server sent an unexpected response.");
    }
    this.rev = rev;
    this.state = withOrganizations(state);
  }

  private async adopt(r: Response): Promise<WorkspaceState> {
    const json = (await this.readJson(r)) as { rev: number; state: WorkspaceState };
    this.take(json.rev, json.state);
    return this.state as WorkspaceState;
  }

  private async readJson(r: Response): Promise<unknown> {
    try {
      return await r.json();
    } catch {
      throw this.noteFailure(new RemoteError("http", "The server sent an unreadable response.", r.status));
    }
  }

  private issueFor(e: unknown): LoadIssue {
    return e instanceof RemoteError && e.kind === "unauthorized" ? "unauthorized" : "storage-unavailable";
  }

  /** Records transport failures in the status (domain errors are the caller's business and are not persistence failures). */
  private noteFailure<E extends Error>(e: E): E {
    if (e instanceof RemoteError) this.status.persistError = e.message;
    return e;
  }

  /** One authenticated request. Resolves for 2xx and 304; every other outcome throws. */
  private async send(method: string, path: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
    const token = this.getToken();
    if (!token) throw this.noteFailure(new RemoteError("unauthorized", UNAUTHORIZED_MSG, 401));
    let r: Response;
    try {
      r = await this.fetchFn(this.base + path, {
        method,
        headers: { Accept: "application/json", ...init.headers, Authorization: `Bearer ${token}` },
        body: init.body,
        cache: "no-store",
      });
    } catch {
      throw this.noteFailure(new RemoteError("network", `Cannot reach the Mnemonis server at ${this.base}.`));
    }
    if (r.ok || r.status === 304) {
      this.status.persistError = null;
      return r;
    }
    if (r.status === 401) {
      this.onUnauthorized?.();
      throw this.noteFailure(new RemoteError("unauthorized", UNAUTHORIZED_MSG, 401));
    }
    let code = "";
    let message = "";
    try {
      const j = (await r.json()) as { error?: { code?: unknown; message?: unknown } };
      if (typeof j.error?.code === "string") code = j.error.code;
      if (typeof j.error?.message === "string") message = j.error.message;
    } catch {
      /* not JSON */
    }
    if (code) {
      // 409 on PUT = stale revision: surface the server's message so the user can reload and retry.
      throw new DomainError(code, message || code);
    }
    throw this.noteFailure(new RemoteError("http", `The server failed (HTTP ${r.status}).`, r.status));
  }
}
