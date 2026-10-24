import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, ErrorState, LoadingState, Skeleton } from "lojee-ui";
import type { LoadIssue } from "../data/repository";
import { useWorkspace } from "../stores/workspaceStore";
import { LocalRepository } from "../data/localRepository";
import { clearServerSettings } from "../data/serverSettings";

const LOAD_ISSUE_COPY: Partial<Record<LoadIssue, { title: string; body: string }>> = {
  corrupt: {
    title: "Saved data could not be read",
    body: "Your stored workspace was unreadable, so Mnemonis started from a fresh demo workspace. The unreadable data was kept as a backup in this browser.",
  },
  "version-mismatch": {
    title: "Saved data is from a different version",
    body: "Your stored workspace uses an incompatible format, so Mnemonis started from a fresh demo workspace.",
  },
  "storage-unavailable": {
    title: "Browser storage is unavailable",
    body: "Changes work for this session but will not survive a reload.",
  },
};

/**
 * Bootstraps the workspace store once and renders loading / error states and
 * dismissible alerts (load issue, persistence failure, last action error).
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const state = useWorkspace((s) => s.state);
  const error = useWorkspace((s) => s.error);
  const loadIssue = useWorkspace((s) => s.loadIssue);
  const persistError = useWorkspace((s) => s.persistError);
  const mode = useWorkspace((s) => s.mode);
  const repoEpoch = useWorkspace((s) => s.repoEpoch);
  const hasState = state !== null;
  const init = useWorkspace((s) => s.init);
  const clearError = useWorkspace((s) => s.clearError);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    const s = useWorkspace.getState();
    if (!s.state && !s.loading) void init();
  }, [init]);

  // Live updates (server mode only): agent proposals appear without a reload. Stops on unmount.
  useEffect(() => {
    if (!hasState || mode !== "remote") return;
    return useWorkspace.getState().startLiveUpdates();
  }, [hasState, mode, repoEpoch]);

  if (!state) {
    if (error) {
      return (
        <div className="p-6">
          <ErrorState
            title="Could not load your workspace"
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void init()}>
                  Try again
                </Button>
                {mode === "remote" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      clearServerSettings();
                      void useWorkspace.getState().switchRepository(new LocalRepository());
                    }}
                  >
                    Switch to local mode
                  </Button>
                )}
              </div>
            }
          >
            {error}
          </ErrorState>
        </div>
      );
    }
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <LoadingState title="Loading workspace" size="sm" />
        <Skeleton variant="rect" height={72} />
        <Skeleton variant="rect" height={160} />
      </div>
    );
  }

  const issueCopy = loadIssue ? LOAD_ISSUE_COPY[loadIssue] : undefined;
  const issueKey = `issue:${loadIssue}`;
  const persistKey = `persist:${persistError}`;

  return (
    <>
      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {issueCopy && !dismissed.includes(issueKey) && (
          <Alert
            variant="warning"
            title={issueCopy.title}
            closable
            onClose={() => setDismissed((d) => [...d, issueKey])}
          >
            {issueCopy.body}
          </Alert>
        )}
        {persistError && !dismissed.includes(persistKey) && (
          <Alert
            variant="error"
            title={mode === "remote" ? "Problem talking to the Mnemonis server" : "Changes could not be saved to this browser"}
            closable
            onClose={() => setDismissed((d) => [...d, persistKey])}
          >
            {persistError}{" "}
            {mode === "remote"
              ? "Live updates continue to retry; check the server and your token in Settings."
              : "Your latest changes exist only in memory until storage works again."}
          </Alert>
        )}
        {error && (
          <Alert variant="error" title="Something went wrong" closable onClose={clearError}>
            {error}
          </Alert>
        )}
      </div>
      {children}
    </>
  );
}
