import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { AUTH_STORAGE_KEY, LocalAuthProvider } from "./localAuthProvider";

beforeEach(() => localStorage.clear());

describe("signUp refuses to replace a real profile", () => {
  it("throws when a non-guest profile exists (signed in or out) and keeps it", () => {
    const p = new LocalAuthProvider();
    p.signUp({ displayName: "Ada", email: "ada@example.com" });
    expect(() => p.signUp({ displayName: "Eve", email: "eve@example.com" })).toThrow(/already exists/);
    p.signOut();
    expect(() => p.signUp({ displayName: "Eve", email: "eve@example.com" })).toThrow(/already exists/);
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).profile.displayName).toBe("Ada");
  });

  it("allows upgrading the anonymous guest placeholder", () => {
    const p = new LocalAuthProvider();
    p.continueAsGuest();
    p.signOut();
    expect(p.signUp({ displayName: "Ada", email: "a@b.co" }).guest).toBe(false);
  });
});

describe("SignUpPage return path", () => {
  it("honours `from` after creating a profile", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/sign-up", state: { from: "/mcp" } }]}>
        <ToastProvider>
          <AuthContextProvider>
            <AppRoutes />
          </AuthContextProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText(/name/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    const [pw, confirm] = screen.getAllByLabelText(/password/i);
    fireEvent.change(pw, { target: { value: "x" } });
    fireEvent.change(confirm, { target: { value: "x" } });
    const terms = screen.queryByRole("checkbox");
    if (terms) fireEvent.click(terms);
    fireEvent.click(screen.getByRole("button", { name: "Create local profile" }));
    expect(await screen.findByText("Backend not built yet — local demo mode")).toBeInTheDocument();
  });

  it("an already signed-in user is redirected to `from`", async () => {
    seedLocalProfile();
    render(
      <MemoryRouter initialEntries={[{ pathname: "/sign-up", state: { from: "/mcp" } }]}>
        <ToastProvider>
          <AuthContextProvider>
            <AppRoutes />
          </AuthContextProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Backend not built yet — local demo mode")).toBeInTheDocument());
  });
});
