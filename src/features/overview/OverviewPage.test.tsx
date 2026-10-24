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
    for (const label of ["Memories", "Short Term Memory", "Archived", "Saved changes"]) {
      expect(within(stats).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Frequently connected topics")).toBeInTheDocument();
    expect(screen.getByText(/Not connected — backend not built yet/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "#Demo" })).not.toBeInTheDocument();
    // The seed carries 2 agent proposals and 1 agent link, all counted: the stat links to the Inbox.
    expect(within(stats).getByRole("link", { name: /open Inbox/ })).toHaveAttribute("href", "/inbox");
    expect(within(stats).getByRole("link", { name: /open Inbox/ })).toHaveTextContent("3");
  });

  it("renders empty states for an empty workspace and a user edit is saved, not pending", async () => {
    await resetWorkspace();
    renderPage();
    expect(screen.getByText("No memories yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.queryByText("Includes seeded demo memories.")).not.toBeInTheDocument();
    await useWorkspace.getState().createMemory({ title: "Fresh" });
    expect((await screen.findAllByText("Fresh")).length).toBeGreaterThan(0);
    // The user's own edit is saved straight to long-term memory: nothing waits for review.
    const stats = screen.getByRole("region", { name: "Workspace stats" });
    expect(within(stats).getByRole("link", { name: /open Inbox/ })).toHaveTextContent("0");
    expect(screen.getAllByText("Long Term Memory").length).toBeGreaterThan(0);
    expect(screen.queryByText("Nothing saved yet")).not.toBeInTheDocument();
  });
});
