import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/ToastProvider";
import { LocalRepository } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { createFakeAccounts, MCP_TOKEN_SECRET, SESSION_TOKEN } from "../../test/fakeAccounts";
import { resetWorkspace } from "../../test/helpers";
import { AuthContextProvider } from "../auth/AuthContext";
import { clearSession, SESSION_STORAGE_KEY } from "../auth/session";
import { safeMcpUrl } from "../auth/serverAuthProvider";
import { claudeCodeCommand, McpPage, READ_TOOLS, shellQuote, WRITE_TOOLS } from "./McpPage";
import { tokenStatus } from "./tokensApi";

let fake: ReturnType<typeof createFakeAccounts>;
const writeText = vi.fn(async () => undefined);

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthContextProvider>
          <McpPage />
        </AuthContextProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function renderSignedIn(opts?: Parameters<typeof createFakeAccounts>[0]) {
  // The API publishes the MCP adapter's URL (a separate server, port 8788) in GET /api/auth/config.
  fake = createFakeAccounts({ mcpUrl: "http://localhost:8788/mcp", ...opts });
  vi.stubGlobal("fetch", fake.fetch);
  sessionStorage.setItem(SESSION_STORAGE_KEY, SESSION_TOKEN);
  const r = renderPage();
  await screen.findByRole("button", { name: "Create token" });
  return r;
}

beforeEach(async () => {
  await resetWorkspace();
  sessionStorage.clear();
  clearSession();
  vi.stubEnv("VITE_MCP_SERVER_URL", "");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearSession();
  await useWorkspace.getState().switchRepository(new LocalRepository());
  localStorage.clear();
  sessionStorage.clear();
});

