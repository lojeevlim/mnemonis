import { createEmptyWorkspace, DomainError, SCHEMA_VERSION } from "../domain";
import { createFakeServer } from "../test/fakeServer";
import { RemoteError, RemoteRepository } from "./remoteRepository";

const BASE = "http://localhost:8787";
const user = { kind: "user", name: "me" } as const;
const agent = { kind: "agent", name: "bot" } as const;

function setup(opts?: Parameters<typeof createFakeServer>[0], token = "tok") {
  const fake = createFakeServer(opts);
  const repo = new RemoteRepository({ baseUrl: BASE + "/", token, fetch: fake.fetch });
  return { fake, repo };
}

describe("RemoteRepository reads", () => {
  it("load() GETs /api/state with the bearer token in a header only", async () => {
    const { fake, repo } = setup({ rev: 4 });
    const state = await repo.load();
    expect(state).toEqual(fake.server.state);
    expect(repo.getRev()).toBe(4);
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/api/state" });
    expect(fake.calls[0].headers.Authorization).toBe("Bearer tok");
    expect(repo.getStatus()).toEqual({ loadIssue: null, persistError: null });
  });

  it("refresh() sends If-None-Match and returns null on 304, the new state when the rev changed", async () => {
    const { fake, repo } = setup({ rev: 4 });
    await repo.load();
    expect(await repo.refresh()).toBeNull();
    expect(fake.calls[1].headers["If-None-Match"]).toBe('"4"');
    const changed = { ...createEmptyWorkspace(), collections: { x: { id: "x" } } } as never;
    fake.externalChange(changed);
    expect(await repo.refresh()).toEqual(changed);
    expect(repo.getRev()).toBe(5);
    expect(await repo.refresh()).toBeNull();
  });

  it("export() returns the server's export text", async () => {
    const { repo } = setup();
    expect(JSON.parse(await repo.export())).toMatchObject({ schemaVersion: 2 });
  });

  it("save() is a no-op that makes no request", async () => {
    const { fake, repo } = setup();
    await repo.save();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("RemoteRepository mutations", () => {
  it.each([
    ["createMemory", (r: RemoteRepository) => r.createMemory({ title: "T", actor: user }), { title: "T" }],
    ["updateMemory", (r: RemoteRepository) => r.updateMemory({ id: "m", patch: { title: "n" }, actor: user }), { id: "m", patch: { title: "n" } }],
    ["archiveMemory", (r: RemoteRepository) => r.archiveMemory({ id: "m", actor: user }), { id: "m" }],
    ["restoreMemory", (r: RemoteRepository) => r.restoreMemory({ id: "m", actor: user }), { id: "m" }],
    ["rollbackMemory", (r: RemoteRepository) => r.rollbackMemory({ memoryId: "m", toRevisionId: "r", actor: user }), { memoryId: "m", toRevisionId: "r" }],
    [
      "addRelation",
      (r: RemoteRepository) =>
        r.addRelation({ fromId: "a", toId: "b", label: "l", provenance: { origin: "user", createdBy: "me" }, actor: user }),
      { fromId: "a", toId: "b", label: "l", provenance: { origin: "user", createdBy: "me" } },
    ],
    ["removeRelation", (r: RemoteRepository) => r.removeRelation({ id: "x", actor: user }), { id: "x" }],
    ["createCollection", (r: RemoteRepository) => r.createCollection({ name: "c" }), { name: "c" }],
    ["updateCollection", (r: RemoteRepository) => r.updateCollection({ id: "c", name: "d" }), { id: "c", name: "d" }],
    ["deleteCollection", (r: RemoteRepository) => r.deleteCollection({ id: "c" }), { id: "c" }],
    ["approve", (r: RemoteRepository) => r.approve({ revisionId: "r", actor: user }), { revisionId: "r" }],
    ["reject", (r: RemoteRepository) => r.reject({ revisionId: "r", actor: user }), { revisionId: "r" }],
    ["approveRelation", (r: RemoteRepository) => r.approveRelation({ relationId: "x", actor: user }), { relationId: "x" }],
    ["rejectRelation", (r: RemoteRepository) => r.rejectRelation({ relationId: "x", actor: user }), { relationId: "x" }],
    ["approveAll", (r: RemoteRepository) => r.approveAll({ actor: user, revisionIds: ["r"] }), { revisionIds: ["r"] }],
    ["rejectAll", (r: RemoteRepository) => r.rejectAll({ actor: user, relationIds: [] }), { relationIds: [] }],
    ["approveAllDetailed", (r: RemoteRepository) => r.approveAllDetailed({ actor: user }), {}],
    ["rejectAllDetailed", (r: RemoteRepository) => r.rejectAllDetailed({ actor: user }), {}],
  ])("%s POSTs /api/ops/%s with the args and no user actor", async (name, call, body) => {
    const { fake, repo } = setup();
    const m = await call(repo);
    const c = fake.calls.at(-1)!;
    expect(c).toMatchObject({ method: "POST", path: `/api/ops/${name}` });
    expect(c.body).toEqual(JSON.parse(JSON.stringify(body)));
    expect(c.rawBody).not.toContain('"actor"');
    expect(c.headers.Authorization).toBe("Bearer tok");
    expect(m.state).toEqual(fake.server.state);
    expect(m.value).toBe("v");
    expect(repo.getRev()).toBe(2);
  });

  it("sends an agent actor (downgrade) for memory writes and links", async () => {
    const { fake, repo } = setup();
    await repo.createMemory({ title: "T", actor: agent });
    expect(fake.calls.at(-1)!.body).toEqual({ title: "T", actor: { kind: "agent", name: "bot" } });
    await repo.addRelation({ fromId: "a", toId: "b", label: "l", provenance: { origin: "process", createdBy: "bot" }, actor: agent });
    expect(fake.calls.at(-1)!.body).toMatchObject({ actor: { kind: "agent", name: "bot" } });
  });

  it("refuses agent actors on review ops and removeRelation without calling the server", async () => {
    const { fake, repo } = setup();
    await expect(repo.approve({ revisionId: "r", actor: agent })).rejects.toMatchObject({ code: "forbidden" });
    await expect(repo.approveAll({ actor: agent })).rejects.toBeInstanceOf(DomainError);
    await expect(repo.removeRelation({ id: "x", actor: agent })).rejects.toMatchObject({ code: "forbidden" });
    expect(fake.calls).toHaveLength(0);
  });

  it("rebuilds DomainError(code, message) from {error} and keeps the persistence status clean", async () => {
    const { fake, repo } = setup();
    fake.on("POST /api/ops/approve", { status: 409, json: { error: { code: "not_pending", message: "Already decided" } } });
    const err = await repo.approve({ revisionId: "r", actor: user }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: "not_pending", message: "Already decided" });
    expect(repo.getStatus().persistError).toBeNull();
  });

  it("maps 401 to an unauthorized RemoteError and persistError, network failure to a network error", async () => {
    const { repo } = setup(undefined, "wrong");
    const e = await repo.archiveMemory({ id: "m", actor: user }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RemoteError);
    expect(e).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(repo.getStatus().persistError).toMatch(/session is no longer valid/);
    expect(repo.getStatus().persistError).not.toContain("wrong");

    const b = setup();
    b.fake.on("POST /api/ops/archiveMemory", "network-error");
    const n = await b.repo.archiveMemory({ id: "m", actor: user }).catch((x: unknown) => x);
    expect(n).toMatchObject({ kind: "network" });
    expect(b.repo.getStatus().persistError).toMatch(/Cannot reach/);
    await b.repo.archiveMemory({ id: "m", actor: user }); // recovers and clears
    expect(b.repo.getStatus().persistError).toBeNull();
  });

  it("serializes requests so a poll never overlaps a mutation", async () => {
    const { fake, repo } = setup();
    await repo.load();
    const order: string[] = [];
    const orig = fake.fetch;
    let active = 0;
    let maxActive = 0;
    const slow = (async (...a: Parameters<typeof fetch>) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      const r = await orig(...a);
      active--;
      order.push(String(a[1]?.method));
      return r;
    }) as typeof fetch;
    const repo2 = new RemoteRepository({ baseUrl: BASE, token: "tok", fetch: slow });
    await repo2.load();
    order.length = 0;
    await Promise.all([repo2.refresh(), repo2.archiveMemory({ id: "m", actor: user }), repo2.refresh()]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["GET", "POST", "GET"]);
  });
});

describe("RemoteRepository load errors", () => {
  it("network failure -> storage-unavailable; 401 -> unauthorized", async () => {
    const a = setup();
    a.fake.on("GET /api/state", "network-error");
    await expect(a.repo.load()).rejects.toMatchObject({ kind: "network" });
    expect(a.repo.getStatus().loadIssue).toBe("storage-unavailable");

    const b = setup(undefined, "bad");
    await expect(b.repo.load()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(b.repo.getStatus().loadIssue).toBe("unauthorized");
  });
});

describe("RemoteRepository import / reset", () => {
  it("importJson PUTs the raw text with If-Match of the current rev and adopts the new state", async () => {
    const { fake, repo } = setup({ rev: 3 });
    await repo.load();
    const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, state: createEmptyWorkspace() });
    await repo.importJson(json);
    const put = fake.calls.at(-1)!;
    expect(put).toMatchObject({ method: "PUT", path: "/api/state", rawBody: json });
    expect(put.headers["If-Match"]).toBe('"3"');
    expect(repo.getRev()).toBe(4);
  });

  it("importJson loads first when the rev is unknown", async () => {
    const { fake, repo } = setup({ rev: 7 });
    await repo.importJson(JSON.stringify({ state: createEmptyWorkspace() }));
    expect(fake.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(fake.calls[1].headers["If-Match"]).toBe('"7"');
  });

  it("surfaces a 409 conflict as DomainError('conflict') without retrying", async () => {
    const { fake, repo } = setup({ rev: 3 });
    await repo.load();
    fake.externalChange(createEmptyWorkspace()); // server moved on
    const e = await repo.importJson("{}").catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "conflict", message: "stale" });
    expect(fake.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("surfaces 400/413 server errors as DomainError", async () => {
    const { fake, repo } = setup();
    await repo.load();
    fake.on("PUT /api/state", { status: 413, json: { error: { code: "too_large", message: "Request body is too large" } } });
    await expect(repo.importJson("{}")).rejects.toMatchObject({ code: "too_large" });
  });

  it("reset({seed:false}) imports an empty workspace, reset() the demo seed", async () => {
    const { fake, repo } = setup();
    await repo.reset({ seed: false });
    let sent = fake.calls.at(-1)!.body as { schemaVersion: number; state: { memories: object } };
    expect(sent.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(sent.state.memories)).toHaveLength(0);
    await repo.reset();
    sent = fake.calls.at(-1)!.body as typeof sent;
    expect(Object.keys(sent.state.memories).length).toBeGreaterThan(0);
  });
});

describe("RemoteRepository session token", () => {
  it("reads the token at request time and calls onUnauthorized once per 401", async () => {
    const fake = createFakeServer({ token: "ms_live" });
    let token: string | null = "ms_live";
    const onUnauthorized = vi.fn();
    const repo = new RemoteRepository({ baseUrl: BASE, getToken: () => token, onUnauthorized, fetch: fake.fetch });
    await repo.load();
    expect(fake.calls[0].headers.Authorization).toBe("Bearer ms_live");
    expect(onUnauthorized).not.toHaveBeenCalled();
    token = "ms_revoked";
    await expect(repo.refresh()).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once the session is gone", async () => {
    const fake = createFakeServer({ token: "ms_live" });
    const repo = new RemoteRepository({ baseUrl: BASE, getToken: () => null, fetch: fake.fetch });
    await expect(repo.load()).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fake.calls).toHaveLength(0);
  });
});
