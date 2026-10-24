import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRemoteRepository } from "../../data/createRepository";
import { scrubLegacyServerToken } from "../../data/serverSettings";
import { useWorkspace } from "../../stores/workspaceStore";
import type { AuthUser } from "./authProvider";
import { serverAuthProvider, type ServerAuthProvider } from "./serverAuthProvider";
import { clearSession, loadStoredSession, onUnauthorized } from "./session";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export const SESSION_EXPIRED_NOTICE = "Your session expired. Sign in again.";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** One-shot message for the sign-in page (e.g. "session expired"). */
  notice: string | null;
  clearNotice(): void;
  signIn(input: { email: string; password: string; remember?: boolean }): Promise<void>;
  register(input: { email: string; password: string; displayName?: string; remember?: boolean }): Promise<void>;
  signOut(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Deletes the server account (password re-checked by the server) and signs out. */
  deleteAccount(password: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Empties the shared workspace store so one identity's data is never shown to the next. */
function resetWorkspaceView() {
  useWorkspace.setState({ state: null, error: null, persistError: null, loadIssue: null, remoteRev: null });
}

/** Points the workspace at the server (as the current session) and loads it. */
async function bindWorkspace(): Promise<boolean> {
  resetWorkspaceView();
  const ok = await useWorkspace.getState().switchRepository(createRemoteRepository());
  if (!ok) useWorkspace.getState().clearError();
  return ok;
}

/**
 * Auth state. Starts "loading" only when a stored server session must be verified with GET /api/auth/me;
 * otherwise it is known immediately (signed out).
 */
export function AuthContextProvider({ server = serverAuthProvider, children }: { server?: ServerAuthProvider; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; user: AuthUser | null }>(() => {
    scrubLegacyServerToken();
    return loadStoredSession() !== null ? { status: "loading", user: null } : { status: "signedOut", user: null };
  });
  const [notice, setNotice] = useState<string | null>(null);

  const toSignedOut = useCallback((message: string | null) => {
    resetWorkspaceView();
    setState({ status: "signedOut", user: null });
    setNotice(message);
  }, []);

  // The single 401 handler: the session is already cleared; show "session expired" on /sign-in.
  useEffect(() => onUnauthorized(() => toSignedOut(SESSION_EXPIRED_NOTICE)), [toSignedOut]);

  // Auto-login on reload: verify the stored session with GET /api/auth/me.
  useEffect(() => {
    if (state.status !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        const user = await server.restore();
        if (cancelled) return;
        if (!user) {
          // A 401 already moved us to signedOut (with its notice); otherwise just leave "loading".
          setState((st) => (st.status === "loading" ? { status: "signedOut", user: null } : st));
          return;
        }
        if (!(await bindWorkspace())) {
          clearSession();
          return toSignedOut("Could not load your workspace from the server. Sign in again.");
        }
        if (!cancelled) setState({ status: "signedIn", user });
      } catch (e) {
        // Server unreachable: keep the stored session so a reload can retry.
        if (!cancelled) toSignedOut(e instanceof Error ? e.message : "Cannot reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the initial state
  }, []);

  const enter = useCallback(
    async (user: AuthUser) => {
      if (!(await bindWorkspace())) {
        await server.logout();
        throw new Error("Signed in, but your workspace could not be loaded from the server. Try again.");
      }
      setNotice(null);
      setState({ status: "signedIn", user });
    },
    [server],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      notice,
      clearNotice: () => setNotice(null),
      signIn: async (i) => enter(await server.login(i)),
      register: async (i) => enter(await server.register(i)),
      signOut: async () => {
        await server.logout();
        toSignedOut(null);
      },
      changePassword: (c, n) => server.changePassword(c, n),
      deleteAccount: async (password) => {
        await server.deleteAccount(password);
        toSignedOut("Your account was deleted.");
      },
    }),
    [state, notice, enter, server, toSignedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthContextProvider>");
  return ctx;
}

/** Like useAuth but null outside a provider (for components that also render standalone). */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
