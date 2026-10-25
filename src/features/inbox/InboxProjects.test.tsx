import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { InboxPage } from "./InboxPage";

const store = () => useWorkspace.getState();
const agent = { kind: "agent", name: "claude-code" } as const;
const renderPage = () => renderAt("/inbox", "/inbox", <InboxPage />);
const item = (title: string) =>
  within(screen.getByRole("list", { name: "Changes waiting for review" }))
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(title))!;

beforeEach(async () => {
  await resetWorkspace();
});

describe("Inbox: projects", () => {
  it("shows the project by name with a 'new project' chip, the repository and the collection; never a raw id", async () => {
    await store().createMemory(
      { title: "Deploy notes", project: { name: "Mnemonis", repo: "git@github.com:Acme/Mnemonis.git" } },
      { actor: agent },
    );
    renderPage();
    const li = item("Deploy notes");
    expect(li).toHaveTextContent("Project: Mnemonis (new)");
    expect(within(li).getByText("new project, created by claude-code")).toBeInTheDocument();
    expect(li).toHaveTextContent("Repository: github.com/acme/mnemonis");
    expect(li).toHaveTextContent("Collection: Mnemonis");
    const project = Object.values(store().state!.projects)[0];
    expect(li.textContent).not.toContain(project.id);
    expect(li.textContent).not.toContain(project.collectionId!);
    expect(screen.getByText(/1 unconfirmed project —/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "review" })).toHaveAttribute("href", "/collections#projects");
  });

  it("a project the user already confirmed has no new-project marker and no banner", async () => {
    const p = await store().createProject({ name: "Known", repo: "https://github.com/acme/known" });
    await store().createMemory({ title: "Known: note", projectId: p!.id }, { actor: agent });
    renderPage();
    const li = item("Known: note");
    expect(li).toHaveTextContent("Project: Known");
    expect(li).not.toHaveTextContent("(new)");
    expect(within(li).queryByText(/new project, created by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unconfirmed project/)).not.toBeInTheDocument();
  });

  it("the banner counts unconfirmed projects and disappears once the memory is approved", async () => {
    await store().createMemory({ title: "A", project: { name: "One" } }, { actor: agent });
    await store().createMemory({ title: "B", project: { name: "Two" } }, { actor: agent });
    renderPage();
    expect(screen.getByText(/2 unconfirmed projects —/)).toBeInTheDocument();
    fireEvent.click(within(item("A")).getByRole("button", { name: "Approve A" }));
    expect(await screen.findByText(/1 unconfirmed project —/)).toBeInTheDocument();
    await waitFor(() => expect(Object.values(store().state!.projects).filter((p) => p.confirmed)).toHaveLength(1));
  });

  it("a proposal that moves a memory to no project shows 'No project'", async () => {
    const p = await store().createProject({ name: "Gone" });
    const m = await store().createMemory({ title: "Moving", projectId: p!.id });
    await store().updateMemory(m!.id, { projectId: null }, { actor: agent });
    renderPage();
    expect(item("Moving")).toHaveTextContent("Project: No project");
  });
});
