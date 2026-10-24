import { getMemory } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace } from "../../test/helpers";
import { applyProposal } from "./applyProposal";
import type { Proposal } from "./workflows";

const proposal = (action: Proposal["action"]): Proposal => ({
  id: "p", agent: "librarian", kind: "missing-tags", finding: "f", evidence: [],
  confidence: "high", memoryIds: ["m1"], action, suggestion: "s",
});

beforeEach(async () => {
  await resetWorkspace();
  await useWorkspace.getState().createMemory({ id: "m1", title: "One", tags: ["a"] });
  await useWorkspace.getState().createMemory({ id: "m2", title: "Two" });
});

describe("applyProposal reads fresh store state", () => {
  it("sees state changes made after earlier calls (memory removed from view, author changed)", async () => {
    await applyProposal(proposal({ kind: "add-tag", memoryId: "m1", tag: "b" }));
    expect(getMemory(useWorkspace.getState().state!, "m1")?.tags).toEqual(["a", "b"]);
    // second call must build on the tags written by the first, not on a stale snapshot
    await applyProposal(proposal({ kind: "add-tag", memoryId: "m1", tag: "c" }));
    expect(getMemory(useWorkspace.getState().state!, "m1")?.tags).toEqual(["a", "b", "c"]);

    useWorkspace.setState({ author: "agent-runner" });
    await applyProposal(proposal({ kind: "link", fromId: "m1", toId: "m2", label: "related" } as Proposal["action"]));
    const rel = Object.values(useWorkspace.getState().state!.relations)[0];
    expect(rel.provenance.createdBy).toBe("agent-runner");
  });
});
