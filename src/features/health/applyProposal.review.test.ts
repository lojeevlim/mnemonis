import { getMemory, pendingRevisionFor } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { resetWorkspace } from "../../test/helpers";
import { applyProposal } from "./applyProposal";
import type { Proposal } from "./workflows";

const proposal = (action: Proposal["action"]): Proposal => ({
  id: "p", check: "organize", kind: "missing-tags", finding: "f", evidence: [],
  confidence: "high", memoryIds: ["m1"], action, suggestion: "s",
});

beforeEach(async () => {
  await resetWorkspace();
  await useWorkspace.getState().createMemory({ id: "m1", title: "One", tags: ["a"] });
  await useWorkspace.getState().createMemory({ id: "m2", title: "Two" });
});

describe("applyProposal reads fresh store state", () => {
  it("accumulates the check's own pending edits and reads fresh state (signed-in author changed)", async () => {
    await applyProposal(proposal({ kind: "add-tag", memoryId: "m1", tag: "b" }));
    expect(pendingRevisionFor(useWorkspace.getState().state!, "m1")?.snapshot.tags).toEqual(["a", "b"]);
    // second call must build on the tags proposed by the first, not on the saved snapshot
    await applyProposal(proposal({ kind: "add-tag", memoryId: "m1", tag: "c" }));
    const s = useWorkspace.getState().state!;
    expect(pendingRevisionFor(s, "m1")).toMatchObject({ origin: "agent", author: "Memory Health: Organize" });
    expect(pendingRevisionFor(s, "m1")?.snapshot.tags).toEqual(["a", "b", "c"]);
    // nothing is saved until the user approves
    expect(getMemory(s, "m1")?.tags).toEqual(["a"]);

    useWorkspace.setState({ author: "agent-runner" });
    await applyProposal(proposal({ kind: "link", fromId: "m1", toId: "m2", label: "related" } as Proposal["action"]));
    const rel = Object.values(useWorkspace.getState().state!.relations)[0];
    // The link is attributed to the check (not the signed-in user) and waits for approval.
    expect(rel).toMatchObject({
      status: "pending",
      provenance: { origin: "process", createdBy: "Memory Health: Organize", process: "Memory Health: Organize" },
    });
  });
});
