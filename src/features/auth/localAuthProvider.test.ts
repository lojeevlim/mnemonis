import { AUTH_STORAGE_KEY, LocalAuthProvider } from "./localAuthProvider";

beforeEach(() => localStorage.clear());

describe("LocalAuthProvider", () => {
  it("starts signed out, signs up, persists across instances and never stores a password", () => {
    const a = new LocalAuthProvider();
    expect(a.getUser()).toBeNull();
    expect(a.hasProfile()).toBe(false);
    a.signUp({ displayName: " Ada ", email: "ada@example.com" });
    const b = new LocalAuthProvider();
    expect(b.getUser()).toMatchObject({ displayName: "Ada", email: "ada@example.com", guest: false });
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)!;
    expect(JSON.parse(raw).version).toBe(1);
    expect(raw).not.toMatch(/password/i);
  });

  it("requires a display name", () => {
    expect(() => new LocalAuthProvider().signUp({ displayName: " ", email: "" })).toThrow(/required/);
  });

  it("signs out (keeping the profile), signs back in by email, rejects unknown emails", () => {
    const p = new LocalAuthProvider();
    p.signUp({ displayName: "Ada", email: "ada@example.com" });
    p.signOut();
    expect(p.getUser()).toBeNull();
    expect(p.hasProfile()).toBe(true);
    expect(() => p.signIn({ email: "other@example.com" })).toThrow(/No local profile/);
    expect(p.signIn({ email: "ADA@example.com" }).displayName).toBe("Ada");
    expect(p.getUser()).not.toBeNull();
  });

  it("continues as a guest, updates and deletes the profile", () => {
    const p = new LocalAuthProvider();
    expect(p.continueAsGuest()).toMatchObject({ guest: true, displayName: "Local user" });
    expect(p.updateProfile({ displayName: "Zed", email: "z@example.com" })).toMatchObject({ displayName: "Zed", guest: false });
    expect(() => p.updateProfile({ displayName: "" })).toThrow(/required/);
    p.deleteProfile();
    expect(p.getUser()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("treats corrupt or wrong-version storage as no profile, and survives unavailable storage", () => {
    localStorage.setItem(AUTH_STORAGE_KEY, "{{{");
    expect(new LocalAuthProvider().getUser()).toBeNull();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ version: 99, signedIn: true, profile: {} }));
    expect(new LocalAuthProvider().getUser()).toBeNull();
    localStorage.clear();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const p = new LocalAuthProvider();
    expect(() => p.continueAsGuest()).not.toThrow();
    expect(p.getUser()).not.toBeNull();
    spy.mockRestore();
    setSpy.mockRestore();
  });
});
