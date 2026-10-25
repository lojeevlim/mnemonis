import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { nativeSelect, renderAt, resetWorkspace } from "../../test/helpers";
import { MemoriesPage } from "./MemoriesPage";

const store = () => useWorkspace.getState();
const open = () => {
  const r = renderAt("/memories", "/memories", <MemoriesPage />);
  fireEvent.click(screen.getAllByRole("button", { name: "New memory" })[0]);
  return r;
};
const collectionOf = (title: string) =>
  Object.values(store().state!.revisions).find((r) => r.snapshot.title === title)!.snapshot.collectionId;

beforeEach(async () => {
  await resetWorkspace();
});

describe("New memory form: collection default", () => {
  it("offers Automatic (Unsorted) first and files the memory in Unsorted", async () => {
    const { container } = open();
    const select = nativeSelect(container, "Collection") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Automatic (Unsorted)", "No collection"]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Loose note" } });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    await waitFor(() => expect(Object.keys(store().state!.memories)).toHaveLength(1));
    const id = collectionOf("Loose note");
    expect(store().state!.collections[id as string].name).toBe("Unsorted");
  });

  it("previews and applies a title-prefix collection", async () => {
    await store().createCollection("Mnemonis");
    const { container } = open();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "mnemonis: pick Postgres" } });
    const select = nativeSelect(container, "Collection") as HTMLSelectElement;
    expect(select.options[0].textContent).toBe("Automatic (Mnemonis)");
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    await waitFor(() => expect(Object.keys(store().state!.memories)).toHaveLength(1));
    expect(store().state!.collections[collectionOf("mnemonis: pick Postgres") as string].name).toBe("Mnemonis");
  });

  it("still allows No collection and a specific collection", async () => {
    await store().createCollection("Work");
    const work = Object.values(store().state!.collections)[0];
    const { container } = open();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bare" } });
    fireEvent.change(nativeSelect(container, "Collection"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    await waitFor(() => expect(Object.keys(store().state!.memories)).toHaveLength(1));
    expect(collectionOf("Bare")).toBeNull();
    expect(Object.values(store().state!.collections).map((c) => c.name)).toEqual(["Work"]);

    fireEvent.click(screen.getAllByRole("button", { name: "New memory" })[0]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Filed" } });
    fireEvent.change(nativeSelect(document.body, "Collection"), { target: { value: work.id } });
    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    await waitFor(() => expect(Object.keys(store().state!.memories)).toHaveLength(2));
    expect(collectionOf("Filed")).toBe(work.id);
  });
});
