import { useEffect, useMemo, useState } from "react";
import { listMemories, type Memory } from "../domain";
import { useWorkspace } from "../stores/workspaceStore";
import { useToast } from "./ToastProvider";

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Memories of the current branch (memoized; zustand v5 forbids fresh arrays from selectors). */
export function useMemories(): Memory[] {
  const state = useWorkspace((s) => s.state);
  return useMemo(() => (state ? listMemories(state) : []), [state]);
}

/**
 * Runs a store action, then toasts success unless the store reported an error
 * (errors themselves are surfaced by WorkspaceGate's alert).
 */
export function useAction() {
  const toast = useToast();
  return async function act<T>(fn: () => Promise<T>, successMessage?: string): Promise<{ ok: boolean; value: T }> {
    const value = await fn();
    const ok = useWorkspace.getState().error === null;
    if (ok && successMessage) toast(successMessage, "success");
    return { ok, value };
  };
}
