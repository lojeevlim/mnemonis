import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { createFakeAccounts, SESSION_TOKEN } from "../../test/fakeAccounts";
import { resetWorkspace, seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "../auth/AuthContext";
import { clearSession, SESSION_STORAGE_KEY } from "../auth/session";
import { SettingsPage } from "./SettingsPage";

let fake: ReturnType<typeof createFakeAccounts>;

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthContextProvider>
          <SettingsPage />
        </AuthContextProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Renders Settings for a signed-in server account (the session is restored via /api/auth/me). */
async function renderSignedIn() {
  sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
  const r = renderPage();
  await screen.findByText("Connected");
  return r;
}

beforeEach(async () => {
  await resetWorkspace();
  sessionStorage.clear();
  clearSession();
  fake = createFakeAccounts();
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
  localStorage.clear();
  sessionStorage.clear();
});

describe("Settings: Mnemonis account (local mode)", () => {
  it("shows local wording, no pasted-token field, no server-only actions", () => {
    seedLocalProfile();
    renderPage();
    expect(screen.getByText("Local mode")).toBeInTheDocument();
    expect(screen.getByText("Local demo mode")).toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy my browser data/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });

  it("'Sign in or register' leaves local mode", async () => {
    seedLocalProfile();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Sign in or register" }));
    await waitFor(() => expect(localStorage.getItem("mnemonis.auth.v1")).toContain('"signedIn":false'));
  });
});

describe("Settings: Mnemonis account (server mode)", () => {
  it("shows Connected, the signed-in email and revision; no paste-token field", async () => {
    await renderSignedIn();
    expect(useWorkspace.getState().mode).toBe("remote");
    expect(screen.getByText(/Signed in as ada@example.com \(revision 7\)/)).toBeInTheDocument();
    expect(screen.getByText("Signed in (server)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Access token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SESSION_TOKEN);
  });

  it("tests the connection with the session as bearer", async () => {
    await renderSignedIn();
    fake.calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connection works\. Server revision 7/)).toBeInTheDocument();
    expect(fake.calls.map((c) => c.path)).toEqual(["/api/health", "/api/state"]);
    expect(fake.calls[1].headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it("copies browser data to the account only after a confirm that says it REPLACES the account's data", async () => {
    const local = new LocalRepository();
    await local.createMemory({ title: "From browser", actor: { kind: "user", name: "me" } });
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Copy my browser data to my account" }));
    expect(screen.getByText(/REPLACES everything stored in your account/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Replace account data" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.headers["If-Match"]).toBe('"7"');
    expect(put.rawBody).toContain("From browser");
  });

  it("cancelling the copy confirm sends nothing", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Copy my browser data to my account" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("Log out revokes the session", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(fake.state.sessionAlive).toBe(false));
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("Settings: change password and delete account", () => {
  const change = (cur: string, next: string, confirm = next) => {
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: cur } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: next } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  };

  it("changes the password", async () => {
    await renderSignedIn();
    change(fake.password, "brand new passphrase");
    await waitFor(() => expect(fake.state.password).toBe("brand new passphrase"));
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("checks the confirmation, and a wrong current password shows an error WITHOUT signing the user out", async () => {
    await renderSignedIn();
    change(fake.password, "brand new passphrase", "typo");
    expect(await screen.findByText("The new passwords do not match.")).toBeInTheDocument();
    change("not my password", "brand new passphrase");
    expect(await screen.findByText("The password is incorrect.")).toBeInTheDocument();
    expect(fake.state.password).toBe(fake.password);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(SESSION_TOKEN);
  });

  it("deleting the account needs the password and a confirmation, then signs out", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("Enter your password to delete the account.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Confirm with your password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(screen.getByText("Delete your account?")).toBeInTheDocument();
    expect(fake.state.deleted).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" }).at(-1)!);
    expect(await screen.findByText("The password is incorrect.")).toBeInTheDocument();
    expect(fake.state.deleted).toBe(false);
    fireEvent.change(screen.getByLabelText("Confirm with your password"), { target: { value: fake.password } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" }).at(-1)!);
    await waitFor(() => expect(fake.state.deleted).toBe(true));
    await waitFor(() => expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
  });
});
