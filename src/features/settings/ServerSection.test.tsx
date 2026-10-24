import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { SERVER_SETTINGS_KEY } from "../../data/serverSettings";
import { useWorkspace } from "../../stores/workspaceStore";
import { createFakeServer } from "../../test/fakeServer";
import { resetWorkspace, seedLocalProfile } from "../../test/helpers";
import { AuthContextProvider } from "../auth/AuthContext";
import { SettingsPage } from "./SettingsPage";

let fake: ReturnType<typeof createFakeServer>;

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
  await resetWorkspace();
  seedLocalProfile();
  fake = createFakeServer({ rev: 7, token: "secret-token" });
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await useWorkspace.getState().switchRepository(new LocalRepository());
  localStorage.clear();
});

const typeToken = (v: string) => fireEvent.change(screen.getByLabelText("Access token"), { target: { value: v } });

describe("Settings: Mnemonis server", () => {
  it("starts in local mode with the default URL, a password token field and local wording", () => {
    renderPage();
    expect(screen.getByText("Local mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Server URL")).toHaveValue("http://localhost:8787");
    expect(screen.getByLabelText("Access token")).toHaveAttribute("type", "password");
    expect(screen.getByText("Local demo mode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy my browser data to the server" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("requires a token before connecting or testing", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText(/Enter the access token/)).toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });

  it("tests the connection via health then an authenticated read", async () => {
    renderPage();
    typeToken("secret-token");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Connection works\. Server revision 7/)).toBeInTheDocument();
    expect(fake.calls.map((c) => c.path)).toEqual(["/api/health", "/api/state"]);
    expect(fake.calls[0].headers.Authorization).toBeUndefined();
    expect(fake.calls[1].headers.Authorization).toBe("Bearer secret-token");
    expect(useWorkspace.getState().mode).toBe("local");
  });

  it("reports a rejected token and an unreachable server without echoing the token", async () => {
    renderPage();
    typeToken("wrong-token");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/rejected the token \(401\)/)).toBeInTheDocument();
    fake.on("GET /api/health", "network-error");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Cannot reach a Mnemonis server/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("wrong-token");
  });

  it("connects: switches the store to the server, saves settings, hides the token, shows Connected + rev", async () => {
    renderPage();
    typeToken("secret-token");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(useWorkspace.getState().mode).toBe("remote");
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/revision 7/)).toBeInTheDocument();
    expect(screen.getByText("Connected to server")).toBeInTheDocument();
    expect(screen.queryByText("Local demo mode")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SERVER_SETTINGS_KEY)!)).toEqual({ url: "http://localhost:8787", token: "secret-token" });
    expect(screen.getByLabelText("Access token")).toHaveValue("");
    expect(document.body.textContent).not.toContain("secret-token");
    expect(fake.calls.every((c) => !c.path.includes("secret-token"))).toBe(true);
  });

  it("shows an error and stays local when the token is wrong", async () => {
    renderPage();
    typeToken("nope");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/rejected the access token/)).toBeInTheDocument();
    expect(useWorkspace.getState().mode).toBe("local");
    expect(localStorage.getItem(SERVER_SETTINGS_KEY)).toBeNull();
    expect(document.body.textContent).not.toContain("nope\"");
  });

  it("disconnects back to local mode and forgets the settings", async () => {
    renderPage();
    typeToken("secret-token");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(useWorkspace.getState().mode).toBe("local"));
    expect(localStorage.getItem(SERVER_SETTINGS_KEY)).toBeNull();
    expect(await screen.findByText("Local mode")).toBeInTheDocument();
    expect(screen.getByText("Local demo mode")).toBeInTheDocument();
  });

  it("copies browser data to the server only after a confirm that says it REPLACES the server data", async () => {
    const local = new LocalRepository();
    await local.createMemory({ title: "From browser", actor: { kind: "user", name: "me" } });
    renderPage();
    typeToken("secret-token");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy my browser data to the server" }));
    expect(screen.getByText(/REPLACES everything stored on the server/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Replace server data" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.headers["If-Match"]).toBe('"7"');
    expect(put.rawBody).toContain("From browser");
    expect(Object.values(fake.server.state.memories).map((m) => m.id).length).toBe(1);
  });

  it("cancelling the copy confirm sends nothing", async () => {
    renderPage();
    typeToken("secret-token");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy my browser data to the server" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
