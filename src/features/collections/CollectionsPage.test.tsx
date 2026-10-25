import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { renderAt, resetWorkspace } from "../../test/helpers";
import { CollectionsPage } from "./CollectionsPage";

const store = () => useWorkspace.getState();
const renderPage = () => renderAt("/collections", "/collections", <CollectionsPage />);
const names = () => Object.values(store().state!.collections).map((c) => c.name);

beforeEach(async () => {
  await resetWorkspace();
});

describe("Collections", () => {
  it("shows an empty state, then creates and renames a collection", async () => {
    renderPage();
    expect(screen.getByText("No collections yet")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "New collection" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

    const list = await screen.findByRole("list", { name: "Collections" });
    expect(within(list).getByText("Research")).toBeInTheDocument();
    expect(within(list).getByText("0 memories")).toBeInTheDocument();
    expect(names()).toEqual(["Research"]);

    fireEvent.click(screen.getByRole("button", { name: "Rename Research" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Research notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(names()).toEqual(["Research notes"]));
    expect(await screen.findByText("Research notes")).toBeInTheDocument();
  });

  it("deletes an empty collection after confirmation (and cancel keeps it)", async () => {
    await store().createCollection("Temp");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Temp" }));
    expect(await screen.findByText("Delete “Temp”?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(names()).toEqual(["Temp"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Temp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(names()).toEqual([]));
    expect(await screen.findByText("No collections yet")).toBeInTheDocument();
  });

  it("lists members with counts and links to the filtered Memories view; refuses to delete non-empty", async () => {
    await store().createCollection("Work");
    const col = Object.values(store().state!.collections)[0];
    await store().createMemory({ title: "In work", collectionId: col.id });
    await store().createMemory({ title: "Elsewhere", collectionId: null });
    renderPage();

    const list = screen.getByRole("list", { name: "Collections" });
    expect(within(list).getByText("1 memory")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Work" }));
    const members = await screen.findByRole("list", { name: "Memories in Work" });
    expect(within(members).getByText("In work")).toBeInTheDocument();
    expect(within(members).queryByText("Elsewhere")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Memories" })).toHaveAttribute(
      "href",
      `/memories?collection=${col.id}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(store().error).toMatch(/still has memories/i));
    expect(names()).toEqual(["Work"]);
  });
});
