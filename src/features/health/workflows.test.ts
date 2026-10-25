import type { Memory, Relation } from "../../domain";
import { runOrganize, runReview, jaccard, tokenize, type WorkflowInput } from "./workflows";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const DAY = 86_400_000;

function mem(id: string, p: Partial<Memory> = {}): Memory {
  return {
    id,
    title: id,
    content: "some content",
    type: "fact",
    tags: ["t"],
    collectionId: "col1",
    projectId: null,
    archived: false,
    metadata: {},
    createdAt: "2026-05-30T00:00:00.000Z",
    source: "manual",
    provenance: { origin: "user", createdBy: "me" },
    status: "saved",
    hasPending: false,
    updatedAt: "2026-05-30T00:00:00.000Z",
    revisionId: `rev_${id}`,
    ...p,
  };
}
function rel(fromId: string, toId: string, label = "related to"): Relation {
  return { id: `${fromId}-${toId}`, fromId, toId, label, provenance: { origin: "user", createdBy: "me" }, createdAt: "2026-05-30T00:00:00.000Z", status: "saved", decidedAt: null };
}
/** Fully connected, fully tagged: only the findings a test adds should show up. */
function input(memories: Memory[], relations: Relation[] = []): WorkflowInput {
  const ids = memories.map((m) => m.id);
  const links = relations.length ? relations : ids.slice(1).map((id) => rel(ids[0], id));
  return { memories, relations: links, collections: [{ id: "col1", name: "Col" }], now: NOW };
}
const lib = (i: WorkflowInput) => runOrganize(i, { duplicateThreshold: 0.6 });
const rev = (i: WorkflowInput, staleDays = 90) => runReview(i, { staleDays });
const kinds = (ps: { kind: string }[]) => ps.map((p) => p.kind);

describe("text helpers", () => {
  it("tokenizes without stopwords/short words and computes jaccard", () => {
    expect([...tokenize("The Quick, brown fox!")].sort()).toEqual(["brown", "fox", "quick"]);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });
});

describe("Organize", () => {
  it("proposes archiving the older copy of an exact-title duplicate (high confidence)", () => {
    const a = mem("a", { title: "Release  Process!", updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = mem("b", { title: "release process", content: "different words entirely here" });
    const ps = lib(input([a, b]));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: "duplicate", confidence: "high", action: { kind: "archive", memoryId: "a" } });
    expect(ps[0].id).toBe("organize:duplicate:a+b");
  });

  it("links near-duplicates above the threshold and ignores dissimilar or archived ones", () => {
    const a = mem("a", { title: "Deploy checklist production", content: "run tests build tag release notes publish" });
    const b = mem("b", { title: "Deploy checklist staging", content: "run tests build tag release notes publish" });
    const c = mem("c", { title: "Pasta recipe", content: "boil water add salt" });
    const arch = mem("d", { title: "Deploy checklist production", archived: true });
    const ps = lib(input([a, b, c, arch], [rel("a", "c"), rel("b", "c")]));
    expect(kinds(ps)).toEqual(["near-duplicate"]);
    expect(ps[0].action).toEqual({ kind: "link", fromId: "a", toId: "b", label: "similar to" });
    expect(lib(input([a, c])).filter((p) => p.kind === "near-duplicate")).toHaveLength(0);
  });

  it("flags missing tags, collection, content and source", () => {
    const bare = mem("bare", { tags: [], collectionId: null, content: "  ", source: "", type: "technical_decision" });
    const other = mem("other", { title: "unrelated" });
    const ps = lib(input([bare, other]));
    expect(kinds(ps).sort()).toEqual(["empty-content", "missing-collection", "missing-source", "missing-tags"]);
    const tags = ps.find((p) => p.kind === "missing-tags")!;
    expect(tags.action).toEqual({ kind: "add-tag", memoryId: "bare", tag: "technical-decision" });
    expect(ps.find((p) => p.kind === "empty-content")!.action).toBeNull();
    expect(ps.find((p) => p.kind === "missing-source")!.action).toBeNull();
  });

  it("suggests a collection from the most similar memory, else asks for a manual choice", () => {
    const m = mem("m", { title: "Graph layout notes", content: "force layout nodes edges", collectionId: null });
    const sibling = mem("s", { title: "Graph layout basics", content: "force layout nodes edges springs", collectionId: "col1" });
    const withHint = lib(input([m, sibling])).find((p) => p.kind === "missing-collection")!;
    expect(withHint.action).toEqual({ kind: "set-collection", memoryId: "m", collectionId: "col1" });
    const alone = mem("x", { title: "zzz", content: "qqq", collectionId: null });
    const manual = lib(input([alone, mem("y", { title: "yyy", content: "www" })])).find((p) => p.kind === "missing-collection")!;
    expect(manual.action).toBeNull();
  });

  it("flags isolated memories and suggests a link when something is similar", () => {
    const a = mem("a", { title: "Alpha topic notes", content: "alpha beta gamma" });
    const b = mem("b", { title: "Alpha topic more", content: "alpha beta delta" });
    const c = mem("c", { title: "Other", content: "unrelated stuff" });
    const ps = lib({ ...input([a, b, c], [rel("a", "b")]) });
    const iso = ps.filter((p) => p.kind === "isolated");
    expect(iso.map((p) => p.memoryIds[0])).toEqual(["c"]);
    expect(iso[0].action).toBeNull();
  });

  it("is deterministic", () => {
    const ms = [mem("a", { tags: [] }), mem("b", { collectionId: null })];
    expect(lib(input(ms))).toEqual(lib(input(ms)));
  });
});

