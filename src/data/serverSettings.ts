/**
 * Where the Mnemonis API server lives. Default: VITE_API_URL (VITE_MCP_SERVER_URL is still read as an alias for one
 * release), else http://localhost:8787. The MCP adapter is a separate server whose URL comes from the API itself
 * (GET /api/auth/config -> mcpUrl). A URL stored in this
 * browser (Settings override) wins. No credential is ever stored here: the session lives in features/auth/session.ts.
 */
export const SERVER_SETTINGS_KEY = "mnemonis.server.v1";
export const DEFAULT_SERVER_URL = "http://localhost:8787";

export interface ServerSettings {
  url: string;
}

/** Trims and strips trailing slashes. Returns null unless it is an http(s) URL without credentials/query/hash. */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** The stored URL override, or null. Any `token` field left by an older version is ignored. */
export function loadServerSettings(): ServerSettings | null {
  try {
    const raw = globalThis.localStorage?.getItem(SERVER_SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ServerSettings> | null;
    const url = typeof p?.url === "string" ? normalizeServerUrl(p.url) : null;
    return url ? { url } : null;
  } catch {
    return null;
  }
}

/** Returns false when browser storage is unavailable. */
export function saveServerSettings(s: ServerSettings): boolean {
  try {
    globalThis.localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify({ url: s.url }));
    return true;
  } catch {
    return false;
  }
}

export function clearServerSettings(): void {
  try {
    globalThis.localStorage?.removeItem(SERVER_SETTINGS_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Rewrites an old `{url, token}` entry as `{url}` so a pasted token no longer sits in storage. */
export function scrubLegacyServerToken(): void {
  try {
    const raw = globalThis.localStorage?.getItem(SERVER_SETTINGS_KEY);
    if (!raw || !/"token"/.test(raw)) return;
    const s = loadServerSettings();
    if (s) saveServerSettings(s);
    else clearServerSettings();
  } catch {
    /* storage unavailable */
  }
}

/** The server base URL to use (no trailing slash). */
export function getServerUrl(): string {
  const stored = loadServerSettings()?.url;
  if (stored) return stored;
  const env = ((import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.VITE_MCP_SERVER_URL as string | undefined))?.trim();
  return (env && normalizeServerUrl(env)) || DEFAULT_SERVER_URL;
}
