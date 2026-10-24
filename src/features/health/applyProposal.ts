import { getMemory, pendingRevisionFor, type Actor } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import type { CheckName, Proposal } from "./workflows";

/** The writer identity Memory Health checks use. Agents never save directly: their writes land in the Inbox. */
export const CHECK_ACTOR: Record<CheckName, Actor> = {
  organize: { kind: "agent", name: "Memory Health: Organize" },
  review: { kind: "agent", name: "Memory Health: Review" },
};

/**
 * Applies one proposal through store actions. Memory edits and links become PENDING proposals in the
 * Inbox (never auto-saved, never deletions; "archive" is a reviewable proposal). Action failures land
 * in the store's `error` (callers check it); a vanished memory throws.
 */
export async function applyProposal(p: Proposal): Promise<void> {
  const action = p.action;
  if (!action) throw new Error("This proposal needs a manual change and cannot be applied automatically.");
  const actor = CHECK_ACTOR[p.check];
  // Always read fresh state: earlier awaited actions replace the store state.
  const store = () => useWorkspace.getState();
  const current = (id: string) => {
    const { state } = store();
    const m = state ? getMemory(state, id) : undefined;
    if (!m) throw new Error("That memory no longer exists; re-run the check.");
    return m;
  };
  /** Tags as this check would see them: its own open proposal if any, so edits accumulate instead of overwriting. */
  const tagsNow = (id: string): string[] => {
    const { state } = store();
    const mine = state ? pendingRevisionFor(state, id) : undefined;
    return mine && mine.author === actor.name ? [...mine.snapshot.tags] : [...current(id).tags];
  };

  switch (action.kind) {
    case "add-tag": {
      current(action.memoryId);
      const tags = tagsNow(action.memoryId);
      if (tags.includes(action.tag)) return;
      await store().updateMemory(action.memoryId, { tags: [...tags, action.tag] }, { actor });
      return;
    }
    case "set-collection":
      current(action.memoryId);
      await store().updateMemory(action.memoryId, { collectionId: action.collectionId }, { actor });
      return;
    case "archive":
      current(action.memoryId);
      await store().archiveMemory(action.memoryId, { actor });
      return;
    case "link":
      current(action.fromId);
      current(action.toId);
      // Agent actor + no provenance: the store records origin "process" and the check's name; the link waits in the Inbox.
      await store().addRelation(action.fromId, action.toId, action.label, undefined, { actor });
      return;
  }
}
