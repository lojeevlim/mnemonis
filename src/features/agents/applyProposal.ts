import { getMemory } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import type { Proposal } from "./workflows";

/**
 * Applies one proposal through store actions. Memory edits become DRAFT revisions
 * (never commits, never deletions; "archive" is a reviewable draft). Links are
 * additive relations with provenance origin 'process'. Action failures land in the
 * store's `error` (callers check it); a vanished memory throws.
 */
export async function applyProposal(p: Proposal): Promise<void> {
  const action = p.action;
  if (!action) throw new Error("This proposal needs a manual change and cannot be applied automatically.");
  // Always read fresh state: earlier awaited actions replace the store state.
  const store = () => useWorkspace.getState();
  const current = (id: string) => {
    const { state } = store();
    const m = state ? getMemory(state, id) : undefined;
    if (!m) throw new Error("That memory no longer exists on this branch; re-run the agent.");
    return m;
  };

  switch (action.kind) {
    case "add-tag": {
      const m = current(action.memoryId);
      if (m.tags.includes(action.tag)) return;
      await store().updateMemory(m.id, { tags: [...m.tags, action.tag] });
      return;
    }
    case "set-collection":
      current(action.memoryId);
      await store().updateMemory(action.memoryId, { collectionId: action.collectionId });
      return;
    case "archive":
      current(action.memoryId);
      await store().archiveMemory(action.memoryId);
      return;
    case "link":
      current(action.fromId);
      current(action.toId);
      await store().addRelation(action.fromId, action.toId, action.label, {
        origin: "process",
        createdBy: store().author,
        process: p.agent,
      });
      return;
  }
}
