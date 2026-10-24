import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { STORAGE_KEY } from "../data/localRepository";
import { useWorkspace } from "../stores/workspaceStore";
import { WorkspaceGate } from "./WorkspaceGate";

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ state: null, loading: false, error: null, loadIssue: null, persistError: null });
});

describe("WorkspaceGate", () => {
  it("initialises the store once and renders children", async () => {
    render(
      <WorkspaceGate>
        <div>child content</div>
      </WorkspaceGate>,
    );
    expect(screen.getByText("Loading workspace")).toBeInTheDocument();
    expect(await screen.findByText("child content")).toBeInTheDocument();
    expect(useWorkspace.getState().state).not.toBeNull();
    // First run: seeded silently, no warning.
    expect(screen.queryByText("Saved data could not be read")).not.toBeInTheDocument();
  });

  it("surfaces a corrupt save as a dismissible alert", async () => {
    localStorage.setItem(STORAGE_KEY, "{{{ not json");
    render(
      <WorkspaceGate>
        <div>child content</div>
      </WorkspaceGate>,
    );
    expect(await screen.findByText("Saved data could not be read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Saved data could not be read")).not.toBeInTheDocument());
  });

  it("shows persistence and action errors, and an error state with retry when loading fails", async () => {
    render(
      <WorkspaceGate>
        <div>child content</div>
      </WorkspaceGate>,
    );
    await screen.findByText("child content");
    useWorkspace.setState({ persistError: "Quota exceeded", error: "Boom" });
    expect(await screen.findByText(/Quota exceeded/)).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();
    useWorkspace.setState({ state: null, persistError: null, error: "load failed" });
    expect(await screen.findByText("Could not load your workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
