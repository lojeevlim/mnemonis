import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { createFakeAccounts, SESSION_TOKEN } from "../../test/fakeAccounts";
import { AuthContextProvider } from "./AuthContext";
import { clearSession, SESSION_STORAGE_KEY } from "./session";

let fake: ReturnType<typeof createFakeAccounts>;

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthContextProvider>
          <AppRoutes />
        </AuthContextProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const field = (name: RegExp | string) => screen.getByLabelText(name);
function fillSignIn(email: string, password: string) {
  fireEvent.change(field("Email"), { target: { value: email } });
  fireEvent.change(field("Password"), { target: { value: password } });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession();
  fake = createFakeAccounts();
  vi.stubGlobal("fetch", fake.fetch);
  await useWorkspace.getState().switchRepository(new LocalRepository());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
});

describe("server sign-in", () => {
  it("signs in, keeps the session in memory + sessionStorage only, and loads the account's workspace as that user", async () => {
    renderApp("/sign-in");
    fillSignIn(fake.email, fake.password);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(SESSION_TOKEN);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(useWorkspace.getState().mode).toBe("remote");
    const state = fake.calls.find((c) => c.path === "/api/state")!;
    expect(state.headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    // The identity shown is the real account, not a placeholder.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // The password and token never travel in a URL or sit in the page.
    expect(fake.calls.every((c) => !c.path.includes(SESSION_TOKEN) && !c.path.includes(fake.password))).toBe(true);
    expect(document.body.textContent).not.toContain(SESSION_TOKEN);
  });

  it("'Stay signed in on this device' also writes localStorage", async () => {
    renderApp("/sign-in");
    fillSignIn(fake.email, fake.password);
    fireEvent.click(screen.getByLabelText("Stay signed in on this device"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findAllByText("Overview");
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(SESSION_TOKEN);
  });

  it("shows one uniform error for a wrong password and an unknown email, and stores nothing", async () => {
    renderApp("/sign-in");
    fillSignIn(fake.email, "wrong password!!");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const first = (await screen.findByRole("alert")).textContent;
    expect(first).toBe("Invalid email or password.");
    fillSignIn("nobody@example.com", "whatever whatever");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(fake.calls.filter((c) => c.path === "/api/auth/login")).toHaveLength(2));
    expect((await screen.findByRole("alert")).textContent).toBe(first);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("shows how long to wait on 429 Retry-After", async () => {
    fake.on("POST /api/auth/login", { status: 429, json: { error: { code: "rate_limited", message: "slow down" } }, headers: { "Retry-After": "42" } });
    renderApp("/sign-in");
    fillSignIn(fake.email, fake.password);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Too many attempts. Try again in 42 seconds.")).toBeInTheDocument();
  });

  it("says when the server is unreachable", async () => {
    fake.on("POST /api/auth/login", "network-error");
    renderApp("/sign-in");
    fillSignIn(fake.email, fake.password);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Cannot reach the Mnemonis server/)).toBeInTheDocument();
  });
});

describe("registration", () => {
  it("registers (validating the confirmation) and signs in", async () => {
    renderApp("/sign-in");
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    fireEvent.change(field(/Display name/), { target: { value: "Grace" } });
    fireEvent.change(field("Email"), { target: { value: "grace@example.com" } });
    fireEvent.change(field("Password"), { target: { value: "a long enough passphrase" } });
    fireEvent.change(field("Confirm password"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.path === "/api/auth/register")).toBe(false);
    fireEvent.change(field("Confirm password"), { target: { value: "a long enough passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
    expect(fake.state.registered).toEqual(["grace@example.com"]);
    expect(fake.calls.find((c) => c.path === "/api/auth/register")!.body).toMatchObject({ displayName: "Grace" });
  });

  it("surfaces the server's reason when registration is rejected", async () => {
    renderApp("/sign-in");
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    fireEvent.change(field("Email"), { target: { value: "x@example.com" } });
    fireEvent.change(field("Password"), { target: { value: "short" } });
    fireEvent.change(field("Confirm password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password must be at least 12 characters.")).toBeInTheDocument();
  });

  it("explains when registration is closed and offers no form", async () => {
    fake = createFakeAccounts({ registrationOpen: false });
    vi.stubGlobal("fetch", fake.fetch);
    renderApp("/sign-in");
    await waitFor(() => expect(fake.calls.some((c) => c.path === "/api/auth/config")).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    expect(await screen.findByText("Registration is closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  });
});

describe("session restore and 401 handling", () => {
  it("auto-logs in on reload via GET /api/auth/me, waiting (not redirecting) meanwhile", async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
    renderApp("/memories");
    expect(screen.getByText("Signing you in")).toBeInTheDocument();
    expect((await screen.findAllByText("Memories")).length).toBeGreaterThan(0);
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/api/auth/me" });
    expect(fake.calls[0].headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("restores from the opt-in localStorage copy", async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
    renderApp("/");
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });

  it("a rejected stored session goes to /sign-in with 'session expired' and is cleared", async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, "ms_stale");
    renderApp("/memories");
    expect(await screen.findByText("Your session expired. Sign in again.")).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps the stored session when the server is just unreachable on reload", async () => {
    fake.on("GET /api/auth/me", "network-error");
    sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
    renderApp("/");
    expect(await screen.findByText(/Cannot reach the Mnemonis server/)).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(SESSION_TOKEN);
  });

  it("a 401 from the workspace mid-session clears the session and redirects to /sign-in with the notice", async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
    renderApp("/memories");
    await screen.findAllByText("Memories");
    fake.state.sessionAlive = false; // e.g. revoked elsewhere
    await act(async () => {
      await useWorkspace.getState().createCollection("x");
    });
    expect(await screen.findByText("Your session expired. Sign in again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(useWorkspace.getState().state).toBeNull(); // nothing of the account lingers
  });

  it("sign out revokes the server session, clears storage and returns to sign-in", async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
    renderApp("/");
    await screen.findAllByText("Overview");
    fireEvent.click(screen.getByText("Ada"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Sign out/ }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(fake.state.sessionAlive).toBe(false);
    expect(within(document.body).queryByText("Your session expired. Sign in again.")).not.toBeInTheDocument();
  });
});
