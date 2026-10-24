import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { AUTH_STORAGE_KEY } from "./localAuthProvider";
import { clearSession } from "./session";

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

describe("auth routing", () => {
  it("redirects to /sign-in when signed out; the page offers real accounts and a clearly local option", async () => {
    renderApp("/memories");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use without an account (this browser only)" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent to a server/i)).toBeInTheDocument();
    expect(screen.queryByText("Memories")).not.toBeInTheDocument();
  });

  it("'Use without an account' creates a local-only profile and enters the app", async () => {
    renderApp("/sign-in");
    fireEvent.click(await screen.findByRole("button", { name: "Use without an account (this browser only)" }));
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!)).toMatchObject({ signedIn: true, profile: { guest: true } });
  });

  it("/sign-up now lands on the sign-in page", async () => {
    renderApp("/sign-up");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("local users reach the app; the user menu shows the real identity and no dead links, and signs out", async () => {
    seedLocalProfile({ displayName: "Test User", email: "test@example.com" });
    renderApp("/mcp");
    expect(await screen.findByText("Sign in to connect AI clients")).toBeInTheDocument();
    expect(screen.queryByText("Jordan Diaz")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Test User"));
    expect(await screen.findByRole("menuitem", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Sign out/ }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).signedIn).toBe(false);
  });

  it("signed-in users visiting /sign-in are sent into the app", async () => {
    seedLocalProfile();
    renderApp("/sign-in");
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });
});
