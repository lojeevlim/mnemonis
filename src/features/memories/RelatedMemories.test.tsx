import { render, screen } from "@testing-library/react";
import { listMemories } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace } from "../../test/helpers";
import { RelatedMemories } from "./RelatedMemories";

const store = () => useWorkspace.getState();

beforeEach(async () => {
  await resetWorkspace();
});

describe("RelatedMemories", () => {
  it("never shows a raw id: relations whose other endpoint title is unknown are skipped", async () => {
    const a = await store().createMemory({ title: "Alpha" });
    const b = await store().createMemory({ title: "Beta" });
    await store().addRelation(a!.id, b!.id, "cites");
    const state = store().state!;
    const all = listMemories(state);
    const alpha = all.find((m) => m.id === a!.id)!;

    const { rerender } = render(
      <RelatedMemories state={state} memory={alpha} memories={all} onOpenMemory={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();

    // Beta's title is not known to the caller: the row must disappear, not fall back to the id.
    rerender(
      <RelatedMemories state={state} memory={alpha} memories={all.filter((m) => m.id !== b!.id)} onOpenMemory={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: b!.id })).not.toBeInTheDocument();
    expect(screen.queryByText(b!.id)).not.toBeInTheDocument();
    expect(screen.getByText("No related memories yet.")).toBeInTheDocument();
  });
});
