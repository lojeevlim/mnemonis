import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../../app/router";
import { ToastProvider } from "../../components/ToastProvider";
import { seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "./AuthContext";
import { AUTH_STORAGE_KEY } from "./localAuthProvider";

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

beforeEach(() => localStorage.clear());

describe("auth routing", () => {
  it("redirects to /sign-in when there is no local profile, with a local-only statement", async () => {
    renderApp("/memories");
    expect(await screen.findByText("Sign in to your local profile")).toBeInTheDocument();
    expect(screen.getByText(/nothing is transmitted/i)).toBeInTheDocument();
    expect(screen.queryByText("Memories")).not.toBeInTheDocument();
  });

  it("'Continue in local demo mode' creates a guest profile and enters the app", async () => {
    renderApp("/sign-in");
    fireEvent.click(await screen.findByRole("button", { name: "Continue in local demo mode" }));
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!)).toMatchObject({ signedIn: true, profile: { guest: true } });
  });

  it("sign up creates a local profile only", async () => {
    renderApp("/sign-up");
    expect(await screen.findByText("Create a local profile")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    const [pw, confirm] = screen.getAllByLabelText(/password/i);
    fireEvent.change(pw, { target: { value: "x" } });
    fireEvent.change(confirm, { target: { value: "x" } });
    const terms = screen.queryByRole("checkbox");
    if (terms) fireEvent.click(terms);
    fireEvent.click(screen.getByRole("button", { name: "Create local profile" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).profile.displayName).toBe("Ada"));
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).not.toMatch(/password/i);
  });

  it("signed-in users reach the app and can sign out from the user menu", async () => {
    seedLocalProfile({ displayName: "Test User" });
    renderApp("/mcp");
    expect(await screen.findByText("Backend not built yet — local demo mode")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test User"));
    fireEvent.click(await screen.findByText("Sign out"));
    expect(await screen.findByText("Sign in to your local profile")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).signedIn).toBe(false);
  });

  it("signed-in users visiting /sign-in are sent into the app", async () => {
    seedLocalProfile();
    renderApp("/sign-in");
    expect((await screen.findAllByText("Overview")).length).toBeGreaterThan(0);
  });
});
