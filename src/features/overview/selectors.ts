import {
  commitLog,
  getBranch,
  listMemories,
  pendingChanges,
  type Commit,
  type Memory,
  type WorkspaceState,
} from "../../domain";
import { isDemoMemory } from "../../components/memoryMeta";

export interface OverviewStats {
  branchName: string;
  /** Non-archived memories on the current branch. */
  memories: number;
  archived: number;
  /** Uncommitted changes vs. the branch head. */
  drafts: number;
  branches: number;
  /** Commits reachable from the current branch head. */
  commits: number;
}

export function overviewStats(state: WorkspaceState): OverviewStats {
  const all = listMemories(state);
  const archived = all.filter((m) => m.archived).length;
  return {
    branchName: getBranch(state, state.currentBranchId).name,
    memories: all.length - archived,
    archived,
    drafts: pendingChanges(state).length,
    branches: Object.keys(state.branches).length,
    commits: commitLog(state).length,
  };
}

/** Most recently touched memories (listMemories is already newest-first). */
export function recentChanges(state: WorkspaceState, limit = 6): Memory[] {
  return listMemories(state).slice(0, limit);
}

export interface RecentCommit {
  commit: Commit;
  changeCount: number;
  /** True when every memory the commit touched is demo data. */
  demo: boolean;
}

export function recentCommits(state: WorkspaceState, limit = 5): RecentCommit[] {
  return commitLog(state)
    .slice(0, limit)
    .map((commit) => ({
      commit,
      changeCount: commit.changes.length,
      demo:
        commit.changes.length > 0 &&
        commit.changes.every((ch) => {
          const id = state.memories[ch.memoryId];
          return !!id && isDemoMemory(id);
        }),
    }));
}

export interface Topic {
  tag: string;
  /** Memories carrying the tag. */
  memories: number;
  /** Relation endpoints touching those memories. */
  connections: number;
  score: number;
}

/**
 * Frequently connected topics: tags ranked by how many memories use them plus
 * how densely those memories are linked by relations. Archived memories and
 * excluded tags (e.g. the "Demo" marker) are ignored. Tags compare case-insensitively.
 */
export function frequentTopics(
  state: WorkspaceState,
  opts: { limit?: number; exclude?: string[] } = {},
): Topic[] {
  const { limit = 8, exclude = [] } = opts;
  const skip = new Set(exclude.map((t) => t.toLowerCase()));
  const live = listMemories(state).filter((m) => !m.archived);
  const liveIds = new Set(live.map((m) => m.id));

  const degree = new Map<string, number>();
  for (const r of Object.values(state.relations)) {
    if (!liveIds.has(r.fromId) || !liveIds.has(r.toId)) continue;
    degree.set(r.fromId, (degree.get(r.fromId) ?? 0) + 1);
    degree.set(r.toId, (degree.get(r.toId) ?? 0) + 1);
  }

  const topics = new Map<string, Topic>();
  for (const m of live) {
    const seen = new Set<string>();
    for (const raw of m.tags) {
      const key = raw.toLowerCase();
      if (skip.has(key) || seen.has(key)) continue;
      seen.add(key);
      const t = topics.get(key) ?? { tag: raw, memories: 0, connections: 0, score: 0 };
      t.memories += 1;
      t.connections += degree.get(m.id) ?? 0;
      topics.set(key, t);
    }
  }
  for (const t of topics.values()) t.score = t.memories + t.connections;
  return [...topics.values()]
    .sort((a, b) => b.score - a.score || b.memories - a.memories || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}
