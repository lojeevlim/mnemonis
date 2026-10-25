import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { listMemories, memoryHistory, suggestReassignments } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { CollectionsPage } from "./CollectionsPage";

const store = () => useWorkspace.getState();
const agent = { kind: "agent", name: "claude-code" } as const;
const renderPage = () => renderAt("/collections", "/collections", <CollectionsPage />);
const projectNames = () => Object.values(store().state!.projects).map((p) => p.name);
const row = (name: string) =>
  within(screen.getByRole("list", { name: "Projects list" }))
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(name))!;

beforeEach(async () => {
  await resetWorkspace();
});

describe("Projects section", () => {
  it("shows an empty state, then creates a project with a repository", async () => {
    renderPage();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create project" }));
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Repository (optional)"), { target: { value: "git@github.com:Acme/Portal.git" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(projectNames()).toEqual(["Acme"]));
    const li = await waitFor(() => row("Acme"));
    expect(li).toHaveTextContent("Confirmed");
    expect(li).toHaveTextContent("Repository: github.com/acme/portal");
    expect(li).toHaveTextContent("Folder: Acme");
    expect(li).toHaveTextContent("0 memories");
  });

  it("lists name, folder, sources, unconfirmed badge and member count; Confirm marks it confirmed", async () => {
    await store().createMemory(
      { title: "Deploy", project: { name: "Mnemonis", repo: "https://github.com/acme/mnemonis", workspace: "ws_1" } },
      { actor: agent },
    );
    const mem = await store().createMemory({ title: "Mnemonis: web", project: { name: "Other" } });
    expect(mem).toBeDefined();
    renderPage();
    const li = row("Mnemonis");
    expect(li).toHaveTextContent("Unconfirmed");
    expect(li).toHaveTextContent("created by claude-code");
    expect(li).toHaveTextContent("Repository: github.com/acme/mnemonis");
    expect(li).toHaveTextContent("Workspace: ws_1");
    expect(screen.getByText("1 unconfirmed")).toBeInTheDocument();
    fireEvent.click(within(li).getByRole("button", { name: "Confirm Mnemonis" }));
    await waitFor(() => expect(row("Mnemonis")).toHaveTextContent("Confirmed"));
    expect(screen.queryByText("1 unconfirmed")).not.toBeInTheDocument();
    expect(within(row("Mnemonis")).queryByRole("button", { name: /^Confirm/ })).not.toBeInTheDocument();
  });

  it("renames a project (duplicate names show a clear message) and deletes an unused one after confirmation", async () => {
    await store().createProject({ name: "Alpha" });
    await store().createProject({ name: "Beta" });
    renderPage();
    fireEvent.click(within(row("Beta")).getByRole("button", { name: "Rename project Beta" }));
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("A project with that name already exists. Choose a different name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Gamma" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(projectNames().sort()).toEqual(["Alpha", "Gamma"]));

    fireEvent.click(within(row("Gamma")).getByRole("button", { name: "Delete project Gamma" }));
    expect(await screen.findByText("Delete project “Gamma”?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(projectNames().sort()).toEqual(["Alpha", "Gamma"]);
    fireEvent.click(within(row("Gamma")).getByRole("button", { name: "Delete project Gamma" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(projectNames()).toEqual(["Alpha"]));
  });

  it("refuses to delete a project that still has memories and says why", async () => {
    const p = await store().createProject({ name: "Busy" });
    await store().createMemory({ title: "Roadmap", projectId: p!.id });
    renderPage();
    expect(row("Busy")).toHaveTextContent("1 memory");
    fireEvent.click(within(row("Busy")).getByRole("button", { name: "Delete project Busy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete project" }));
    expect(await screen.findByText(/still has memories or waiting proposals/)).toBeInTheDocument();
    expect(projectNames()).toEqual(["Busy"]);
    expect(store().error).toBeNull(); // moved out of the global alert, shown next to the section
  });

  it("reports how many of the user's own memories a new project filed automatically", async () => {
    await store().createMemory({ title: "Zed: first" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText(/1 of your memories was filed into a project automatically/)).toBeInTheDocument();
    const m = listMemories(store().state!)[0];
    expect(m.projectId).toBe(Object.keys(store().state!.projects)[0]);
    expect(memoryHistory(store().state!, m.id)[0].note).toBe("Filed automatically into Zed");
  });
});

describe("Unsorted notice", () => {
  const agentApproved = async (title: string) => {
    const created = await store().createMemory({ title }, { actor: agent });
    await store().approve(created!.revisionId);
    return created!.id;
  };

  it("offers to file agent-written Unsorted memories only when the user clicks File these", async () => {
    const id = await agentApproved("Acme: from agent");
    await store().createProject({ name: "Acme" });
    expect(suggestReassignments(store().state!)).toHaveLength(1);
    renderPage();
    expect(screen.getByText("1 memory is Unsorted, 1 can be filed.")).toBeInTheDocument();
    expect(screen.getByText("1 can be filed")).toBeInTheDocument(); // badge on the Unsorted collection
    expect(listMemories(store().state!).find((m) => m.id === id)!.projectId).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "File these" }));
    await waitFor(() => expect(listMemories(store().state!).find((m) => m.id === id)!.projectId).not.toBeNull());
    expect(await screen.findByText("Filed 1 memory into their projects")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "File these" })).not.toBeInTheDocument();
  });

  it("shows no notice when nothing can be filed", async () => {
    await store().createMemory({ title: "Plain note" });
    renderPage();
    expect(screen.queryByRole("button", { name: "File these" })).not.toBeInTheDocument();
  });
});
