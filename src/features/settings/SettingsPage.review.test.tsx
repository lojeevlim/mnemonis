import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { CORRUPT_BACKUP_KEY, LocalRepository } from "../../data/localRepository";
import { createSeedWorkspace } from "../../data/seed";
import { MAX_IMPORT_BYTES } from "../../domain";
import v1Drafts from "../../domain/__fixtures__/v1-drafts.json";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace, seedSignedIn } from "../../test/helpers";
import { AuthContextProvider } from "../auth/AuthContext";
import { clearSession } from "../auth/session";
import { APP_VERSION, SettingsPage, previewImport } from "./SettingsPage";

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

beforeEach(async () => {
  await resetWorkspace({ seed: true });
  sessionStorage.clear();
  clearSession();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
  localStorage.clear();
  sessionStorage.clear();
});

async function renderSignedIn() {
  const fake = seedSignedIn();
  fake.data.server.state = createSeedWorkspace();
  renderPage();
  await screen.findByText("Connected");
  return fake;
}

describe("Settings review fixes", () => {
  it("MINOR-5: clearing all local data also removes the corrupt backup", async () => {
    localStorage.setItem(CORRUPT_BACKUP_KEY, "{broken");
    const fake = await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all local data" }).at(-1)!);
    await waitFor(() => expect(fake.state.sessionAlive).toBe(false));
    expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBeNull();
  });

  it("MAJOR-3: preview rejects deep-invalid, hostile and oversized imports", () => {
    const good = JSON.parse(JSON.stringify(createSeedWorkspace()));
    expect(() => previewImport(JSON.stringify(good), "ok.json")).not.toThrow();
    const bad = JSON.parse(JSON.stringify(good));
    bad.revisions[Object.keys(bad.revisions)[0]].snapshot.tags = "nope";
    expect(() => previewImport(JSON.stringify(bad), "bad.json")).toThrow(/corrupt/);
    expect(() => previewImport('{"schemaVersion":1,"__proto__":{"x":1}}', "p.json")).toThrow(/Import failed/);
    expect(() => previewImport(" ".repeat(MAX_IMPORT_BYTES + 1), "big.json")).toThrow(/too large/);
  });

  it("previews an older (v1) export by migrating it, counting saved changes and Inbox items", () => {
    const p = previewImport(JSON.stringify(v1Drafts), "old.json");
    expect(p.memories).toBeGreaterThan(0);
    expect(p.saves).toBeGreaterThan(0);
    expect(p.pending).toBeGreaterThan(0); // main-timeline drafts become pending proposals
    // wrapped in the old storage envelope too
    expect(previewImport(JSON.stringify({ schemaVersion: 1, state: v1Drafts }), "env.json").memories).toBe(p.memories);
  });

  it("MINOR-10: version comes from the Vite define constant", async () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    await renderSignedIn();
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });
});
