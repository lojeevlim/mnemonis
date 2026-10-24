/** Connection settings for the optional Mnemonis server. Stored in this browser only; the token is never put in a URL. */
export const SERVER_SETTINGS_KEY = "mnemonis.server.v1";
export const DEFAULT_SERVER_URL = "http://localhost:8787";

export interface ServerSettings {
  url: string;
  token: string;
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

export function loadServerSettings(): ServerSettings | null {
  try {
    const raw = globalThis.localStorage?.getItem(SERVER_SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ServerSettings> | null;
    const url = typeof p?.url === "string" ? normalizeServerUrl(p.url) : null;
    if (!url || typeof p?.token !== "string" || !p.token.trim()) return null;
    return { url, token: p.token.trim() };
  } catch {
    return null;
  }
}

/** Returns false when browser storage is unavailable. */
export function saveServerSettings(s: ServerSettings): boolean {
  try {
    globalThis.localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify({ url: s.url, token: s.token }));
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
