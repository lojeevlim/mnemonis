import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { LEGACY_CORRUPT_BACKUP_KEY, LEGACY_STORAGE_KEY, LocalRepository, STORAGE_KEY } from "../../data/localRepository";
import { createSeedWorkspace } from "../../data/seed";
import { createEmptyWorkspace } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace, seedSignedIn } from "../../test/helpers";
import { LEGACY_RUN_LOG_KEY, RUN_LOG_KEY } from "../health/runLog";
import { AuthContextProvider } from "../auth/AuthContext";
import { clearSession, SESSION_STORAGE_KEY } from "../auth/session";
import { SettingsPage } from "./SettingsPage";

const store = () => useWorkspace.getState();
const memoryCount = () => Object.keys(store().state!.memories).length;

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

/** Renders Settings signed in to a fake account whose workspace is the demo data (or an empty one). */
async function renderSignedIn(opts: { seed?: boolean } = {}) {
  const fake = seedSignedIn();
  fake.data.server.state = opts.seed === false ? createEmptyWorkspace() : createSeedWorkspace();
  renderPage();
  await screen.findByText("Connected");
  return fake;
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await resetWorkspace();
  sessionStorage.clear();
  clearSession();
  createObjectURL = vi.fn(() => "blob:mock");
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
  localStorage.clear();
  sessionStorage.clear();
});

const upload = (content: string, name = "backup.json") => {
  const input = screen.getByLabelText("Import workspace JSON file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], name, { type: "application/json" })] } });
};

describe("Settings", () => {
  it("shows the account profile read-only; there is no local profile form", async () => {
    await renderSignedIn();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
    expect(screen.queryByText(/Local demo mode|local mode|stored only in this browser/i)).not.toBeInTheDocument();
  });

  it("exports the workspace as a JSON download", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Export workspace JSON" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    const parsed = JSON.parse(await blob.text());
    expect(Object.keys(parsed.state.memories).length).toBeGreaterThan(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("validates then confirms before importing", async () => {
    const fake = await renderSignedIn();
    const before = memoryCount();
    expect(before).toBeGreaterThan(0);

    upload("{ not json");
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    upload(JSON.stringify({ hello: "world" }));
    expect(await screen.findByText(/^Import failed:/)).toBeInTheDocument();
    expect(memoryCount()).toBe(before);

    const empty = JSON.stringify({ schemaVersion: 2, state: createEmptyWorkspace() });
    upload(empty);
    expect(await screen.findByText("Replace your workspace with this file?")).toBeInTheDocument();
    expect(screen.getByText(/backup\.json contains 0 memories and 0 saved changes\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(memoryCount()).toBe(before);
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);

    upload(empty);
    fireEvent.click(await screen.findByRole("button", { name: "Replace workspace" }));
    await waitFor(() => expect(memoryCount()).toBe(0));
  });

  it("resets to demo data after confirmation", async () => {
    await renderSignedIn({ seed: false });
    expect(memoryCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    expect(await screen.findByText("Reset to demo data?")).toBeInTheDocument();
    expect(memoryCount()).toBe(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Reset to demo data" }).at(-1)!);
    await waitFor(() => expect(memoryCount()).toBeGreaterThan(0));
  });

  it("clears browser data (workspace copy, run logs, legacy v1 data) and signs out, only after confirmation; the account is untouched", async () => {
    localStorage.setItem(STORAGE_KEY, "{}");
    localStorage.setItem(RUN_LOG_KEY, "[]");
    localStorage.setItem(LEGACY_RUN_LOG_KEY, "[]");
    localStorage.setItem(LEGACY_STORAGE_KEY, '{"schemaVersion":1}');
    localStorage.setItem(LEGACY_CORRUPT_BACKUP_KEY, "{broken");
    const fake = await renderSignedIn();
    const before = memoryCount();
    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    expect(await screen.findByText("Clear all local data?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(fake.state.sessionAlive).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all local data" }).at(-1)!);
    await waitFor(() => expect(fake.state.sessionAlive).toBe(false));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RUN_LOG_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_RUN_LOG_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_CORRUPT_BACKUP_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(Object.keys(fake.data.server.state.memories)).toHaveLength(before);
  });

  it("shows server status and the account statement", async () => {
    await renderSignedIn();
    act(() => useWorkspace.setState({ persistError: "Quota exceeded", loadIssue: "corrupt" }));
    expect(screen.getByText("Server: problem")).toBeInTheDocument();
    expect(screen.getByText("Load issue: corrupt")).toBeInTheDocument();
    expect(screen.getByText("Signed in (server)")).toBeInTheDocument();
    expect(screen.getByText(/memories are stored on the server/i)).toBeInTheDocument();
  });
});
