import { createRepository } from "./createRepository";
import { LocalRepository } from "./localRepository";
import { RemoteRepository } from "./remoteRepository";
import { clearSession, setSession } from "../features/auth/session";
import {
  DEFAULT_SERVER_URL,
  SERVER_SETTINGS_KEY,
  getServerUrl,
  loadServerSettings,
  normalizeServerUrl,
  saveServerSettings,
  scrubLegacyServerToken,
} from "./serverSettings";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession();
});

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
    expect(saveServerSettings({ url: "http://localhost:8787" })).toBe(true);
    expect(loadServerSettings()).toEqual({ url: "http://localhost:8787" });
    localStorage.setItem(SERVER_SETTINGS_KEY, "{not json");
    expect(loadServerSettings()).toBeNull();
    localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify({ url: "nope" }));
    expect(loadServerSettings()).toBeNull();
  });

  it("uses the stored override, else VITE_API_URL (VITE_MCP_SERVER_URL is an alias), else the default", () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_MCP_SERVER_URL", "");
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL);
    vi.stubEnv("VITE_MCP_SERVER_URL", "https://alias.example.com/");
    expect(getServerUrl()).toBe("https://alias.example.com");
    vi.stubEnv("VITE_API_URL", "https://mn.example.com/");
    expect(getServerUrl()).toBe("https://mn.example.com"); // VITE_API_URL wins over the alias
    saveServerSettings({ url: "http://other.test:9" });
    expect(getServerUrl()).toBe("http://other.test:9");
    vi.unstubAllEnvs();
  });

  it("scrubs a token left in storage by an older version", () => {
    localStorage.setItem(SERVER_SETTINGS_KEY, JSON.stringify({ url: "http://localhost:8787", token: "old-secret" }));
    scrubLegacyServerToken();
    expect(localStorage.getItem(SERVER_SETTINGS_KEY)).toBe(JSON.stringify({ url: "http://localhost:8787" }));
    expect(localStorage.getItem(SERVER_SETTINGS_KEY)).not.toContain("old-secret");
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
  it("is Local without a stored session and Remote with one", () => {
    expect(createRepository()).toBeInstanceOf(LocalRepository);
    setSession("ms_abc");
    expect(createRepository()).toBeInstanceOf(RemoteRepository);
  });

  it("accepts an explicit flag (injection)", () => {
    expect(createRepository(true)).toBeInstanceOf(RemoteRepository);
    expect(createRepository(false)).toBeInstanceOf(LocalRepository);
  });
});
