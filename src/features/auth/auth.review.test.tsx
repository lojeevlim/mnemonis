import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { clearSession } from "./session";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession();
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
  it("honours `from` after choosing local mode", async () => {
    renderAt({ from: "/mcp" });
    fireEvent.click(await screen.findByRole("button", { name: "Use without an account (this browser only)" }));
    expect(await screen.findByText("Sign in to connect AI clients")).toBeInTheDocument();
  });

  it("an already signed-in user is redirected to `from`", async () => {
    seedLocalProfile();
    renderAt({ from: "/mcp" });
    expect(await screen.findByText("Sign in to connect AI clients")).toBeInTheDocument();
  });

  it("ignores an off-site `from`", async () => {
    seedLocalProfile();
    renderAt({ from: "//evil.example" });
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });
});
