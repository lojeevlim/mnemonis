import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRemoteRepository } from "../../data/createRepository";
import { LocalRepository } from "../../data/localRepository";
import { scrubLegacyServerToken } from "../../data/serverSettings";
import { useWorkspace } from "../../stores/workspaceStore";
import type { AuthProvider, AuthUser } from "./authProvider";
import { LocalAuthProvider } from "./localAuthProvider";
import { serverAuthProvider, type ServerAuthProvider } from "./serverAuthProvider";
import { clearSession, loadStoredSession, onUnauthorized } from "./session";

export type AuthStatus = "loading" | "signedIn" | "signedOut";
/** "server" = a real account; "local" = "Use without an account" (this browser only). */
export type AuthMode = "server" | "local";

export const SESSION_EXPIRED_NOTICE = "Your session expired. Sign in again.";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  mode: AuthMode | null;
  /** One-shot message for the sign-in page (e.g. "session expired"). */
  notice: string | null;
  clearNotice(): void;
  signIn(input: { email: string; password: string; remember?: boolean }): Promise<void>;
  register(input: { email: string; password: string; displayName?: string; remember?: boolean }): Promise<void>;
  /** "Use without an account (this browser only)". */
  continueLocal(): void;
  signOut(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Deletes the server account (password re-checked by the server) and signs out. */
  deleteAccount(password: string): Promise<void>;
  /** Local mode only. */
  updateProfile(patch: { displayName?: string; email?: string }): AuthUser;
  /** Local mode only: removes the local profile and signs out. */
  deleteProfile(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Empties the shared workspace store so one identity's data is never shown to the next. */
function resetWorkspaceView() {
  useWorkspace.setState({ state: null, error: null, persistError: null, loadIssue: null, remoteRev: null });
}

/** Points the workspace at the server (as the current session) or at this browser, and loads it. */
async function bindWorkspace(target: "server" | "local"): Promise<boolean> {
  resetWorkspaceView();
  const ok = await useWorkspace
    .getState()
    .switchRepository(target === "server" ? createRemoteRepository() : new LocalRepository());
  if (!ok) useWorkspace.getState().clearError();
  return ok;
}

/**
 * Auth state. Starts "loading" only when a stored server session must be verified with GET /api/auth/me;
 * otherwise it is known immediately (a signed-in local profile, or signed out).
 */
export function AuthContextProvider({
  server = serverAuthProvider,
  local: localProp,
  children,
}: {
  server?: ServerAuthProvider;
  local?: AuthProvider;
  children: ReactNode;
}) {
  const [local] = useState<AuthProvider>(() => localProp ?? new LocalAuthProvider());
  const [state, setState] = useState<{ status: AuthStatus; user: AuthUser | null; mode: AuthMode | null }>(() => {
    scrubLegacyServerToken();
    const lu = local.getUser();
    if (lu) return { status: "signedIn", user: lu, mode: "local" };
    return loadStoredSession() !== null ? { status: "loading", user: null, mode: null } : { status: "signedOut", user: null, mode: null };
  });
  const [notice, setNotice] = useState<string | null>(null);

  /** `keepView`: leaving local mode keeps the browser workspace as is (only server data must not linger). */
  const toSignedOut = useCallback((message: string | null, keepView = false) => {
    if (!keepView) resetWorkspaceView();
    setState({ status: "signedOut", user: null, mode: null });
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
          setState((st) => (st.status === "loading" ? { status: "signedOut", user: null, mode: null } : st));
          return;
        }
        if (!(await bindWorkspace("server"))) {
          clearSession();
          return toSignedOut("Could not load your workspace from the server. Sign in again.");
        }
        if (!cancelled) setState({ status: "signedIn", user, mode: "server" });
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
      local.signOut(); // leave local mode: only one identity is active
      if (!(await bindWorkspace("server"))) {
        await server.logout();
        throw new Error("Signed in, but your workspace could not be loaded from the server. Try again.");
      }
      setNotice(null);
      setState({ status: "signedIn", user, mode: "server" });
    },
    [local, server],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      notice,
      clearNotice: () => setNotice(null),
      signIn: async (i) => enter(await server.login(i)),
      register: async (i) => enter(await server.register(i)),
      continueLocal: () => {
        clearSession();
        const user = local.continueAsGuest();
        setNotice(null);
        setState({ status: "signedIn", user, mode: "local" });
        void bindWorkspace("local"); // never show a previous server identity's data
      },
      signOut: async () => {
        if (state.mode === "server") await server.logout();
        else local.signOut();
        toSignedOut(null, state.mode === "local");
      },
      changePassword: (c, n) => server.changePassword(c, n),
      deleteAccount: async (password) => {
        await server.deleteAccount(password);
        toSignedOut("Your account was deleted.");
      },
      updateProfile: (p) => {
        const u = local.updateProfile(p);
        setState((s) => (s.mode === "local" ? { ...s, user: u } : s));
        return u;
      },
      deleteProfile: () => {
        local.deleteProfile();
        if (state.mode === "server") void server.logout();
        toSignedOut(null, state.mode !== "server");
      },
    }),
    [state, notice, enter, server, local, toSignedOut],
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
