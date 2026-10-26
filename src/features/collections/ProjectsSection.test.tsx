import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { listMemories, memoryHistory, suggestReassignments } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
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

describe("Organizations", () => {
  const orgs = () => Object.values(store().state!.organizations);
  const orgRow = (name: string) =>
    within(screen.getByRole("list", { name: "Organizations list" }))
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(name))!;
  const pick = (container: HTMLElement, project: string, value: string) =>
    fireEvent.change(nativeSelect(container, `Organization of ${project}`), { target: { value } });

  it("shows an empty state, then creates an organization", async () => {
    renderPage();
    expect(screen.getByText("No organizations yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New organization" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "ROK" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(orgs().map((o) => o.name)).toEqual(["ROK"]));
    expect(await waitFor(() => orgRow("ROK"))).toHaveTextContent("Confirmed");
    expect(orgRow("ROK")).toHaveTextContent("0 projects");
  });

  it("shows each project's organization and assigns / unassigns it with the Organization select", async () => {
    const p = await store().createProject({ name: "VT" });
    await store().createOrganization("ROK");
    const { container } = renderPage();
    expect(row("VT")).toHaveTextContent("Organization: none");
    pick(container, "VT", orgs()[0].id);
    await waitFor(() => expect(store().state!.projects[p!.id].organizationId).toBe(orgs()[0].id));
    expect(row("VT")).toHaveTextContent("Organization: ROK");
    expect(orgRow("ROK")).toHaveTextContent("1 project");
    pick(container, "VT", "__none__");
    await waitFor(() => expect(store().state!.projects[p!.id].organizationId).toBeNull());
    expect(row("VT")).toHaveTextContent("Organization: none");
  });

  it("'New organization…' creates one and assigns it to the project; a duplicate name shows a clear message", async () => {
    const p = await store().createProject({ name: "VT" });
    await store().createOrganization("Existing");
    const { container } = renderPage();
    pick(container, "VT", "__new__");
    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: "existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and assign" }));
    expect(await screen.findByText("An organization with that name already exists. Choose a different name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "ROK" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and assign" }));
    await waitFor(() => expect(orgs().map((o) => o.name).sort()).toEqual(["Existing", "ROK"]));
    const rok = orgs().find((o) => o.name === "ROK")!;
    expect(store().state!.projects[p!.id].organizationId).toBe(rok.id);
  });

  it("renames (duplicates are refused), and deletes after confirmation: the projects stay, unlinked", async () => {
    const p = await store().createProject({ name: "VT" });
    const a = await store().createOrganization("Alpha");
    await store().createOrganization("Beta");
    await store().assignProjectOrganization(p!.id, a!.id);
    renderPage();
    fireEvent.click(within(orgRow("Beta")).getByRole("button", { name: "Rename organization Beta" }));
    fireEvent.change(await screen.findByLabelText("Organization name"), { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("An organization with that name already exists. Choose a different name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Gamma" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(orgs().map((o) => o.name).sort()).toEqual(["Alpha", "Gamma"]));

    fireEvent.click(within(orgRow("Alpha")).getByRole("button", { name: "Delete organization Alpha" }));
    expect(await screen.findByText("Delete organization “Alpha”?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(orgs()).toHaveLength(2);
    fireEvent.click(within(orgRow("Alpha")).getByRole("button", { name: "Delete organization Alpha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete organization" }));
    await waitFor(() => expect(orgs().map((o) => o.name)).toEqual(["Gamma"]));
    expect(store().state!.projects[p!.id].organizationId).toBeNull();
    expect(projectNames()).toEqual(["VT"]);
  });

  it("flags an organization an agent proposed as unconfirmed, with a Confirm button", async () => {
    await store().createMemory({ title: "VT: kickoff", project: { name: "VT" }, organization: "ROK" }, { actor: agent });
    renderPage();
    expect(orgRow("ROK")).toHaveTextContent("Unconfirmed");
    expect(orgRow("ROK")).toHaveTextContent("created by claude-code");
    expect(row("VT")).toHaveTextContent("Organization: ROK");
    expect(within(row("VT")).getByText("Unconfirmed organization")).toBeInTheDocument();
    fireEvent.click(within(orgRow("ROK")).getByRole("button", { name: "Confirm organization ROK" }));
    await waitFor(() => expect(orgRow("ROK")).toHaveTextContent("Confirmed"));
    expect(within(row("VT")).queryByText("Unconfirmed organization")).not.toBeInTheDocument();
    expect(Object.values(store().state!.projects)[0].confirmed).toBe(false); // the project itself is still unconfirmed
  });
});
