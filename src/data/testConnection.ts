export interface ConnectionTestResult {
  ok: boolean;
  /** Safe to show to the user (never contains the token). */
  message: string;
  rev?: number;
  schemaVersion?: number;
}

/** Checks GET /api/health (no auth), then an authenticated GET /api/state. */
export async function testServerConnection(
  baseUrl: string,
  token: string,
  fetchFn: typeof fetch = (...a) => globalThis.fetch(...a),
): Promise<ConnectionTestResult> {
  const base = baseUrl.replace(/\/+$/, "");
  let health: { schemaVersion?: number };
  try {
    const r = await fetchFn(`${base}/api/health`, { cache: "no-store" });
    if (!r.ok) return { ok: false, message: `The server answered HTTP ${r.status} on /api/health.` };
    health = (await r.json()) as { schemaVersion?: number };
  } catch {
    return { ok: false, message: `Cannot reach a Mnemonis server at ${base}. Is it running (and is this origin allowed by CORS)?` };
  }
  try {
    const r = await fetchFn(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (r.status === 401) return { ok: false, message: "The server is reachable but rejected the token (401)." };
    if (!r.ok) return { ok: false, message: `The server answered HTTP ${r.status} on /api/state.` };
    const j = (await r.json()) as { rev?: number };
    return {
      ok: true,
      message: "Connection works.",
      rev: typeof j.rev === "number" ? j.rev : undefined,
      schemaVersion: health.schemaVersion,
    };
  } catch {
    return { ok: false, message: "The authenticated request to the server failed." };
  }
}
