import { getServerUrl } from "./serverSettings";
import { getSessionToken, reportUnauthorized } from "../features/auth/session";

/** A failed call to the account / token REST API. Messages are safe to show (they never contain credentials). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds from a 429 Retry-After header. */
  readonly retryAfter: number | null;
  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Send the session as a Bearer token (default true). */
  auth?: boolean;
  /** A 401 from an auth-less or password-checking call is the caller's business, not an expired session. */
  expireOn401?: boolean;
  fetch?: typeof fetch;
}

export function retryAfterSeconds(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

/**
 * JSON request against the server. Resolves the parsed body (undefined for 204). Network failures throw
 * ApiError(0, "network"). A 401 whose code is not "invalid_credentials" on an authenticated call means the session
 * is gone: the single unauthorized handler runs.
 */
export async function apiRequest<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const base = getServerUrl();
  const auth = opts.auth !== false;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const t = getSessionToken();
    if (!t) throw new ApiError(401, "unauthorized", "You are not signed in.");
    headers.Authorization = `Bearer ${t}`;
  }
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  let r: Response;
  try {
    r = await f(base + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", `Cannot reach the Mnemonis server at ${base}.`);
  }
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    try {
      return (await r.json()) as T;
    } catch {
      throw new ApiError(r.status, "bad_response", "The server sent an unreadable response.");
    }
  }
  let code = "";
  let message = "";
  try {
    const j = (await r.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof j.error?.code === "string") code = j.error.code;
    if (typeof j.error?.message === "string") message = j.error.message;
  } catch {
    /* not JSON */
  }
  if (r.status === 401 && auth && opts.expireOn401 !== false && code !== "invalid_credentials") reportUnauthorized();
  throw new ApiError(r.status, code || `http_${r.status}`, message || `The server failed (HTTP ${r.status}).`, retryAfterSeconds(r.headers.get("Retry-After")));
}

/** Short, user-facing text for any failure (uniform for credential errors, rate limits shown with the wait). */
export function describeApiError(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : fallback;
  if (e.status === 429) {
    return e.retryAfter !== null
      ? `Too many attempts. Try again in ${e.retryAfter} second${e.retryAfter === 1 ? "" : "s"}.`
      : "Too many attempts. Try again in a moment.";
  }
  if (e.code === "invalid_credentials") return e.message || "Invalid email or password.";
  if (e.status === 0 || e.status === 400 || e.status === 409 || e.status === 413) return e.message;
  return fallback;
}
