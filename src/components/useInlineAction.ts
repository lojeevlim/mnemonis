import { useState } from "react";
import { useAction } from "./hooks";
import { useWorkspace } from "../stores/workspaceStore";

/**
 * Like useAction, but moves a DomainError message out of the global store alert
 * and into local state so the form that caused it can show it next to the input.
 */
export function useInlineAction() {
  const act = useAction();
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>, successMessage?: string) {
    const result = await act(fn, successMessage);
    const { error: message, clearError } = useWorkspace.getState();
    if (message) {
      setError(message);
      clearError();
    } else {
      setError(null);
    }
    return result;
  }
  return { run, error, clearError: () => setError(null) };
}
