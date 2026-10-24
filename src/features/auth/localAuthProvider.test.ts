import { AUTH_STORAGE_KEY, LocalAuthProvider } from "./localAuthProvider";

beforeEach(() => localStorage.clear());

describe("LocalAuthProvider (explicit 'use without an account' mode only)", () => {
  it("has no email-only sign-in or sign-up any more", () => {
    const p = new LocalAuthProvider() as unknown as Record<string, unknown>;
    expect(p.signIn).toBeUndefined();
    expect(p.signUp).toBeUndefined();
  });

  it("starts signed out, continues as a guest, persists across instances and never stores a password", () => {
    const a = new LocalAuthProvider();
    expect(a.getUser()).toBeNull();
    expect(a.hasProfile()).toBe(false);
    a.continueAsGuest();
    const b = new LocalAuthProvider();
    expect(b.getUser()).toMatchObject({ displayName: "Local user", guest: true });
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)!;
    expect(JSON.parse(raw).version).toBe(1);
    expect(raw).not.toMatch(/password|token/i);
  });

  it("signs out keeping the profile, and continuing reuses it", () => {
    const p = new LocalAuthProvider();
    p.continueAsGuest();
    p.updateProfile({ displayName: "Ada" });
    p.signOut();
    expect(p.getUser()).toBeNull();
    expect(p.hasProfile()).toBe(true);
    expect(p.continueAsGuest().displayName).toBe("Ada");
    expect(p.getUser()).not.toBeNull();
  });

  it("updates and deletes the profile", () => {
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
