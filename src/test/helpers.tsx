import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "../components/ToastProvider";
import { SESSION_STORAGE_KEY } from "../features/auth/session";
import { useWorkspace } from "../stores/workspaceStore";
import { createFakeAccounts, SESSION_TOKEN } from "./fakeAccounts";

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

/**
 * Stubs fetch with a scripted account server and stores its session, so the app restores signed in as that account
 * (via GET /api/auth/me). Pair with vi.unstubAllGlobals() in afterEach.
 */
export function seedSignedIn(opts: Parameters<typeof createFakeAccounts>[0] = {}) {
  const fake = createFakeAccounts(opts);
  vi.stubGlobal("fetch", fake.fetch);
  sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
  return fake;
}
