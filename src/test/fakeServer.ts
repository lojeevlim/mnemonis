import {
  applyReassignments,
  confirmProject,
  createEmptyWorkspace,
  createProject,
  createSequentialContext,
  deleteProject,
  DomainError,
  renameProject,
  SCHEMA_VERSION,
  type Actor,
  type WorkspaceState,
} from "../domain";

export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string | undefined;
}

type Reply = { status: number; json?: unknown; text?: string } | "network-error";

const STATUS: Record<string, number> = {
  project_not_found: 404,
  duplicate_project: 409,
  project_in_use: 409,
  invalid_input: 400,
  too_large: 422,
  forbidden: 403,
};

/** A scripted stand-in for the Mnemonis server's fetch API. */
export function createFakeServer(initial: { rev?: number; state?: WorkspaceState; token?: string } = {}) {
  const token = initial.token ?? "tok";
  const s = { rev: initial.rev ?? 1, state: initial.state ?? createEmptyWorkspace() };
  const calls: FakeCall[] = [];
  const ctx = createSequentialContext("2030-01-01T00:00:00.000Z");
  const user: Actor = { kind: "user", name: "ada" };
  /** Per-"METHOD path" override consumed once (FIFO). */
  const overrides = new Map<string, Reply[]>();
  const on = (key: string, reply: Reply) => overrides.set(key, [...(overrides.get(key) ?? []), reply]);

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      body = undefined;
    }
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, headers, body, rawBody });
    const key = `${method} ${url.pathname}`;
    const queued = overrides.get(key)?.shift();
    const reply = (r: Reply): Response => {
      if (r === "network-error") throw new TypeError("Failed to fetch");
      return new Response(r.status === 304 ? null : (r.text ?? JSON.stringify(r.json ?? {})), { status: r.status });
    };
    if (queued) return reply(queued);
    if (url.pathname === "/api/health") return reply({ status: 200, json: { ok: true, schemaVersion: SCHEMA_VERSION, rev: s.rev } });
    if (headers.Authorization !== `Bearer ${token}`) {
      return reply({ status: 401, json: { error: { code: "unauthorized", message: "bad token" } } });
    }
    if (key === "GET /api/state") {
      if (headers["If-None-Match"] === `"${s.rev}"`) return reply({ status: 304 });
      return reply({ status: 200, json: { rev: s.rev, state: s.state } });
    }
    if (key === "GET /api/export") return reply({ status: 200, text: JSON.stringify({ schemaVersion: SCHEMA_VERSION, state: s.state }) });
    if (key === "PUT /api/state") {
      if (headers["If-Match"] !== `"${s.rev}"`) {
        return reply({ status: 409, json: { error: { code: "conflict", message: "stale" }, currentRev: s.rev } });
      }
      s.rev += 1;
      s.state = (body as { state: WorkspaceState }).state;
      return reply({ status: 200, json: { rev: s.rev, state: s.state } });
    }
    if (method === "POST" && url.pathname.startsWith("/api/ops/")) {
      const name = url.pathname.slice("/api/ops/".length);
      const args = (body ?? {}) as Record<string, string & string[]>;
      // The project ops run the real domain as the session user (like the server), everything else is a scripted echo.
      const projectOps: Record<string, () => { state: WorkspaceState; value: unknown }> = {
        createProject: () => createProject(s.state, ctx, { name: args.name, repo: args.repo, workspace: args.workspace, actor: user }),
        confirmProject: () => confirmProject(s.state, { id: args.id, actor: user }, ctx),
        renameProject: () => renameProject(s.state, { id: args.id, name: args.name, actor: user }, ctx),
        deleteProject: () => deleteProject(s.state, { id: args.id, actor: user }),
        fileUnsorted: () => applyReassignments(s.state, ctx, { ids: args.ids, actor: user }),
      };
      if (projectOps[name]) {
        try {
          const r = projectOps[name]();
          s.rev += 1;
          s.state = r.state;
          return reply({ status: 200, json: { rev: s.rev, state: s.state, value: r.value ?? null } });
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          return reply({ status: STATUS[e.code] ?? 500, json: { error: { code: e.code, message: e.message } } });
        }
      }
      s.rev += 1;
      return reply({ status: 200, json: { rev: s.rev, state: s.state, value: "v" } });
    }
    return reply({ status: 404, json: { error: { code: "unknown_op", message: "nope" } } });
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    calls,
    on,
    server: s,
    /** Simulates another client (an MCP agent) changing the server data. */
    externalChange(state: WorkspaceState) {
      s.rev += 1;
      s.state = state;
    },
  };
}
