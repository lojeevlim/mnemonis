import { useCallback, useState } from "react";
import type { CheckName } from "./workflows";

/** Memory Health run history. The old "mnemonis.agentRuns.v1" log (Librarian/Reviewer names) is no longer read. */
export const RUN_LOG_KEY = "mnemonis.healthRuns.v1";
export const LEGACY_RUN_LOG_KEY = "mnemonis.agentRuns.v1";
const MAX_RUNS = 20;

export interface AgentRun {
  id: string;
  check: CheckName;
  /** ISO time of the run. */
  at: string;
  proposals: number;
  /** Setting used, e.g. "stale after 90 days". */
  note: string;
}

export function loadRuns(): AgentRun[] {
  try {
    const raw = localStorage.getItem(RUN_LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is AgentRun =>
        !!r && typeof r.id === "string" && typeof r.at === "string" && typeof r.proposals === "number" && (r.check === "organize" || r.check === "review"),
    );
  } catch {
    return [];
  }
}

function saveRuns(runs: AgentRun[]): void {
  try {
    localStorage.setItem(RUN_LOG_KEY, JSON.stringify(runs));
  } catch {
    /* best effort: the run log is not important data */
  }
}

/** Small persisted run history (newest first, capped). Separate from WorkspaceState on purpose. */
export function useRunLog() {
  const [runs, setRuns] = useState<AgentRun[]>(loadRuns);
  const record = useCallback((run: Omit<AgentRun, "id">) => {
    setRuns((prev) => {
      const next = [{ ...run, id: `run_${run.check}_${Date.now()}_${prev.length}` }, ...prev].slice(0, MAX_RUNS);
      saveRuns(next);
      return next;
    });
  }, []);
  return { runs, record };
}
