import { ApiError, apiRequest } from "../../data/accountApi";
import type { AuthUser } from "./authProvider";
import { clearSession, loadStoredSession, setSession } from "./session";

export interface AuthConfig {
  registrationOpen: boolean;
  /** The MCP adapter's endpoint, exactly as the API publishes it (GET /api/auth/config), or undefined when none/unsafe. */
  mcpUrl?: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The MCP URL comes from the server, so it is treated as untrusted text: it is shown as text and put in a command only
 * when it is https, or http on this machine, with no credentials, query or fragment, the path is exactly /mcp, and the
 * host is a plain DNS name / IPv4 literal ([A-Za-z0-9.-]) or a bracketed IPv6 literal (it ends up in a shell command).
 * Anything else is dropped.
 */
export function safeMcpUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || !v || v.length > 2048) return undefined;
  try {
    const u = new URL(v);
    const ok = u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
    const okHost = /^[A-Za-z0-9.-]+$/.test(u.hostname) || /^\[[0-9A-Fa-f:.]+\]$/.test(u.hostname);
    if (!ok || !okHost || u.pathname !== "/mcp" || u.username || u.password || u.search || u.hash) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

interface UserDto {
  id?: unknown;
  email?: unknown;
  displayName?: unknown;
}

function toUser(d: UserDto): AuthUser {
  if (typeof d?.email !== "string") throw new ApiError(200, "bad_response", "The server sent an unexpected response.");
  const email = d.email;
  const displayName = typeof d.displayName === "string" && d.displayName.trim() ? d.displayName : email.split("@")[0];
  return { id: typeof d.id === "string" ? d.id : undefined, email, displayName };
}

/**
 * A call that re-checks the password. A 401 here may mean "wrong password" or "session gone"; ask /api/auth/me which
 * (a dead session then goes through the single unauthorized handler) so a typo never signs the user out.
 */
async function passwordChecked(path: string, method: "POST" | "DELETE", body: unknown): Promise<void> {
  try {
    await apiRequest(path, { method, body, expireOn401: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      try {
        await apiRequest("/api/auth/me");
      } catch (me) {
        if (me instanceof ApiError && me.status === 401) throw new ApiError(401, "unauthorized", "Your session expired.");
      }
      throw new ApiError(401, "invalid_credentials", "The password is incorrect.");
    }
    throw e;
  }
}

/** Accounts on the Mnemonis server: register / login / logout / me. The session token lives in ./session. */
export const serverAuthProvider = {
  /** GET /api/auth/config. Falls back to "open" when the server cannot be asked (the register call decides). */
  async config(): Promise<AuthConfig> {
    try {
      const c = await apiRequest<{ registrationOpen?: unknown; mcpUrl?: unknown }>("/api/auth/config", { auth: false });
      return {
        registrationOpen: c?.registrationOpen !== false,
        mcpUrl: safeMcpUrl(c?.mcpUrl),
      };
    } catch {
      return { registrationOpen: true };
    }
  },

  async register(i: { email: string; password: string; displayName?: string; remember?: boolean }): Promise<AuthUser> {
    const body: Record<string, string> = { email: i.email.trim(), password: i.password };
    if (i.displayName?.trim()) body.displayName = i.displayName.trim();
    const r = await apiRequest<{ token: string; user: UserDto }>("/api/auth/register", { method: "POST", body, auth: false });
    const user = toUser(r.user);
    setSession(r.token, { remember: i.remember });
    return user;
  },

  async login(i: { email: string; password: string; remember?: boolean }): Promise<AuthUser> {
    let r: { token: string; user: UserDto };
    try {
      r = await apiRequest("/api/auth/login", { method: "POST", body: { email: i.email.trim(), password: i.password }, auth: false });
    } catch (e) {
      // Uniform: every 401 reads the same (the server does not say whether the email exists).
      if (e instanceof ApiError && e.status === 401) throw new ApiError(401, "invalid_credentials", "Invalid email or password.");
      throw e;
    }
    const user = toUser(r.user);
    setSession(r.token, { remember: i.remember });
    return user;
  },

  /** Revokes the session on the server (best effort) and forgets it here. */
  async logout(): Promise<void> {
    try {
      await apiRequest("/api/auth/logout", { method: "POST", expireOn401: false });
    } catch {
      /* the local session is dropped regardless */
    }
    clearSession();
  },

  /** The user for the stored session, or null when there is none or the server rejected it (session cleared). */
  async restore(): Promise<AuthUser | null> {
    if (!loadStoredSession()) return null;
    try {
      return toUser(await apiRequest<UserDto>("/api/auth/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null; // already cleared by the 401 handler
      throw e;
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await passwordChecked("/api/auth/password", "POST", { currentPassword, newPassword });
  },

  /** Deletes the account and all its data on the server. */
  async deleteAccount(password: string): Promise<void> {
    await passwordChecked("/api/auth/me", "DELETE", { password });
    clearSession();
  },
};

export type ServerAuthProvider = typeof serverAuthProvider;
