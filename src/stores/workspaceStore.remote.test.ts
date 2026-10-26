import { createEmptyWorkspace, type WorkspaceState } from "../domain";
import { RemoteRepository } from "../data/remoteRepository";
import { LocalRepository } from "../data/localRepository";
import { createFakeServer } from "../test/fakeServer";
import { createWorkspaceStore } from "./workspaceStore";

const withMemory = (id: string): WorkspaceState => {
  const s = createEmptyWorkspace();
  return { ...s, memories: { [id]: { id } as never } };
};

async function setup() {
  const fake = createFakeServer();
  const repo = new RemoteRepository({ baseUrl: "http://localhost:8787", token: "tok", fetch: fake.fetch });
  const store = createWorkspaceStore(repo);
  await store.getState().init();
  return { fake, repo, store };
}

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("workspace store with a remote repository", () => {
  it("is in remote mode and exposes the server rev", async () => {
    const { store } = await setup();
    expect(store.getState().mode).toBe("remote");
    expect(store.getState().remoteRev).toBe(1);
    expect(createWorkspaceStore(new LocalRepository({ storage: null })).getState().mode).toBe("local");
  });

  it("polls every ~3 s and replaces the state when the rev changed", async () => {
    const { store, fake } = await setup();
    const stop = store.getState().startLiveUpdates();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getState().state).toEqual(createEmptyWorkspace());
    expect(fake.calls.at(-1)!.headers["If-None-Match"]).toBe('"1"');
    fake.externalChange(withMemory("agent-made"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(Object.keys(store.getState().state!.memories)).toEqual(["agent-made"]);
    expect(store.getState().remoteRev).toBe(2);
    stop();
  });

  it("pauses while the tab is hidden, catches up when visible again, and stops on teardown", async () => {
    const { store, fake } = await setup();
    const stop = store.getState().startLiveUpdates();
    setVisibility("hidden");
    const before = fake.calls.length;
    fake.externalChange(withMemory("m1"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.calls.length).toBe(before);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(store.getState().state!.memories)).toEqual(["m1"]);
    stop();
    const n = fake.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.calls.length).toBe(n);
  });

  it("does not clobber an in-flight local mutation (poll is queued behind it)", async () => {
    const { store, fake } = await setup();
    const after = withMemory("after-op");
    // The op reply carries the newest state; a poll fired during it must not overwrite it with older data.
    fake.server.state = after; // the op reply (rev 2) carries it; a stale poll must never replace it with older data
    const stop = store.getState().startLiveUpdates();
    const op = store.getState().createCollection("c");
    await vi.advanceTimersByTimeAsync(3000); // poll tick while the op may still be settling
    await op;
    await vi.advanceTimersByTimeAsync(3000);
    expect(Object.keys(store.getState().state!.memories)).toEqual(["after-op"]);
    stop();
  });

  it("keeps polling after a network error and surfaces it as persistError, then clears it", async () => {
    const { store, fake } = await setup();
    const stop = store.getState().startLiveUpdates();
    fake.on("GET /api/state", "network-error");
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getState().persistError).toMatch(/Cannot reach/);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getState().persistError).toBeNull();
    stop();
  });

  it("does nothing for a local repository", () => {
    const store = createWorkspaceStore(new LocalRepository({ storage: null }));
    expect(store.getState().startLiveUpdates()()).toBeUndefined();
  });

  it("switchRepository keeps the previous repository when the new one fails to load", async () => {
    const { store } = await setup();
    const bad = createFakeServer({ token: "other" });
    const ok = await store.getState().switchRepository(new RemoteRepository({ baseUrl: "http://x", token: "nope", fetch: bad.fetch }));
    expect(ok).toBe(false);
    expect(store.getState().error).toMatch(/session is no longer valid/);
    expect(store.getState().mode).toBe("remote");
    expect(store.getState().repoEpoch).toBe(0);
  });
});

describe("workspace store project actions over the server", () => {
  it("creates, renames and deletes a project through the ops API and adopts the returned state", async () => {
    const { store, fake } = await setup();
    const p = await store.getState().createProject({ name: "Acme", repo: "https://github.com/acme/app" });
    expect(p).toMatchObject({ name: "Acme", confirmed: true });
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/ops/createProject", body: { name: "Acme", repo: "https://github.com/acme/app" } });
    expect(Object.keys(store.getState().state!.projects)).toEqual([p!.id]);
    expect(await store.getState().renameProject(p!.id, "Acme 2")).toBe(true);
    expect(store.getState().state!.projects[p!.id].name).toBe("Acme 2");
    expect(await store.getState().deleteProject(p!.id)).toBe(true);
    expect(store.getState().state!.projects).toEqual({});
  });

  it("turns the server's project error codes into clear messages", async () => {
    const { store, fake } = await setup();
    expect(await store.getState().confirmProject("prj_gone")).toBe(false);
    expect(store.getState().error).toBe("That project no longer exists. It may have been deleted elsewhere.");
    await store.getState().createProject({ name: "Acme" });
    expect(store.getState().error).toBeNull();
    expect(await store.getState().createProject({ name: "acme" })).toBeUndefined();
    expect(store.getState().error).toBe("A project with that name already exists. Choose a different name.");
    const id = Object.keys(store.getState().state!.projects)[0];
    fake.on("POST /api/ops/deleteProject", { status: 409, json: { error: { code: "project_in_use", message: "Project still has memories" } } });
    expect(await store.getState().deleteProject(id)).toBe(false);
    expect(store.getState().error).toMatch(/still has memories or waiting proposals/);
  });

  it("fileUnsorted posts the ids and resolves what was filed", async () => {
    const { store, fake } = await setup();
    const filed = await store.getState().fileUnsorted(["m1"]);
    expect(filed).toEqual([]);
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/ops/fileUnsorted", body: { ids: ["m1"] } });
  });
});

describe("workspace store organization actions over the server", () => {
  it("creates, assigns, renames, confirms and deletes an organization and adopts the returned state", async () => {
    const { store, fake } = await setup();
    const p = await store.getState().createProject({ name: "VT" });
    const o = await store.getState().createOrganization("ROK");
    expect(o).toMatchObject({ name: "ROK", confirmed: true });
    expect(fake.calls.at(-1)).toMatchObject({ path: "/api/ops/createOrganization", body: { name: "ROK" } });
    expect(await store.getState().assignProjectOrganization(p!.id, o!.id)).toBe(true);
    expect(store.getState().state!.projects[p!.id].organizationId).toBe(o!.id);
    expect(await store.getState().renameOrganization(o!.id, "ROK Inc")).toBe(true);
    expect(store.getState().state!.organizations[o!.id].name).toBe("ROK Inc");
    expect(await store.getState().confirmOrganization(o!.id)).toBe(true);
    expect(await store.getState().assignProjectOrganization(p!.id, null)).toBe(true);
    expect(await store.getState().deleteOrganization(o!.id)).toBe(true);
    expect(store.getState().state!.organizations).toEqual({});
    expect(store.getState().state!.projects[p!.id]).toBeDefined();
  });

  it("turns the organization error codes into clear messages", async () => {
    const { store } = await setup();
    expect(await store.getState().renameOrganization("org_gone", "x")).toBe(false);
    expect(store.getState().error).toBe("That organization no longer exists. It may have been deleted elsewhere.");
    await store.getState().createOrganization("ROK");
    expect(store.getState().error).toBeNull();
    expect(await store.getState().createOrganization("rok")).toBeUndefined();
    expect(store.getState().error).toBe("An organization with that name already exists. Choose a different name.");
  });
});
