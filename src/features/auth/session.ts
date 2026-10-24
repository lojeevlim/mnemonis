/**
 * The login session token (server accounts). Kept in memory and in sessionStorage (this tab); only when the user
 * opts in to "Stay signed in on this device" is it also written to localStorage. It is never logged, never put in a
 * URL, and sent only as an Authorization header. 401s from the server funnel through reportUnauthorized().
 */
export const SESSION_STORAGE_KEY = "mnemonis.session.v1";

let memoryToken: string | null = null;
let remembered = false;

const listeners = new Set<() => void>();

function store(kind: "session" | "local"): Storage | null {
  try {
    return (kind === "session" ? globalThis.sessionStorage : globalThis.localStorage) ?? null;
  } catch {
    return null;
  }
}

const valid = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length < 512;

export function getSessionToken(): string | null {
  return memoryToken;
}

export function isSessionRemembered(): boolean {
  return remembered;
}

/** Restores a stored token into memory (sessionStorage first, then the opt-in localStorage copy). */
export function loadStoredSession(): string | null {
  if (memoryToken) return memoryToken;
  for (const kind of ["session", "local"] as const) {
    try {
      const t = store(kind)?.getItem(SESSION_STORAGE_KEY);
      if (valid(t)) {
        memoryToken = t;
        remembered = kind === "local";
        return t;
      }
    } catch {
      /* storage unavailable */
    }
  }
  return null;
}

/** Remembers a fresh session token. `remember` also writes the opt-in localStorage copy. */
export function setSession(token: string, opts: { remember?: boolean } = {}): void {
  memoryToken = token;
  remembered = opts.remember === true;
  try {
    store("session")?.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    /* memory copy still works until reload */
  }
  try {
    if (remembered) store("local")?.setItem(SESSION_STORAGE_KEY, token);
    else store("local")?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function clearSession(): void {
  memoryToken = null;
  remembered = false;
  for (const kind of ["session", "local"] as const) {
    try {
      store(kind)?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/** Subscribes to "the server rejected the session". Returns an unsubscribe function. */
export function onUnauthorized(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The single 401 handler: drops the session, then lets the auth provider redirect to /sign-in. */
export function reportUnauthorized(): void {
  if (!memoryToken && !loadStoredSession()) return; // already signed out
  clearSession();
  for (const fn of [...listeners]) fn();
}
