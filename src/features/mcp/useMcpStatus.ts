import { useCallback, useEffect, useState } from "react";
import { listTokens, tokenStatus, type McpToken } from "./tokensApi";

/** A token used within this window counts as a connected client. lastUsedAt is written throttled by the API, so it is approximate. */
export const CONNECTED_WINDOW_MS = 24 * 60 * 60 * 1000;

export type McpStatus =
  | { kind: "local" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "waiting"; active: number }
  | { kind: "connected"; active: number; lastUsedAt: string }
  | { kind: "idle"; active: number; lastUsedAt: string };

export function deriveMcpStatus(input: { remote: boolean; tokens: McpToken[] | null; failed?: boolean; now?: number }): McpStatus {
  const { remote, tokens, failed = false, now = Date.now() } = input;
  if (!remote) return { kind: "local" };
  if (failed) return { kind: "error" };
  if (tokens === null) return { kind: "loading" };
  const active = tokens.filter((t) => tokenStatus(t, now) === "Active");
  if (active.length === 0) return { kind: "none" };
  const used = active.map((t) => t.lastUsedAt).filter((v): v is string => !!v && !Number.isNaN(Date.parse(v)));
  if (used.length === 0) return { kind: "waiting", active: active.length };
  const lastUsedAt = used.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
  const kind = now - Date.parse(lastUsedAt) <= CONNECTED_WINDOW_MS ? "connected" : "idle";
  return { kind, active: active.length, lastUsedAt };
}

/** Status of the MCP link, from the signed-in user's tokens. No network call in local mode. */
export function useMcpStatus(remote: boolean): { status: McpStatus; retry: () => void } {
  // The outcome is keyed by the attempt that produced it, so a retry reads as "loading" without resetting state in the effect.
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; tokens: McpToken[] | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    listTokens().then(
      (tokens) => !cancelled && setResult({ attempt, tokens, failed: false }),
      () => !cancelled && setResult({ attempt, tokens: null, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [remote, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = result !== null && result.attempt === attempt ? result : null;
  return { status: deriveMcpStatus({ remote, tokens: current?.tokens ?? null, failed: current?.failed ?? false }), retry };
}
