import { useState } from "react";
import { Tabs } from "lojee-ui";
import { diffWorkingTree } from "../../domain";
import { PageHeader } from "../../components/PageHeader";
import { useWorkspace } from "../../stores/workspaceStore";
import { BranchList } from "./BranchList";
import { CommitHistory } from "./CommitHistory";
import { CompareView } from "./CompareView";
import { ConflictResolver } from "./ConflictResolver";
import { CreateBranchModal } from "./CreateBranchModal";
import { MergePanel } from "./MergePanel";
import { WorkingChanges } from "./WorkingChanges";

export function BranchesPage() {
  const state = useWorkspace((s) => s.state);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState(0);
  if (!state) return null;
  const draftCount = diffWorkingTree(state).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="Branches & Versions"
        description="Work on a branch, review changes, save versions, compare and merge. Roll back individual memories from their history. Versions are saved only in this browser; they are not sent to Git or any server."
      />
      <BranchList state={state} onCreate={() => setCreating(true)} />
      {state.pendingMerge && <ConflictResolver pending={state.pendingMerge} />}
      <Tabs
        index={tab}
        onChange={setTab}
        tabs={[
          { label: draftCount > 0 ? `Working changes (${draftCount})` : "Working changes", content: <WorkingChanges /> },
          { label: "History", content: <CommitHistory /> },
          { label: "Compare", content: <CompareView /> },
          { label: "Merge", content: <MergePanel /> },
        ]}
      />
      <CreateBranchModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
