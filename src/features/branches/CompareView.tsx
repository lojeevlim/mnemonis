import { useMemo, useState } from "react";
import { EmptyState, Select } from "lojee-ui";
import { branchTree, commitTree, diffBranches, diffCommits, type Tree } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { MemoryDiffList } from "./MemoryDiffList";

type Mode = "branches" | "commits";

export function CompareView() {
  const state = useWorkspace((s) => s.state);
  const [mode, setMode] = useState<Mode>("branches");
  const [picks, setPicks] = useState<Record<Mode, { from: string; to: string }>>({
    branches: { from: "", to: "" },
    commits: { from: "", to: "" },
  });

  const branches = useMemo(() => (state ? Object.values(state.branches) : []), [state]);
  const commits = useMemo(
    () => (state ? Object.values(state.commits).sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)) : []),
    [state],
  );

  const pick = picks[mode];
  const setPick = (side: "from" | "to", value: string) =>
    setPicks((p) => ({ ...p, [mode]: { ...p[mode], [side]: value } }));

  const diffs = useMemo(() => {
    if (!state || !pick.from || !pick.to) return null;
    return mode === "branches"
      ? diffBranches(state, pick.from, pick.to)
      : diffCommits(state, pick.from, pick.to);
  }, [state, mode, pick.from, pick.to]);

  if (!state) return null;
  const trees: Tree[] =
    pick.from && pick.to
      ? mode === "branches"
        ? [branchTree(state, pick.to), branchTree(state, pick.from)]
        : [commitTree(state, pick.to), commitTree(state, pick.from)]
      : [];
  const options =
    mode === "branches"
      ? branches.map((b) => ({ value: b.id, label: b.name }))
      : commits.map((c) => ({ value: c.id, label: `${c.message} (${state.branches[c.branchId]?.name ?? "deleted branch"})` }));
  const notEnough = mode === "branches" ? branches.length < 2 : commits.length < 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <label className="text-xs font-medium text-fg-muted" htmlFor="cmp-mode-select">
            Compare
          </label>
          <Select
            size="sm"
            id="cmp-mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            options={[
              { value: "branches", label: "Branches" },
              { value: "commits", label: "Versions" },
            ]}
          />
        </div>
        <div className="min-w-44 flex-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="cmp-from-select">
            From
          </label>
          <Select
            size="sm"
            id="cmp-from-select"
            value={pick.from}
            placeholder={`Choose ${mode === "branches" ? "a branch" : "a version"}`}
            onChange={(e) => setPick("from", e.target.value)}
            options={options}
          />
        </div>
        <div className="min-w-44 flex-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="cmp-to-select">
            To
          </label>
          <Select
            size="sm"
            id="cmp-to-select"
            value={pick.to}
            placeholder={`Choose ${mode === "branches" ? "a branch" : "a version"}`}
            onChange={(e) => setPick("to", e.target.value)}
            options={options}
          />
        </div>
      </div>
      {notEnough ? (
        <EmptyState icon="git-compare" title={mode === "branches" ? "Only one branch" : "No versions yet"}>
          {mode === "branches" ? "Create another branch to compare it with this one." : "Save some versions to compare them."}
        </EmptyState>
      ) : diffs ? (
        <MemoryDiffList
          state={state}
          diffs={diffs}
          label="Comparison"
          trees={trees}
          emptyText="No differences between these two."
        />
      ) : (
        <p className="text-sm text-fg-muted">Choose two to see what changed going from the first to the second.</p>
      )}
    </div>
  );
}
