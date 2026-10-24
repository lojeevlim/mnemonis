import { create } from "zustand";
import {
  commitLog,
  getBranch,
  listMemories,
  pendingChanges,
  type Branch,
  type Commit,
  type Memory,
  type MergeResult,
  type PendingChange,
  type RelationProvenance,
  type WorkspaceState,
  type Mutation,
} from "../domain";
import { LocalRepository } from "../data/localRepository";
import type { LoadIssue, MemoryRepository } from "../data/repository";

export const LOCAL_AUTHOR = "local-user";

export interface WorkspaceStore {
  state: WorkspaceState | null;
  loading: boolean;
  /** Last action error message (cleared on next successful action). */
  error: string | null;
  persistError: string | null;
  loadIssue: LoadIssue | null;
  author: string;

  init(): Promise<void>;
  reset(opts?: { seed?: boolean }): Promise<void>;
  /** Pretty JSON of the whole workspace (undefined + error on failure). */
  exportJson(): Promise<string | undefined>;
  /** Replaces the workspace from exported JSON (validated by the repository). */
  importJson(json: string): Promise<boolean>;
  clearError(): void;

  createMemory(input: Omit<Parameters<MemoryRepository["createMemory"]>[0], "author">): Promise<Memory | undefined>;
  updateMemory(id: string, patch: Parameters<MemoryRepository["updateMemory"]>[0]["patch"]): Promise<Memory | undefined>;
  archiveMemory(id: string): Promise<void>;
  restoreMemory(id: string): Promise<void>;
  rollbackMemory(memoryId: string, toRevisionId: string): Promise<void>;
  /** provenance defaults to a user-created relation; agents pass origin 'process'. */
  addRelation(fromId: string, toId: string, label: string, provenance?: RelationProvenance): Promise<void>;
  removeRelation(id: string): Promise<void>;
  createCollection(name: string, description?: string): Promise<void>;
  updateCollection(id: string, patch: { name?: string; description?: string }): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  commit(message: string): Promise<Commit | undefined>;
  createBranch(name: string, fromCommitId?: string | null, switchTo?: boolean): Promise<Branch | undefined>;
  switchBranch(branchId: string): Promise<void>;
  merge(sourceBranchId: string, message?: string): Promise<MergeResult | undefined>;
  resolveConflict(
    conflictId: string,
    choice: "ours" | "theirs" | "manual",
    value?: Parameters<MemoryRepository["resolveConflict"]>[0]["value"],
  ): Promise<void>;
  completeMerge(): Promise<Commit | undefined>;
  abortMerge(): Promise<void>;
}

/** Thin store: no business rules here, everything delegates to the repository/domain. */
export function createWorkspaceStore(repo: MemoryRepository) {
  return create<WorkspaceStore>((set, get) => {
    const sync = (state: WorkspaceState) => {
      const { persistError, loadIssue } = repo.getStatus();
      set({ state, persistError, loadIssue, error: null });
    };
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

    return {
      state: null,
      loading: false,
      error: null,
      persistError: null,
      loadIssue: null,
      author: LOCAL_AUTHOR,

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

      createMemory: (input) => run(() => repo.createMemory({ ...input, author: author() })),
      updateMemory: (id, patch) => run(() => repo.updateMemory({ id, patch, author: author() })),
      archiveMemory: async (id) => void (await run(() => repo.archiveMemory({ id, author: author() }))),
      restoreMemory: async (id) => void (await run(() => repo.restoreMemory({ id, author: author() }))),
      rollbackMemory: async (memoryId, toRevisionId) =>
        void (await run(() => repo.rollbackMemory({ memoryId, toRevisionId, author: author() }))),
      addRelation: async (fromId, toId, label, provenance) =>
        void (await run(() =>
          repo.addRelation({
            fromId,
            toId,
            label,
            provenance: provenance ?? { origin: "user", createdBy: author() },
          }),
        )),
      removeRelation: async (id) => void (await run(() => repo.removeRelation({ id }))),
      createCollection: async (name, description) =>
        void (await run(() => repo.createCollection({ name, description }))),
      updateCollection: async (id, patch) => void (await run(() => repo.updateCollection({ id, ...patch }))),
      deleteCollection: async (id) => void (await run(() => repo.deleteCollection({ id }))),
      commit: (message) => run(() => repo.commit({ message, author: author() })),
      createBranch: (name, fromCommitId, switchTo) => run(() => repo.createBranch({ name, fromCommitId, switchTo })),
      switchBranch: async (branchId) => void (await run(() => repo.switchBranch({ branchId }))),
      merge: (sourceBranchId, message) => run(() => repo.merge({ sourceBranchId, author: author(), message })),
      resolveConflict: async (conflictId, choice, value) =>
        void (await run(() => repo.resolveConflict({ conflictId, choice, value }))),
      completeMerge: () => run(() => repo.completeMerge()),
      abortMerge: async () => void (await run(() => repo.abortMerge())),
    };
  });
}

export const useWorkspace = createWorkspaceStore(new LocalRepository());

// ---- selectors (plain functions of the store state) -----------------------
// NOTE: these derive new arrays/objects, so in components wrap them in useMemo
// over `s.state` (or use zustand's useShallow) to avoid re-render loops.

export const selectCurrentBranch = (s: WorkspaceStore): Branch | undefined =>
  s.state ? getBranch(s.state, s.state.currentBranchId) : undefined;

/** Pending drafts (actual changes vs. head) on the current branch. */
export const selectPendingDrafts = (s: WorkspaceStore): PendingChange[] =>
  s.state ? pendingChanges(s.state) : [];

export const selectMemories = (s: WorkspaceStore): Memory[] => (s.state ? listMemories(s.state) : []);

export const selectCommitLog = (s: WorkspaceStore): Commit[] => (s.state ? commitLog(s.state) : []);
