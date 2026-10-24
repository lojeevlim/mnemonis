import { isUnsaved } from "./isUnsaved";

const state = { revisions: { saved: { savedAt: "2024-01-01" }, draft: {} } } as never;

describe("isUnsaved", () => {
  it("is true only for a pending memory whose current revision was never saved", () => {
    expect(isUnsaved(state, { hasPending: true, revisionId: "draft" })).toBe(true);
    expect(isUnsaved(state, { hasPending: true, revisionId: "missing" })).toBe(true);
    expect(isUnsaved(state, { hasPending: true, revisionId: "saved" })).toBe(false);
    expect(isUnsaved(state, { hasPending: false, revisionId: "draft" })).toBe(false);
  });
});
