/**
 * Auth types. Two providers exist:
 * - serverAuthProvider: real accounts on the Mnemonis server (email + password, bearer session).
 * - LocalAuthProvider: only for the explicit "Use without an account (this browser only)" mode.
 */
export interface AuthUser {
  /** Server user id (server accounts only). */
  id?: string;
  displayName: string;
  email: string;
  createdAt?: string;
  /** True for the anonymous "Use without an account" profile. */
  guest: boolean;
}

/** Local, this-browser-only profile. No password, no server. */
export interface AuthProvider {
  /** The profile when signed in to local mode, or null. */
  getUser(): AuthUser | null;
  /** True when a profile exists on this device (even if signed out). */
  hasProfile(): boolean;
  /** Creates (or reuses) the anonymous local profile and signs in. */
  continueAsGuest(): AuthUser;
  signOut(): void;
  updateProfile(patch: { displayName?: string; email?: string }): AuthUser;
  /** Removes the local profile entirely. */
  deleteProfile(): void;
}
