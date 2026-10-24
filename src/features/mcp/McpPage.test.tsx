import { render, screen } from "@testing-library/react";
import { McpPage, READ_TOOLS, WRITE_TOOLS } from "./McpPage";

describe("MCP page", () => {
  it("is honest: backend not built, endpoint not configured, tools planned", () => {
    vi.stubEnv("VITE_MCP_SERVER_URL", "");
    render(<McpPage />);
    expect(screen.getByText("Backend not built yet — local demo mode")).toBeInTheDocument();
    expect(screen.getByText("not configured")).toBeInTheDocument();
    for (const t of [...READ_TOOLS, ...WRITE_TOOLS]) expect(screen.getByText(t.name)).toBeInTheDocument();
    expect(READ_TOOLS).toHaveLength(6);
    expect(WRITE_TOOLS).toHaveLength(7);
    expect(screen.getAllByText("Planned")).toHaveLength(13);
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

  it("gives the Claude Code command with placeholders and a not-working note", () => {
    render(<McpPage />);
    expect(screen.getByText("Connect Claude Code")).toBeInTheDocument();
    expect(document.body.textContent).toContain("claude mcp add --transport http mnemonis <YOUR_MCP_URL>");
    expect(document.body.textContent).toContain("<YOUR_TOKEN>");
    expect(screen.getByText(/will not work until the backend is deployed/i)).toBeInTheDocument();
    expect(screen.getByText(/costs no LLM tokens/)).toBeInTheDocument();
  });
});
