import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { seedSignedIn } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { clearSession, SESSION_STORAGE_KEY } from "./session";

function renderApp(path: string) {
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

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
});

describe("auth routing", () => {
  it("redirects to /sign-in when signed out; the page offers Sign in and Register only", async () => {
    renderApp("/memories");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Register" })).toBeInTheDocument();
    expect(screen.queryByText("Memories")).not.toBeInTheDocument();
  });

  it("a signed-out visit to / redirects to /sign-in", async () => {
    renderApp("/");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("/sign-in has no 'Use without an account' control and no local-only wording", async () => {
    renderApp("/sign-in");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/Use without an account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this browser only/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /without an account/i })).not.toBeInTheDocument();
  });

  it("/sign-up now lands on the sign-in page", async () => {
    renderApp("/sign-up");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signed-in users reach the app; the user menu shows the real identity and no dead links, and signs out", async () => {
    const fake = seedSignedIn();
    renderApp("/mcp");
    expect(await screen.findByRole("button", { name: "Create token" })).toBeInTheDocument();
    expect(screen.queryByText("Jordan Diaz")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Ada"));
    expect(await screen.findByRole("menuitem", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Sign out/ }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fake.state.sessionAlive).toBe(false);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("signed-in users visiting /sign-in are sent into the app", async () => {
    seedSignedIn();
    renderApp("/sign-in");
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });
});