describe("Review", () => {
  it("flags memories older than the configured number of days", () => {
    const old = mem("old", { updatedAt: new Date(NOW - 100 * DAY).toISOString() });
    const fresh = mem("fresh", { updatedAt: new Date(NOW - 10 * DAY).toISOString() });
    const ps = rev(input([old, fresh]));
    expect(ps.map((p) => p.memoryIds[0])).toEqual(["old"]);
    expect(ps[0].action).toEqual({ kind: "add-tag", memoryId: "old", tag: "needs-review" });
    expect(rev(input([old, fresh]), 5).map((p) => p.memoryIds[0]).sort()).toEqual(["fresh", "old"]);
    expect(rev(input([old, fresh]), 200)).toHaveLength(0);
  });

  it("does not re-propose the review tag", () => {
    const old = mem("old", { updatedAt: new Date(NOW - 100 * DAY).toISOString(), tags: ["needs-review"] });
    expect(rev(input([old]))[0].action).toBeNull();
  });

  it("detects a possible contradiction heuristically, labelled low confidence", () => {
    const a = mem("a", { title: "Use Redux for state", tags: ["state"], content: "We use Redux for client state management" });
    const b = mem("b", { title: "Redux state", tags: ["state"], content: "Redux is deprecated for client state management, never use it" });
    const ps = rev(input([a, b]));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: "contradiction", confidence: "low", heuristic: true });
    expect(ps[0].action).toEqual({ kind: "link", fromId: "a", toId: "b", label: "possible contradiction" });
    expect(ps[0].evidence[0]).toMatch(/heuristic/i);
  });

  it("does not flag unrelated memories, both-negated pairs, or already-linked pairs", () => {
    const a = mem("a", { title: "Cooking", tags: ["food"], content: "bake bread slowly" });
    const b = mem("b", { title: "Rust", tags: ["code"], content: "never use unsafe" });
    expect(rev(input([a, b]))).toHaveLength(0);
    const c = mem("c", { title: "Redux state", tags: ["state"], content: "never use Redux for state management" });
    const d = mem("d", { title: "Redux state", tags: ["state"], content: "do not use Redux for state management" });
    expect(rev(input([c, d]))).toHaveLength(0);
    const e = mem("e", { title: "Use Redux state", tags: ["state"], content: "We use Redux for client state management" });
    const f = mem("f", { title: "Redux state", tags: ["state"], content: "Redux is deprecated for client state management" });
    expect(rev(input([e, f], [rel("e", "f", "possible contradiction")]))).toHaveLength(0);
  });

  it("flags incomplete provenance without an automatic action", () => {
    const m = mem("m", { provenance: { origin: "", createdBy: "me" } });
    const ps = rev(input([m]));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: "missing-provenance", action: null });
  });
});
