import { createFakeServer, type FakeCall } from "./fakeServer";

type Reply = { status: number; json?: unknown; headers?: Record<string, string> } | "network-error";

export const SESSION_TOKEN = "ms_test_session_token_0123456789";
export const MCP_TOKEN_SECRET = "mn_test_mcp_secret_0123456789abcdef";

interface Tok {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** A scripted account server: auth + token endpoints, delegating state/ops to createFakeServer. */
export function createFakeAccounts(opts: { email?: string; password?: string; registrationOpen?: boolean; mcpUrl?: string } = {}) {
  const email = opts.email ?? "ada@example.com";
  const password = opts.password ?? "correct horse battery";
  const data = createFakeServer({ rev: 7, token: SESSION_TOKEN });
  const calls: FakeCall[] = [];
  const overrides = new Map<string, Reply[]>();
  const on = (key: string, reply: Reply) => overrides.set(key, [...(overrides.get(key) ?? []), reply]);
  const s = {
    sessionAlive: true,
    registered: [] as string[],
    tokens: [] as Tok[],
    password,
    deleted: false,
  };
  let seq = 0;
  const user = { id: "u1", email, displayName: "Ada" };

  const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers });
  const err = (status: number, code: string, message: string, headers?: Record<string, string>) =>
    json(status, { error: { code, message } }, headers);

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, string>) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, headers, body, rawBody });
    const key = `${method} ${url.pathname}`;
    const queued = overrides.get(key)?.shift();
    if (queued) {
      if (queued === "network-error") throw new TypeError("Failed to fetch");
      return json(queued.status, queued.json, queued.headers);
    }
    if (key === "GET /api/auth/config") {
      return json(200, { registrationOpen: opts.registrationOpen ?? true, ...(opts.mcpUrl ? { mcpUrl: opts.mcpUrl } : {}) });
    }
    if (key === "POST /api/auth/login") {
      if (body?.email?.toLowerCase() === email && body.password === s.password) {
        s.sessionAlive = true;
        return json(200, { token: SESSION_TOKEN, expiresAt: "2099-01-01T00:00:00Z", user });
      }
      return err(401, "invalid_credentials", "Invalid email or password");
    }
    if (key === "POST /api/auth/register") {
      if (body?.email === email) return err(409, "email_taken", "That email is already registered.");
      if ((body?.password ?? "").length < 12) return err(400, "weak_password", "Password must be at least 12 characters.");
      s.registered.push(body!.email);
      return json(201, { token: SESSION_TOKEN, expiresAt: "2099-01-01T00:00:00Z", user: { id: "u2", email: body!.email, displayName: body!.displayName ?? null } });
    }
    if (key === "GET /api/health") return data.fetch(input, init);
    // Everything below needs the session.
    if (headers.Authorization !== `Bearer ${SESSION_TOKEN}` || !s.sessionAlive) {
      return err(401, "unauthorized", "Unauthorized");
    }
    if (key === "GET /api/auth/me") return json(200, { ...user, session: { expiresAt: "2099-01-01T00:00:00Z" } });
    if (key === "POST /api/auth/logout") {
      s.sessionAlive = false;
      return json(204);
    }
    if (key === "POST /api/auth/password") {
      if (body?.currentPassword !== s.password) return err(401, "invalid_credentials", "Invalid password");
      s.password = body.newPassword;
      return json(204);
    }
    if (key === "DELETE /api/auth/me") {
      if (body?.password !== s.password) return err(401, "invalid_credentials", "Invalid password");
      s.deleted = true;
      s.sessionAlive = false;
      return json(204);
    }
    if (key === "GET /api/tokens") return json(200, { tokens: s.tokens });
    if (key === "POST /api/tokens") {
      if (s.tokens.filter((t) => !t.revokedAt).length >= 20) return err(409, "token_limit_reached", "Too many tokens");
      const t: Tok = {
        id: `t${++seq}`,
        label: body!.label,
        prefix: MCP_TOKEN_SECRET.slice(0, 8),
        createdAt: "2026-01-01T00:00:00Z",
        lastUsedAt: null,
        expiresAt: "2099-01-01T00:00:00Z",
        revokedAt: null,
      };
      s.tokens.push(t);
      return json(201, { id: t.id, token: MCP_TOKEN_SECRET, prefix: t.prefix, label: t.label, createdAt: t.createdAt, expiresAt: t.expiresAt });
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/tokens/")) {
      const t = s.tokens.find((x) => x.id === url.pathname.split("/").pop());
      if (!t) return err(404, "not_found", "No such token");
      t.revokedAt ??= "2026-02-01T00:00:00Z";
      return json(204);
    }
    return data.fetch(input, init);
  }) as typeof fetch;

  return { fetch: fetchFn, calls, on, state: s, data, email, password };
}
