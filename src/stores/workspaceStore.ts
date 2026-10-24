import { create } from "zustand";
import {
  listMemories,
  listPendingRelations,
  pendingChanges,
  timeline,
  type Actor,
  type ApproveAllResult,
  type RejectAllResult,
  type Memory,
  type PendingChange,
  type PendingRelation,
  type RelationProvenance,
  type Revision,
  type WorkspaceState,
  type Mutation,
} from "../domain";
import { createRepository } from "../data/createRepository";
import { RemoteRepository } from "../data/remoteRepository";
import type { LoadIssue, MemoryRepository } from "../data/repository";

export const LOCAL_AUTHOR = "local-user";

/**
 * Optional selection for approveAll / rejectAll so the UI acts on exactly what the user saw. Omitted list =
 * all of that kind; [] = none; unknown or no-longer-pending ids are ignored.
 */
export interface BulkOpts {
  revisionIds?: string[];
  relationIds?: string[];
}

export interface WorkspaceStore {
  state: WorkspaceState | null;
  loading: boolean;
  /** Last action error message (cleared on next successful action). */
  error: string | null;
  persistError: string | null;
  loadIssue: LoadIssue | null;
  author: string;
  /** "remote" when backed by the Mnemonis server (live updates apply), otherwise "local" (this browser). */
  mode: "local" | "remote";
  /** Bumped by switchRepository so live-update hooks restart against the new repository. */
  repoEpoch: number;
  /** Server revision last seen (remote mode), otherwise null. */
  remoteRev: number | null;

  init(): Promise<void>;
  reset(opts?: { seed?: boolean }): Promise<void>;
  /** Pretty JSON of the whole workspace (undefined + error on failure). */
  exportJson(): Promise<string | undefined>;
  /** Replaces the workspace from exported JSON (validated by the repository). */
  importJson(json: string): Promise<boolean>;
  clearError(): void;
  /**
   * Swaps the repository (Settings connect/disconnect) and loads it. Stops live updates of the old one;
   * the caller restarts them. Resolves false (error set, previous repository kept) when loading fails.
   */
  switchRepository(next: MemoryRepository): Promise<boolean>;
  /**
   * Live updates: polls the server every `intervalMs` (~3 s) while the tab is visible and replaces the state
   * when its revision changed. Returns a stop function. No-op for a local repository.
   */
  startLiveUpdates(opts?: { intervalMs?: number }): () => void;

  /**
   * Memory writes default to the signed-in user (saved immediately). Only non-UI callers (Memory Health,
   * later MCP) pass an agent `actor`; their change then waits in the Inbox as a pending proposal.
   */
  createMemory(
    input: Omit<Parameters<MemoryRepository["createMemory"]>[0], "actor">,
    opts?: { actor?: Actor },
  ): Promise<Memory | undefined>;
  updateMemory(
    id: string,
    patch: Parameters<MemoryRepository["updateMemory"]>[0]["patch"],
    opts?: { actor?: Actor },
  ): Promise<Memory | undefined>;
  archiveMemory(id: string, opts?: { actor?: Actor }): Promise<void>;
  restoreMemory(id: string, opts?: { actor?: Actor }): Promise<void>;
  rollbackMemory(memoryId: string, toRevisionId: string, opts?: { actor?: Actor }): Promise<void>;
  /**
   * provenance defaults to a user-created relation (or origin 'process' for an agent actor). A user's link
   * is saved at once; an agent's link (opts.actor.kind === 'agent') waits in the Inbox.
   */
  addRelation(
    fromId: string,
    toId: string,
    label: string,
    provenance?: RelationProvenance,
    opts?: { actor?: Actor },
  ): Promise<void>;
  /** User action by default; an agent actor is refused (the error lands in `error`). */
  removeRelation(id: string, opts?: { actor?: Actor }): Promise<void>;
  createCollection(name: string, description?: string): Promise<void>;
  updateCollection(id: string, patch: { name?: string; description?: string }): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  /** Review decisions (always as the user). Resolve true on success. */
  approve(revisionId: string): Promise<boolean>;
  reject(revisionId: string): Promise<boolean>;
  /** Approve / reject one pending link (user only). */
  approveRelation(relationId: string): Promise<boolean>;
  rejectRelation(relationId: string): Promise<boolean>;
  /** Cover pending memory proposals AND pending links, atomically. */
  approveAll(opts?: BulkOpts): Promise<boolean>;
  rejectAll(opts?: BulkOpts): Promise<boolean>;
  /** Like approveAll / rejectAll, but resolves with what was done and skipped (undefined on error). */
  approveAllDetailed(opts?: BulkOpts): Promise<ApproveAllResult | undefined>;
  rejectAllDetailed(opts?: BulkOpts): Promise<RejectAllResult | undefined>;
}

