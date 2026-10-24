import { render, screen } from "@testing-library/react";
import { McpPage, READ_TOOLS, WRITE_TOOLS } from "./McpPage";

describe("MCP page", () => {
  it("is honest: backend not built, endpoint not configured, tools planned", () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", "");
    render(<McpPage />);
    expect(screen.getByText("Backend pending — connect it in Settings")).toBeInTheDocument();
    expect(screen.getByText("not configured")).toBeInTheDocument();
    for (const t of [...READ_TOOLS, ...WRITE_TOOLS]) expect(screen.getByText(t.name)).toBeInTheDocument();
    expect(READ_TOOLS).toHaveLength(7);
    expect(WRITE_TOOLS).toHaveLength(4);
    expect(screen.getAllByText("Planned")).toHaveLength(11);
    // Tools that no longer exist, and no way for a client to approve its own writes.
    const names = [...READ_TOOLS, ...WRITE_TOOLS].map((t) => t.name);
    expect(names).not.toContain("memory_commit");
    expect(names).not.toContain("memory_branch_create");
    expect(names.filter((n) => /approve|reject/.test(n))).toEqual([]);
    expect(screen.getByText(/only you can do in this app/)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("shows the configured endpoint", () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", "http://localhost:8787");
    render(<McpPage />);
    expect(screen.getByText("http://localhost:8787")).toBeInTheDocument();
    expect(screen.queryByText("not configured")).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it("previews token management disabled and never generates a token", () => {
    render(<McpPage />);
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    expect(screen.getByPlaceholderText("e.g. Claude Code on laptop")).toBeDisabled();
    expect(screen.getByText(/No token is generated or stored/)).toBeInTheDocument();
    for (const w of ["Shown once", "Hashed", "Revocable", "Expiring", "Scopes"]) {
      expect(screen.getByText(new RegExp(`${w}:?`))).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/mnm_[A-Za-z0-9]{8,}/);
  });

  it("gives the real Claude Code command with a token placeholder and where to get the token", () => {
    render(<McpPage />);
    expect(screen.getByText("Connect Claude Code")).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      'claude mcp add --transport http mnemonis http://localhost:8787/mcp --header "Authorization: Bearer <token>"',
    );
    expect(screen.getByText(/npm run token/)).toBeInTheDocument();
    expect(screen.getByText(/costs no LLM tokens/)).toBeInTheDocument();
  });
});

describe("MCP write tool descriptions", () => {
  it("every write tool says it waits in the Inbox", () => {
    for (const t of WRITE_TOOLS) expect(t.description).toMatch(/Inbox/);
    expect(WRITE_TOOLS.find((t) => t.name === "memory_link")!.description).toMatch(/waits in your Inbox/);
  });
});
