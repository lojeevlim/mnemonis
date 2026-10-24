import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AuthProvider, AuthUser } from "./authProvider";
import { LocalAuthProvider } from "./localAuthProvider";

export interface AuthContextValue {
  user: AuthUser | null;
  signUp(input: { displayName: string; email: string }): AuthUser;
  signIn(input: { email: string }): AuthUser;
  continueAsGuest(): AuthUser;
  signOut(): void;
  updateProfile(patch: { displayName?: string; email?: string }): AuthUser;
  deleteProfile(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Provides auth state backed by an AuthProvider (LocalAuthProvider by default). */
export function AuthContextProvider({ provider, children }: { provider?: AuthProvider; children: ReactNode }) {
  const [impl] = useState<AuthProvider>(() => provider ?? new LocalAuthProvider());
  const [user, setUser] = useState<AuthUser | null>(() => impl.getUser());

  const refresh = useCallback(() => setUser(impl.getUser()), [impl]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      signUp: (i) => {
        const u = impl.signUp(i);
        refresh();
        return u;
      },
      signIn: (i) => {
        const u = impl.signIn(i);
        refresh();
        return u;
      },
      continueAsGuest: () => {
        const u = impl.continueAsGuest();
        refresh();
        return u;
      },
      signOut: () => {
        impl.signOut();
        refresh();
      },
      updateProfile: (p) => {
        const u = impl.updateProfile(p);
        refresh();
        return u;
      },
      deleteProfile: () => {
        impl.deleteProfile();
        refresh();
      },
    }),
    [impl, user, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthContextProvider>");
  return ctx;
}