/** Thin store: no business rules here, everything delegates to the repository/domain. */
export const POLL_INTERVAL_MS = 3000;

export function createWorkspaceStore(initialRepo: MemoryRepository) {
  let repo = initialRepo;
  const modeOf = (r: MemoryRepository): "local" | "remote" => (r instanceof RemoteRepository ? "remote" : "local");
  return create<WorkspaceStore>((set, get) => {
    const sync = (state: WorkspaceState) => {
      const { persistError, loadIssue } = repo.getStatus();
      set({ state, persistError, loadIssue, error: null, remoteRev: revNow() });
    };
    const revNow = () => (repo instanceof RemoteRepository ? repo.getRev() : null);
    const fail = (e: unknown) => set({ error: e instanceof Error ? e.message : String(e) });
    /** Runs a repository mutation, syncs state, returns its value (undefined on error). */
    async function run<T>(fn: () => Promise<Mutation<T>>): Promise<T | undefined> {
      try {
        const m = await fn();
        sync(m.state);
        return m.value;
      } catch (e) {
        fail(e);
        return undefined;
      }
    }
    const author = () => get().author;
    const userActor = (): Actor => ({ kind: "user", name: author() });
    const actorOf = (opts?: { actor?: Actor }): Actor => opts?.actor ?? userActor();
    const pick = (o?: BulkOpts): BulkOpts => ({ revisionIds: o?.revisionIds, relationIds: o?.relationIds });
    const succeeded = async <T>(fn: () => Promise<Mutation<T>>) => (await run(fn)) !== undefined;

    return {
      state: null,
      loading: false,
      error: null,
      persistError: null,
      loadIssue: null,
      author: LOCAL_AUTHOR,
      mode: modeOf(initialRepo),
      repoEpoch: 0,
      remoteRev: null,

      async init() {
        set({ loading: true });
        try {
          sync(await repo.load());
        } catch (e) {
          fail(e);
        } finally {
          set({ loading: false });
        }
      },
      async reset(opts) {
        try {
          sync(await repo.reset(opts));
        } catch (e) {
          fail(e);
        }
      },
      async exportJson() {
        try {
          return await repo.export();
        } catch (e) {
          fail(e);
          return undefined;
        }
      },
      async importJson(json) {
        try {
          sync(await repo.importJson(json));
          return true;
        } catch (e) {
          fail(e);
          return false;
        }
      },
      clearError: () => set({ error: null }),

      async switchRepository(next) {
        const prev = repo;
        repo = next;
        try {
          const state = await next.load();
          set((st) => ({ mode: modeOf(next), repoEpoch: st.repoEpoch + 1 }));
          sync(state);
          return true;
        } catch (e) {
          repo = prev;
          fail(e);
          return false;
        }
      },

      startLiveUpdates(opts) {
        const target = repo;
        if (!target.refresh) return () => undefined;
        const interval = opts?.intervalMs ?? POLL_INTERVAL_MS;
        let stopped = false;
        let inFlight = false;
        const tick = async () => {
          if (stopped || inFlight || repo !== target || document.visibilityState === "hidden") return;
          inFlight = true;
          try {
            // Queued behind any local mutation in the repository, so it can never clobber one.
            const next = await target.refresh!();
            if (!stopped && repo === target) {
              const { persistError, loadIssue } = target.getStatus();
              set(next ? { state: next, persistError, loadIssue, remoteRev: revNow() } : { persistError, loadIssue });
            }
          } catch {
            if (!stopped && repo === target) {
              const { persistError, loadIssue } = target.getStatus();
              set({ persistError, loadIssue });
            }
          } finally {
            inFlight = false;
          }
        };
        const timer = setInterval(() => void tick(), interval);
        const onVisible = () => {
          if (document.visibilityState === "visible") void tick();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          stopped = true;
          clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      },

      createMemory: (input, opts) => run(() => repo.createMemory({ ...input, actor: actorOf(opts) })),
      updateMemory: (id, patch, opts) => run(() => repo.updateMemory({ id, patch, actor: actorOf(opts) })),
      archiveMemory: async (id, opts) => void (await run(() => repo.archiveMemory({ id, actor: actorOf(opts) }))),
      restoreMemory: async (id, opts) => void (await run(() => repo.restoreMemory({ id, actor: actorOf(opts) }))),
      rollbackMemory: async (memoryId, toRevisionId, opts) =>
        void (await run(() => repo.rollbackMemory({ memoryId, toRevisionId, actor: actorOf(opts) }))),
      addRelation: async (fromId, toId, label, provenance, opts) => {
        const actor = actorOf(opts);
        await run(() =>
          repo.addRelation({
            fromId,
            toId,
            label,
            actor,
            provenance:
              provenance ??
              (actor.kind === "agent"
                ? { origin: "process", createdBy: actor.name, process: actor.name }
                : { origin: "user", createdBy: author() }),
          }),
        );
      },
      removeRelation: async (id, opts) =>
        void (await run(() => repo.removeRelation({ id, actor: actorOf(opts) }))),
      createCollection: async (name, description) =>
        void (await run(() => repo.createCollection({ name, description }))),
      updateCollection: async (id, patch) => void (await run(() => repo.updateCollection({ id, ...patch }))),
      deleteCollection: async (id) => void (await run(() => repo.deleteCollection({ id }))),
      approve: (revisionId) => succeeded(() => repo.approve({ revisionId, actor: userActor() })),
      reject: (revisionId) => succeeded(() => repo.reject({ revisionId, actor: userActor() })),
      approveRelation: (relationId) => succeeded(() => repo.approveRelation({ relationId, actor: userActor() })),
      rejectRelation: (relationId) => succeeded(() => repo.rejectRelation({ relationId, actor: userActor() })),
      approveAll: (opts) => succeeded(() => repo.approveAll({ ...pick(opts), actor: userActor() })),
      rejectAll: (opts) => succeeded(() => repo.rejectAll({ ...pick(opts), actor: userActor() })),
      approveAllDetailed: (opts) => run(() => repo.approveAllDetailed({ ...pick(opts), actor: userActor() })),
      rejectAllDetailed: (opts) => run(() => repo.rejectAllDetailed({ ...pick(opts), actor: userActor() })),
    };
  });
}

export const useWorkspace = createWorkspaceStore(createRepository());

// ---- selectors (plain functions of the store state) -----------------------
// NOTE: these derive new arrays/objects, so in components wrap them in useMemo
// over `s.state` (or use zustand's useShallow) to avoid re-render loops.

/** Changes waiting for review (the Inbox / short term memory), oldest first. */
export const selectPending = (s: WorkspaceStore): PendingChange[] => (s.state ? pendingChanges(s.state) : []);

/** Pending links proposed by agents, oldest first. */
export const selectPendingRelations = (s: WorkspaceStore): PendingRelation[] =>
  s.state ? listPendingRelations(s.state) : [];

export const selectMemories = (s: WorkspaceStore): Memory[] => (s.state ? listMemories(s.state) : []);

/** Saved revisions across all memories, newest first. */
export const selectTimeline = (s: WorkspaceStore): Revision[] => (s.state ? timeline(s.state) : []);