describe("MCP page copy", () => {
  it("lists the tools, explains that only the user approves, and has no scope text or approve/reject tools", async () => {
    await renderSignedIn();
    for (const t of [...READ_TOOLS, ...WRITE_TOOLS]) expect(screen.getByText(t.name)).toBeInTheDocument();
    expect(screen.getByText(/only you can do in this app/)).toBeInTheDocument();
    expect(screen.queryByText(/without an account/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/read-only tokens|read\/write|Scopes|Allow writes/i);
    expect([...READ_TOOLS, ...WRITE_TOOLS].filter((t) => /approve|reject/.test(t.name))).toEqual([]);
  });
});

describe("MCP page tokens", () => {
  it("shows a placeholder command before any token exists", async () => {
    await renderSignedIn();
    expect(await screen.findByText("No tokens yet.")).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "claude mcp add --transport http mnemonis 'http://localhost:8788/mcp' --header 'Authorization: Bearer <token>'",
    );
    expect(screen.getByRole("button", { name: "Copy command" })).toBeDisabled();
  });

  it("shows the adapter URL from /api/auth/config (never the API URL + /mcp)", async () => {
    await renderSignedIn();
    expect(await screen.findByText("http://localhost:8788/mcp")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.path === "/api/auth/config")).toBe(true);
    expect(document.body.textContent).not.toContain("localhost:8787/mcp");
  });

  it("without a published mcpUrl it shows a placeholder and a note, never a guessed URL", async () => {
    await renderSignedIn({ mcpUrl: "" });
    expect(await screen.findByText("Not published by the server")).toBeInTheDocument();
    expect(document.body.textContent).toContain("MNEMONIS_MCP_URL");
    expect(document.body.textContent).toContain("claude mcp add --transport http mnemonis <mcp-url> --header 'Authorization: Bearer <token>'");
    expect(document.body.textContent).not.toContain("8787/mcp");
  });

  it.each(["http://evil.example.com/mcp", "https://user:pw@mn.example.com/mcp", "https://mn.example.com/mcp?x=1", "https://mn.example.com/mcp#f", "javascript:alert(1)", "ftp://localhost/mcp",
    "https://mn.example.com/other", "https://mn.example.com/mcp/", "https://mn.example.com/", "https://$(id).example.com/mcp", "https://`id`.example.com/mcp",
    "https://a;b.example.com/mcp", "https://a|b.example.com/mcp", "https://a&b.example.com/mcp", "https://a b.example.com/mcp", "https://a'b.example.com/mcp",
    'https://a"b.example.com/mcp', "https://a$b.example.com/mcp", "https://mn.example.com/mcp;id", "https://mn.example.com/mcp'$(id)'", "https://[::1;id]/mcp"])(
    "drops an unsafe published mcpUrl (%s) and treats it as not published",
    async (bad) => {
      await renderSignedIn({ mcpUrl: bad });
      expect(await screen.findByText("Not published by the server")).toBeInTheDocument();
      expect(document.body.textContent).not.toContain(bad);
    },
  );

  it("uses the server's advertised mcpUrl when present", async () => {
    await renderSignedIn({ mcpUrl: "https://mn.example.com/mcp" });
    await waitFor(() => expect(document.body.textContent).toContain("claude mcp add --transport http mnemonis 'https://mn.example.com/mcp'"));
  });

  it("creates a token with a label, reveals the full command once with Copy, and keeps the secret out of storage and URLs", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/Give the token a name/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "POST" && c.path === "/api/tokens")).toBe(false);

    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/it is shown once/)).toBeInTheDocument();
    expect(fake.calls.find((c) => c.method === "POST" && c.path === "/api/tokens")!.body).toEqual({ label: "Laptop" });
    const command = claudeCodeCommand("http://localhost:8788/mcp", MCP_TOKEN_SECRET);
    expect(document.body.textContent).toContain(command);

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));

    // The list shows the prefix only, never the secret.
    const row = (await screen.findByText("Laptop", { selector: "td" })).closest("tr")!;
    expect(within(row).getByText(MCP_TOKEN_SECRET.slice(0, 8))).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    for (const store of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toContain(MCP_TOKEN_SECRET);
    }
    expect(fake.calls.every((c) => !c.path.includes(MCP_TOKEN_SECRET))).toBe(true);

    // Hiding it is final: the command goes back to the placeholder.
    fireEvent.click(screen.getByRole("button", { name: "Done, hide the token" }));
    expect(document.body.textContent).not.toContain(MCP_TOKEN_SECRET);
    expect(document.body.textContent).toContain("Bearer <token>");
  });

  it("lists name, prefix, created, last used, expires and status", async () => {
    await renderSignedIn();
    fake.state.tokens.push(
      { id: "a", label: "Old", prefix: "mn_old00", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: "2026-01-02T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", revokedAt: null },
      { id: "b", label: "Gone", prefix: "mn_gone0", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: "2099-01-01T00:00:00Z", revokedAt: "2026-01-03T00:00:00Z" },
      { id: "c", label: "Lapsed", prefix: "mn_laps0", createdAt: "2020-01-01T00:00:00Z", lastUsedAt: null, expiresAt: "2020-04-01T00:00:00Z", revokedAt: null },
    );
    // Creating a token reloads the list, which now includes the three seeded rows.
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByText("Lapsed", { selector: "td" });
    const table = screen.getByRole("table");
    for (const h of ["Name", "Prefix", "Created", "Last used", "Expires", "Status"]) {
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    expect(within(within(table).getByText("Gone").closest("tr")!).getByText("Revoked")).toBeInTheDocument();
    expect(within(within(table).getByText("Lapsed").closest("tr")!).getByText("Expired")).toBeInTheDocument();
    expect(within(within(table).getByText("Old").closest("tr")!).getByText("mn_old00")).toBeInTheDocument();
    expect(within(table).getAllByText("Never").length).toBeGreaterThan(0);
    // Only active tokens can be revoked.
    expect(within(screen.getByText("Gone", { selector: "td" }).closest("tr")!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByText("Lapsed", { selector: "td" }).closest("tr")!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByText("Old", { selector: "td" }).closest("tr")!).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("revokes only after a confirm", async () => {
    await renderSignedIn();
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByText("Laptop", { selector: "td" });
    const revokeIn = (label: string) => within(screen.getByText(label, { selector: "td" }).closest("tr")!).getByRole("button", { name: "Revoke" });
    fireEvent.click(revokeIn("Laptop"));
    expect(screen.getByText(/stops working immediately/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(await within(screen.getByText("Laptop", { selector: "td" }).closest("tr")!).findByRole("button", { name: "Revoke" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke token" }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === "DELETE" && c.path === "/api/tokens/t1")).toBe(true));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    // Revoking the token that was just revealed also drops the revealed command.
    expect(document.body.textContent).not.toContain(MCP_TOKEN_SECRET);
  });

  it("reports the token limit", async () => {
    await renderSignedIn();
    fake.on("POST /api/tokens", { status: 409, json: { error: { code: "token_limit_reached", message: "x" } } });
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "One too many" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/reached the limit of active tokens/)).toBeInTheDocument();
  });

  it("an expired session while using the page sends the user to sign-in handling (401 clears the session)", async () => {
    await renderSignedIn();
    fake.state.sessionAlive = false;
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull());
  });
});

describe("tokenStatus", () => {
  it("is Revoked, Expired or Active", () => {
    const now = Date.parse("2026-06-01T00:00:00Z");
    expect(tokenStatus({ revokedAt: "2026-01-01T00:00:00Z", expiresAt: null }, now)).toBe("Revoked");
    expect(tokenStatus({ revokedAt: null, expiresAt: "2026-05-01T00:00:00Z" }, now)).toBe("Expired");
    expect(tokenStatus({ revokedAt: null, expiresAt: "2026-07-01T00:00:00Z" }, now)).toBe("Active");
    expect(tokenStatus({ revokedAt: null, expiresAt: null }, now)).toBe("Active");
  });
});

describe("shell safety of the copied command", () => {
  it("safeMcpUrl accepts plain hosts and bracketed IPv6 with the exact /mcp path, nothing else", () => {
    for (const ok of ["https://mn.example.com/mcp", "http://localhost:8788/mcp", "http://127.0.0.1:8788/mcp", "http://[::1]:8788/mcp", "https://10.0.0.1:8443/mcp"]) {
      expect(safeMcpUrl(ok), ok).toBe(ok);
    }
    for (const bad of [
      "https://$(touch x).example.com/mcp",
      "https://`id`.example.com/mcp",
      "https://a;b.example.com/mcp",
      "https://a|b.example.com/mcp",
      "https://a&b.example.com/mcp",
      "https://a'b.example.com/mcp",
      "https://a$b.example.com/mcp",
      "https://mn.example.com/mcp;id",
      "https://mn.example.com/mcp%27",
      "https://mn.example.com/mcp/",
      "https://mn.example.com/x/mcp",
      "https://[::1;id]/mcp",
    ]) {
      expect(safeMcpUrl(bad), bad).toBeUndefined();
    }
  });

  it("shellQuote makes any value one literal word", () => {
    expect(shellQuote("abc")).toBe("'abc'");
    expect(shellQuote("a'b")).toBe(String.raw`'a'\''b'`);
    expect(shellQuote('$(id) `id` ; | & "x"')).toBe(`'$(id) \`id\` ; | & "x"'`);
  });

  it("quotes the URL and the whole header, even for a hostile token or URL", () => {
    expect(claudeCodeCommand("https://mn.example.com/mcp", "mn_abc")).toBe(
      "claude mcp add --transport http mnemonis 'https://mn.example.com/mcp' --header 'Authorization: Bearer mn_abc'",
    );
    const hostile = claudeCodeCommand("https://a.example.com/mcp'$(id)'", "t'; rm -rf ~; echo '");
    expect(hostile).toBe(
      String.raw`claude mcp add --transport http mnemonis 'https://a.example.com/mcp'\''$(id)'\''' --header 'Authorization: Bearer t'\''; rm -rf ~; echo '\'''`,
    );
    // nothing dangerous survives outside single quotes
    const outside = hostile.replace(/'(?:[^']|'\\'')*'/g, "");
    expect(outside).not.toMatch(/[$`;|&()]/);
  });
});
