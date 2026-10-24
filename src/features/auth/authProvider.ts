/**
 * Auth abstraction. Only LocalAuthProvider exists: a single local profile kept in
 * this browser's localStorage. There is no server, no password and no session
 * token. A Supabase-backed provider can implement the same interface later.
 */
export interface AuthUser {
  displayName: string;
  email: string;
  createdAt: string;
  /** True when created through "Continue in local demo mode". */
  guest: boolean;
}

export interface AuthProvider {
  /** The signed-in user, or null. Synchronous: local mode reads storage directly. */
  getUser(): AuthUser | null;
  /** True when a profile exists on this device (even if signed out). */
  hasProfile(): boolean;
  /** Creates (or replaces) the local profile and signs in. */
  signUp(input: { displayName: string; email: string }): AuthUser;
  /** Signs in to the existing local profile; throws if none matches. No password is read or stored. */
  signIn(input: { email: string }): AuthUser;
  /** Creates a default guest profile and signs in. */
  continueAsGuest(): AuthUser;
  signOut(): void;
  updateProfile(patch: { displayName?: string; email?: string }): AuthUser;
  /** Removes the local profile entirely (local "account deletion"). */
  deleteProfile(): void;
}
