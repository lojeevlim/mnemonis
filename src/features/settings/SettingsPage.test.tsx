import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace, seedLocalProfile } from "../../test/helpers";
import { RUN_LOG_KEY } from "../agents/runLog";
import { AuthContextProvider } from "../auth/AuthContext";
import { AUTH_STORAGE_KEY } from "../auth/localAuthProvider";
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

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await resetWorkspace();
  seedLocalProfile({ displayName: "Test User", email: "test@example.com" });
  createObjectURL = vi.fn(() => "blob:mock");
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const upload = (content: string, name = "backup.json") => {
  const input = screen.getByLabelText("Import workspace JSON file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([content], name, { type: "application/json" })] } });
};

describe("Settings", () => {
  it("saves the local profile", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grace@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!).profile).toMatchObject({ displayName: "Grace", email: "grace@example.com" }));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Display name is required.")).toBeInTheDocument();
  });

  it("exports the workspace as a JSON download", async () => {
    await store().createMemory({ title: "Exported one" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Export workspace JSON" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    const parsed = JSON.parse(await blob.text());
    expect(Object.keys(parsed.state.memories)).toHaveLength(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("validates then confirms before importing", async () => {
    const exported = await store().exportJson();
    await store().createMemory({ title: "Extra" });
    expect(memoryCount()).toBe(1);
    renderPage();

    upload("{ not json");
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    upload(JSON.stringify({ hello: "world" }));
    expect(await screen.findByText(/^Import failed:/)).toBeInTheDocument();
    expect(memoryCount()).toBe(1);

    upload(exported!);
    expect(await screen.findByText("Replace your workspace with this file?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(memoryCount()).toBe(1);

    upload(exported!);
    fireEvent.click(await screen.findByRole("button", { name: "Replace workspace" }));
    await waitFor(() => expect(memoryCount()).toBe(0));
  });

  it("resets to demo data after confirmation", async () => {
    renderPage();
    expect(memoryCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset to demo data" }));
    expect(await screen.findByText("Reset to demo data?")).toBeInTheDocument();
    expect(memoryCount()).toBe(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Reset to demo data" }).at(-1)!);
    await waitFor(() => expect(memoryCount()).toBeGreaterThan(0));
  });

  it("clears all local data (workspace, profile, run log) only after confirmation", async () => {
    await resetWorkspace({ seed: true });
    seedLocalProfile();
    localStorage.setItem(RUN_LOG_KEY, "[]");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    expect(await screen.findByText("Clear all local data?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(memoryCount()).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Clear all local data" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all local data" }).at(-1)!);
    await waitFor(() => expect(memoryCount()).toBe(0));
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RUN_LOG_KEY)).toBeNull();
  });

  it("shows storage status and the local-mode statement", () => {
    useWorkspace.setState({ persistError: "Quota exceeded", loadIssue: "corrupt" });
    renderPage();
    expect(screen.getByText("Browser storage: write failed")).toBeInTheDocument();
    expect(screen.getByText("Load issue: corrupt")).toBeInTheDocument();
    expect(screen.getByText(/account deletion/i)).toBeInTheDocument();
    expect(screen.getByText(/stored only in this browser/i)).toBeInTheDocument();
    expect(screen.getByText("Local demo mode")).toBeInTheDocument();
  });
});
