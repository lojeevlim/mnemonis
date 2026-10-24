import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { CORRUPT_BACKUP_KEY } from "../../data/localRepository";
import { MAX_IMPORT_BYTES } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace, seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "../auth/AuthContext";
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
  seedLocalProfile();
});

describe("Settings review fixes", () => {
  it("MINOR-5: clearing all local data also removes the corrupt backup", async () => {
    localStorage.setItem(CORRUPT_BACKUP_KEY, "{broken");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all local data" }).at(-1)!);
    await waitFor(() => expect(Object.keys(useWorkspace.getState().state!.memories)).toHaveLength(0));
    expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBeNull();
  });

  it("MAJOR-3: preview rejects deep-invalid, hostile and oversized imports", () => {
    const good = JSON.parse(JSON.stringify(useWorkspace.getState().state));
    expect(() => previewImport(JSON.stringify(good), "ok.json")).not.toThrow();
    const bad = JSON.parse(JSON.stringify(good));
    bad.revisions[Object.keys(bad.revisions)[0]].snapshot.tags = "nope";
    expect(() => previewImport(JSON.stringify(bad), "bad.json")).toThrow(/corrupt/);
    expect(() => previewImport('{"schemaVersion":1,"__proto__":{"x":1}}', "p.json")).toThrow(/Import failed/);
    expect(() => previewImport(" ".repeat(MAX_IMPORT_BYTES + 1), "big.json")).toThrow(/too large/);
  });

  it("MINOR-10: version comes from the Vite define constant", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    renderPage();
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });
});
