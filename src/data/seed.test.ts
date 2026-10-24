import { describe, expect, it } from "vitest";
import {
  BUILT_IN_MEMORY_TYPES,
  commitLog,
  listMemories,
  listRelations,
  pendingChanges,
  validateWorkspaceState,
} from "../domain";
import { createSeedWorkspace, DEMO_TAG } from "./seed";

describe("seed workspace", () => {
  const s = createSeedWorkspace();
  const mains = listMemories(s, "main");

  it("is deterministic and JSON-safe and valid", () => {
    expect(createSeedWorkspace()).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(validateWorkspaceState(s).ok).toBe(true);
  });

  it("has ~15-20 committed memories covering every built-in type", () => {
    expect(mains.length).toBeGreaterThanOrEqual(15);
    expect(mains.length).toBeLessThanOrEqual(20);
    expect(new Set(mains.map((m) => m.type))).toEqual(new Set(BUILT_IN_MEMORY_TYPES));
    expect(mains.every((m) => m.status === "committed")).toBe(true);
    expect(Object.keys(s.collections)).toHaveLength(3);
  });

  it("ids are unique and every memory is labeled Demo", () => {
    const ids = Object.keys(s.memories);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(s.memories[id].provenance.origin).toBe("demo");
    }
    for (const m of [...mains, ...listMemories(s, "experiment-ranking")]) {
      expect(m.tags).toContain(DEMO_TAG);
      expect(m.metadata.demo).toBe(true);
    }
    expect(new Set(Object.keys(s.relations)).size).toBe(Object.keys(s.relations).length);
  });

  it("every relation endpoint exists; has isolated nodes and a cluster", () => {
    const rels = listRelations(s);
    expect(rels.length).toBeGreaterThanOrEqual(15);
    for (const r of rels) {
      expect(s.memories[r.fromId]).toBeDefined();
      expect(s.memories[r.toId]).toBeDefined();
    }
    const degree = (id: string) => listRelations(s, id).length;
    const isolated = mains.filter((m) => degree(m.id) === 0);
    expect(isolated.length).toBeGreaterThanOrEqual(2);
    expect(degree("mem_proj_mnemonis")).toBeGreaterThanOrEqual(6);
  });

  it("has several commits on main and an extra branch with uncommitted drafts", () => {
    expect(commitLog(s, "main").length).toBeGreaterThanOrEqual(3);
    expect(s.currentBranchId).toBe("main");
    expect(pendingChanges(s, "main")).toHaveLength(0);
    const draftsOnBranch = pendingChanges(s, "experiment-ranking");
    expect(draftsOnBranch.length).toBeGreaterThanOrEqual(1);
    expect(listMemories(s, "experiment-ranking").some((m) => m.status === "draft")).toBe(true);
    expect(Object.keys(s.branches)).toHaveLength(2);
  });
});
