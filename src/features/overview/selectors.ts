import { listMemories, listRelations, pendingCount, timeline, type Memory, type Revision, type WorkspaceState } from "../../domain";
import { isDemoMemory } from "../../components/memoryMeta";

export interface OverviewStats {
  /** Non-archived saved memories. */
  memories: number;
  archived: number;
  /** Changes and links waiting for review in the Inbox. */
  pending: number;
  /** Saved changes (length of the timeline). */
  saves: number;
}

export function overviewStats(state: WorkspaceState): OverviewStats {
  const all = listMemories(state);
  const archived = all.filter((m) => m.archived).length;
  return {
    memories: all.length - archived,
    archived,
    pending: pendingCount(state),
    saves: timeline(state).length,
  };
}

/** Most recently touched memories (listMemories is already newest-first). */
export function recentChanges(state: WorkspaceState, limit = 6): Memory[] {
  return listMemories(state).slice(0, limit);
}

export interface RecentActivity {
  revision: Revision;
  /** True when the memory it changed is demo data. */
  demo: boolean;
}

/** Latest saved changes across all memories, newest first. */
export function recentActivity(state: WorkspaceState, limit = 5): RecentActivity[] {
  return timeline(state, limit).map((revision) => {
    const identity = state.memories[revision.memoryId];
    return { revision, demo: !!identity && isDemoMemory(identity) };
  });
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
  for (const r of listRelations(state)) {
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
