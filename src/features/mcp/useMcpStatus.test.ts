import { deriveMcpStatus } from "./useMcpStatus";
import type { McpToken } from "./tokensApi";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const tok = (o: Partial<McpToken> = {}): McpToken => ({
  id: "t1",
  label: "x",
  prefix: "mn_x",
  createdAt: "2026-10-01T00:00:00Z",
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...o,
});

describe("deriveMcpStatus", () => {
  it("is local when not remote, without caring about tokens", () => {
    expect(deriveMcpStatus({ remote: false, tokens: [tok()], now: NOW })).toEqual({ kind: "local" });
  });

  it("is loading until tokens arrive and error when the fetch failed", () => {
    expect(deriveMcpStatus({ remote: true, tokens: null, now: NOW }).kind).toBe("loading");
    expect(deriveMcpStatus({ remote: true, tokens: null, failed: true, now: NOW }).kind).toBe("error");
  });

  it("ignores revoked and expired tokens", () => {
    const tokens = [tok({ revokedAt: "2026-10-02T00:00:00Z" }), tok({ expiresAt: "2026-10-03T00:00:00Z" })];
    expect(deriveMcpStatus({ remote: true, tokens, now: NOW }).kind).toBe("none");
    expect(deriveMcpStatus({ remote: true, tokens: [], now: NOW }).kind).toBe("none");
  });

  it("waits for a client when active tokens were never used", () => {
    expect(deriveMcpStatus({ remote: true, tokens: [tok(), tok({ id: "t2" })], now: NOW })).toEqual({ kind: "waiting", active: 2 });
  });

  it("is connected when the latest use is within 24h, idle after", () => {
    const recent = tok({ lastUsedAt: "2026-10-26T10:00:00Z" });
    const old = tok({ id: "t2", lastUsedAt: "2026-10-01T10:00:00Z" });
    expect(deriveMcpStatus({ remote: true, tokens: [old, recent], now: NOW })).toEqual({ kind: "connected", active: 2, lastUsedAt: "2026-10-26T10:00:00Z" });
    expect(deriveMcpStatus({ remote: true, tokens: [old], now: NOW }).kind).toBe("idle");
  });
});
