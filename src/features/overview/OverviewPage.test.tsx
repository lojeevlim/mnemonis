import { screen, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { OverviewPage } from "./OverviewPage";

const renderPage = () => renderAt("/", "/", <OverviewPage />);

describe("OverviewPage", () => {
  it("shows labeled demo data, stats, topics and the MCP status", async () => {
    await resetWorkspace({ seed: true });
    renderPage();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getAllByText("Demo").length).toBeGreaterThan(0);
    const stats = screen.getByRole("region", { name: "Workspace stats" });
    for (const label of ["Memories", "Drafts (unsaved)", "Active branches", "Versions"]) {
      expect(within(stats).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Recent versions")).toBeInTheDocument();
    expect(screen.getByText("Frequently connected topics")).toBeInTheDocument();
    expect(screen.getByText(/Not connected — backend not built yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "#Demo" })).not.toBeInTheDocument();
  });

  it("renders empty states for an empty workspace and counts new drafts", async () => {
    await resetWorkspace();
    renderPage();
    expect(screen.getByText("No memories yet")).toBeInTheDocument();
    expect(screen.getByText("No versions yet")).toBeInTheDocument();
    expect(screen.queryByText("Includes seeded demo memories.")).not.toBeInTheDocument();
    await useWorkspace.getState().createMemory({ title: "Fresh" });
    expect(await screen.findByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});
