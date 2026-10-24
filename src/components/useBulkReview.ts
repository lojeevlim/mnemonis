import { listPendingRelations, pendingChanges, type WorkspaceState } from "../domain";
import { useWorkspace } from "../stores/workspaceStore";
import { useToast } from "./ToastProvider";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ids of everything pending in `state` (memory proposals and links). */
export function pendingIds(state: WorkspaceState | null) {
  return {
    revisionIds: state ? pendingChanges(state).map((p) => p.revisionId) : [],
    relationIds: state ? listPendingRelations(state).map((l) => l.relationId) : [],
  };
}

/**
 * Approve / reject exactly the proposals the user was looking at when they clicked, so anything an agent
 * proposed after the last render stays pending. Resolves with an inline notice (skipped links, or items that
 * arrived meanwhile) and also toasts success.
 */
export function useBulkReview() {
  const toast = useToast();
  return async function review(
    kind: "approve" | "reject",
    shown: { revisionIds: string[]; relationIds: string[] },
  ): Promise<{ ok: boolean; notice: string | null; error: string | null }> {
    const store = useWorkspace.getState();
    const result =
      kind === "approve" ? await store.approveAllDetailed(shown) : await store.rejectAllDetailed(shown);
    const after = useWorkspace.getState();
    if (!result || after.error !== null) {
      const error = after.error ?? "Something went wrong";
      after.clearError();
      return { ok: false, notice: null, error };
    }

    const skipped = "skippedRelationIds" in result ? result.skippedRelationIds.length : 0;
    const done =
      "approvedRevisionIds" in result
        ? result.approvedRevisionIds.length + result.approvedRelationIds.length
        : result.rejectedRevisionIds.length + result.rejectedRelationIds.length;
    if (done > 0) toast(`${kind === "approve" ? "Approved" : "Rejected"} ${plural(done, "change", "changes")}`, "success");

    const seenRev = new Set(shown.revisionIds);
    const seenRel = new Set(shown.relationIds);
    const now = pendingIds(after.state);
    const arrived =
      now.revisionIds.filter((id) => !seenRev.has(id)).length + now.relationIds.filter((id) => !seenRel.has(id)).length;
    const parts: string[] = [];
    if (skipped > 0) {
      parts.push(`${plural(skipped, "link needs", "links need")} their memories approved first.`);
    }
    if (arrived > 0) {
      parts.push(`${plural(arrived, "new item arrived", "new items arrived")}; review ${arrived === 1 ? "it" : "them"} in the Inbox.`);
    }
    return { ok: true, notice: parts.length ? parts.join(" ") : null, error: null };
  };
}
