import { describe, expect, it } from "vitest";
import {
  BUILT_IN_MEMORY_TYPES,
  getMemory,
  listMemories,
  listPendingRelations,
  listRelations,
  memoryHistory,
  pendingChanges,
  pendingCount,
  timeline,
  validateWorkspaceState,
} from "../domain";
import { createSeedWorkspace, DEMO_TAG } from "./seed";

describe("seed workspace", () => {
  const s = createSeedWorkspace();
  const saved = listMemories(s);
  const all = listMemories(s, { includePending: true });

  it("is deterministic and JSON-safe and valid", () => {
    expect(createSeedWorkspace()).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(validateWorkspaceState(s).ok).toBe(true);
    expect(s.schemaVersion).toBe(4);
  });

  it("has ~15-20 saved memories covering every built-in type", () => {
    expect(saved.length).toBeGreaterThanOrEqual(15);
    expect(saved.length).toBeLessThanOrEqual(20);
    expect(new Set(saved.map((m) => m.type))).toEqual(new Set(BUILT_IN_MEMORY_TYPES));
    expect(saved.filter((m) => m.status !== "pending").every((m) => m.status === "saved")).toBe(true);
    expect(Object.keys(s.collections)).toHaveLength(3);
  });

  it("ids are unique and every memory is labeled Demo", () => {
    const ids = Object.keys(s.memories);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(s.memories[id].provenance.origin).toBe("demo");
    }
    for (const m of all) {
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
    const isolated = saved.filter((m) => degree(m.id) === 0);
    expect(isolated.length).toBeGreaterThanOrEqual(2);
    expect(degree("mem_proj_mnemonis")).toBeGreaterThanOrEqual(6);
  });

  it("has a saved timeline and exactly two agent-origin pending items for the Inbox", () => {
    expect(timeline(s).length).toBeGreaterThanOrEqual(18);
    expect(timeline(s).every((r) => r.origin === "user" && r.note.length > 0)).toBe(true);
    const pending = pendingChanges(s);
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.kind).sort()).toEqual(["create", "update"]);
    for (const p of pending) {
      expect(p.origin).toBe("agent");
      expect(p.author).toBe("Demo Agent");
      expect(p.note.length).toBeGreaterThan(0);
    }
    expect(Object.values(s.revisions).filter((r) => r.status === "pending")).toHaveLength(2);
  });

  it("the pending edit leaves saved content alone; the pending create is hidden until approved", () => {
    expect(getMemory(s, "mem_dec_custom_graph")).toMatchObject({ hasPending: true, status: "pending" });
    expect(getMemory(s, "mem_dec_custom_graph")?.content).not.toContain("Barnes-Hut");
    expect(memoryHistory(s, "mem_dec_custom_graph")).toHaveLength(1);
    expect(saved.some((m) => m.id === "mem_research_ranking")).toBe(false);
    expect(all.find((m) => m.id === "mem_research_ranking")?.status).toBe("pending");
    expect(memoryHistory(s, "mem_proj_mnemonis")).toHaveLength(2); // created + status update
  });

  it("has one agent-origin pending link for the Inbox, hidden from the saved relation list", () => {
    const pending = listPendingRelations(s);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ author: "Demo Agent", ready: true });
    expect(pending[0].provenance.origin).toBe("process");
    expect(listRelations(s).some((r) => r.id === pending[0].relationId)).toBe(false);
    expect(listRelations(s)).toHaveLength(16);
    expect(Object.values(s.relations).filter((r) => r.status === "saved")).toHaveLength(16);
    expect(pendingCount(s)).toBe(3);
  });
});
