import type { AuthProvider, AuthUser } from "./authProvider";

export const AUTH_STORAGE_KEY = "mnemonis.auth.v1";

interface Stored {
  version: 1;
  profile: AuthUser;
  signedIn: boolean;
}

export const GUEST_NAME = "Local user";

export class LocalAuthProvider implements AuthProvider {
  /** Fallback when storage is unavailable, so the session still works until reload. */
  private memory: Stored | null = null;

  private read(): Stored | null {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return this.memory;
      const p = JSON.parse(raw) as Partial<Stored> | null;
      const u = p?.profile;
      if (
        p?.version !== 1 ||
        !u ||
        typeof u.displayName !== "string" ||
        typeof u.email !== "string" ||
        typeof u.createdAt !== "string" ||
        typeof p.signedIn !== "boolean"
      ) {
        return this.memory;
      }
      return { version: 1, profile: { displayName: u.displayName, email: u.email, createdAt: u.createdAt, guest: u.guest === true }, signedIn: p.signedIn };
    } catch {
      return this.memory;
    }
  }

  private write(s: Stored | null): void {
    this.memory = s;
    try {
      if (s) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(s));
      else localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* storage unavailable: keep the in-memory copy */
    }
  }

  getUser(): AuthUser | null {
    const s = this.read();
    return s?.signedIn ? s.profile : null;
  }

  hasProfile(): boolean {
    return this.read() !== null;
  }

  signUp({ displayName, email }: { displayName: string; email: string }): AuthUser {
    const name = displayName.trim();
    if (!name) throw new Error("Display name is required.");
    // Never silently replace a real profile (only the anonymous guest placeholder can be upgraded).
    const existing = this.read();
    if (existing && !existing.profile.guest) {
      throw new Error(
        "A local profile already exists on this device. Sign in to it, or clear all local data in Settings to start over.",
      );
    }
    const profile: AuthUser = { displayName: name, email: email.trim(), createdAt: new Date().toISOString(), guest: false };
    this.write({ version: 1, profile, signedIn: true });
    return profile;
  }

  signIn({ email }: { email: string }): AuthUser {
    const s = this.read();
    if (!s || s.profile.guest || s.profile.email.toLowerCase() !== email.trim().toLowerCase()) {
      throw new Error("No local profile with that email exists on this device. Create one, or continue in local demo mode.");
    }
    this.write({ ...s, signedIn: true });
    return s.profile;
  }

  continueAsGuest(): AuthUser {
    const existing = this.read();
    if (existing) {
      this.write({ ...existing, signedIn: true });
      return existing.profile;
    }
    const profile: AuthUser = { displayName: GUEST_NAME, email: "", createdAt: new Date().toISOString(), guest: true };
    this.write({ version: 1, profile, signedIn: true });
    return profile;
  }

  signOut(): void {
    const s = this.read();
    if (s) this.write({ ...s, signedIn: false });
  }

  updateProfile(patch: { displayName?: string; email?: string }): AuthUser {
    const s = this.read();
    if (!s) throw new Error("No local profile to update.");
    const displayName = patch.displayName === undefined ? s.profile.displayName : patch.displayName.trim();
    if (!displayName) throw new Error("Display name is required.");
    const email = patch.email === undefined ? s.profile.email : patch.email.trim();
    const profile: AuthUser = { ...s.profile, displayName, email, guest: s.profile.guest && email === "" };
    this.write({ ...s, profile });
    return profile;
  }

  deleteProfile(): void {
    this.write(null);
  }
}
