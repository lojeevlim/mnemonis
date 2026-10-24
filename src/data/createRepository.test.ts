import { createRepository } from "./createRepository";
import { LocalRepository } from "./localRepository";
import { RemoteRepository } from "./remoteRepository";
import { SERVER_SETTINGS_KEY, loadServerSettings, normalizeServerUrl, saveServerSettings } from "./serverSettings";

beforeEach(() => localStorage.clear());

describe("serverSettings", () => {
  it("normalizes URLs and rejects unsafe ones", () => {
    expect(normalizeServerUrl(" http://localhost:8787/ ")).toBe("http://localhost:8787");
    expect(normalizeServerUrl("https://x.test/base//")).toBe("https://x.test/base");
    for (const bad of ["", "ftp://x", "nope", "http://u:p@x.test", "http://x.test/?token=1", "http://x.test/#a"]) {
      expect(normalizeServerUrl(bad)).toBeNull();
    }
  });

  it("round-trips and ignores corrupt or incomplete data", () => {
    expect(loadServerSettings()).toBeNull();
    expect(saveServerSettings({ url: "http://localhost:8787", token: "t" })).toBe(true);
    expect(loadServerSettings()).toEqual({ url: "http://localhost:8787", token: "t" });
    localStorage.setItem(SERVER_SETTINGS_KEY, "{not json");
    expect(loadServerSettings()).toBeNull();
    localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify({ url: "http://localhost:8787", token: " " }));
    expect(loadServerSettings()).toBeNull();
  });

  it("is safe when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadServerSettings()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("createRepository", () => {
  it("is Local without settings and Remote with them", () => {
    expect(createRepository()).toBeInstanceOf(LocalRepository);
    saveServerSettings({ url: "http://localhost:8787", token: "t" });
    expect(createRepository()).toBeInstanceOf(RemoteRepository);
  });

  it("accepts explicit settings (injection)", () => {
    expect(createRepository({ url: "http://a.test", token: "x" })).toBeInstanceOf(RemoteRepository);
    expect(createRepository(null)).toBeInstanceOf(LocalRepository);
  });
});
