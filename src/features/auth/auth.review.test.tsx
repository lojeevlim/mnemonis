import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { seedSignedIn } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { clearSession } from "./session";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
});

function renderAt(state?: { from: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/sign-in", state }]}>
      <ToastProvider>
        <AuthContextProvider>
          <AppRoutes />
        </AuthContextProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SignInPage return path", () => {
  it("an already signed-in user is redirected to `from`", async () => {
    seedSignedIn();
    renderAt({ from: "/mcp" });
    expect(await screen.findByRole("button", { name: "Create token" })).toBeInTheDocument();
  });

  it("ignores an off-site `from`", async () => {
    seedSignedIn();
    renderAt({ from: "//evil.example" });
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });
});
