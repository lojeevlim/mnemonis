import type { Memory, WorkspaceState } from "../domain";

/** True when a memory exists only as a proposal (its current revision has never been saved/approved). */
export function isUnsaved(state: Pick<WorkspaceState, "revisions">, memory: Pick<Memory, "hasPending" | "revisionId">): boolean {
  return memory.hasPending && !state.revisions[memory.revisionId]?.savedAt;
}
