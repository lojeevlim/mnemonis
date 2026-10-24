import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "../components/ToastProvider";
import { AUTH_STORAGE_KEY } from "../features/auth/localAuthProvider";
import { useWorkspace } from "../stores/workspaceStore";

/** Resets the shared store (jsdom localStorage-backed) to an empty or seeded workspace. */
export async function resetWorkspace(opts: { seed?: boolean } = {}) {
  localStorage.clear();
  useWorkspace.setState({ state: null, error: null, loadIssue: null, persistError: null });
  await useWorkspace.getState().reset({ seed: opts.seed ?? false });
}

function LocationProbe() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname + l.search}</div>;
}

export function renderAt(path: string, routePath: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** The hidden native <select> behind a lojee Select, found via its combobox button's aria-label. */
export function nativeSelect(container: HTMLElement, label: string): HTMLSelectElement {
  let btn = container.querySelector(`button[aria-label="${label}"]`);
  if (!btn) {
    const lab = [...document.querySelectorAll("label")].find((l) => l.textContent === label);
    if (lab?.htmlFor) btn = document.getElementById(lab.htmlFor);
  }
  const sel = btn?.parentElement?.querySelector("select");
  if (!sel) throw new Error(`Select not found: ${label}`);
  return sel;
}

/** Seeds a signed-in local profile so ProtectedRoute lets the app shell render. */
export function seedLocalProfile(overrides: { displayName?: string; email?: string } = {}) {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      signedIn: true,
      profile: {
        displayName: overrides.displayName ?? "Test User",
        email: overrides.email ?? "test@example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        guest: false,
      },
    }),
  );
}
