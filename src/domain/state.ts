import { MEMORY_FIELDS, type MemoryFieldName, type WorkspaceState } from "./types";
import { isJsonValue, isPlainObject, isReservedKey } from "./util";

export const SCHEMA_VERSION = 1;
export const MAIN_BRANCH_ID = "main";

export function createEmptyWorkspace(): WorkspaceState {
  return {
    schemaVersion: SCHEMA_VERSION,
    currentBranchId: MAIN_BRANCH_ID,
    memories: {},
    revisions: {},
    commits: {},
    branches: { [MAIN_BRANCH_ID]: { id: MAIN_BRANCH_ID, name: "main", headCommitId: null, baseCommitId: null } },
    relations: {},
    collections: {},
    pendingMerge: null,
  };
}

export type ValidationResult =
  | { ok: true; state: WorkspaceState }
  | { ok: false; reason: "corrupt" | "version-mismatch" };

/** Upper bound for imported / stored workspace JSON (characters). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type Rec = Record<string, unknown>;
const CORRUPT: ValidationResult = { ok: false, reason: "corrupt" };

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Own entries of a map whose keys are safe and equal to each value's `id`. */
function entriesOf(map: unknown): [string, Rec][] | null {
  if (!isPlainObject(map)) return null;
  const out: [string, Rec][] = [];
  for (const key of Object.keys(map)) {
    const v = map[key];
    if (isReservedKey(key) || !isPlainObject(v) || v.id !== key) return null;
    out.push([key, v]);
  }
  return out;
}

const has = (map: Rec, key: unknown): boolean => isStr(key) && !isReservedKey(key) && Object.hasOwn(map, key);

function validSnapshot(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isStr(v.title) &&
    isStr(v.content) &&
    isStr(v.type) &&
    isStrArray(v.tags) &&
    isStrOrNull(v.collectionId) &&
    typeof v.archived === "boolean" &&
    isPlainObject(v.metadata) &&
    isJsonValue(v.metadata)
  );
}

function validFieldValue(field: MemoryFieldName, v: unknown): boolean {
  switch (field) {
    case "title":
    case "content":
    case "type":
      return isStr(v);
    case "tags":
      return isStrArray(v);
    case "collectionId":
      return isStrOrNull(v);
    case "archived":
      return typeof v === "boolean";
    case "metadata":
      return isPlainObject(v) && isJsonValue(v);
  }
}

/** True when following `next` from any node revisits a node (cycle). Iterative, safe on bad data. */
function hasCycle(ids: string[], next: (id: string) => string[]): boolean {
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  for (const root of ids) {
    if (state.has(root)) continue;
    const stack: { id: string; rest: string[] }[] = [{ id: root, rest: [...next(root)] }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const child = top.rest.pop();
      if (child === undefined) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const st = state.get(child);
      if (st === 1) return true;
      if (st === 2) continue;
      state.set(child, 1);
      stack.push({ id: child, rest: [...next(child)] });
    }
  }
  return false;
}

const CHANGE_KINDS = ["create", "update", "archive", "restore"];
const CHOICES = ["ours", "theirs", "manual"];

function validate(raw: Rec): boolean {
  const memories = entriesOf(raw.memories);
  const revisions = entriesOf(raw.revisions);
  const commits = entriesOf(raw.commits);
  const branches = entriesOf(raw.branches);
  const relations = entriesOf(raw.relations);
  const collections = entriesOf(raw.collections);
  if (!memories || !revisions || !commits || !branches || !relations || !collections) return false;
  const memMap = raw.memories as Rec;
  const revMap = raw.revisions as Rec;
  const comMap = raw.commits as Rec;
  const braMap = raw.branches as Rec;
  if (!isStr(raw.currentBranchId) || !has(braMap, raw.currentBranchId)) return false;

  for (const [, m] of memories) {
    const p = m.provenance;
    if (!isStr(m.createdAt) || !isStr(m.source)) return false;
    if (!isPlainObject(p) || !isStr(p.origin) || !isStr(p.createdBy)) return false;
  }
  for (const [, c] of collections) {
    if (!isStr(c.name) || !isStr(c.description) || !isStr(c.createdAt)) return false;
  }
  for (const [, r] of relations) {
    const p = r.provenance;
    if (!has(memMap, r.fromId) || !has(memMap, r.toId) || !isStr(r.label) || !isStr(r.createdAt)) return false;
    if (!isPlainObject(p) || (p.origin !== "user" && p.origin !== "process") || !isStr(p.createdBy)) return false;
    if (p.process !== undefined && !isStr(p.process)) return false;
    if (p.demo !== undefined && typeof p.demo !== "boolean") return false;
  }
  for (const [, c] of commits) {
    if (!has(braMap, c.branchId) || !isStr(c.message) || !isStr(c.author) || !isStr(c.timestamp)) return false;
    if (!isStrArray(c.parentIds) || !c.parentIds.every((p) => has(comMap, p))) return false;
    if (!Array.isArray(c.changes)) return false;
    for (const ch of c.changes as unknown[]) {
      if (!isPlainObject(ch) || !has(memMap, ch.memoryId) || !has(revMap, ch.revisionId)) return false;
      if (!isStr(ch.kind) || !CHANGE_KINDS.includes(ch.kind)) return false;
      if ((revMap[ch.revisionId as string] as Rec).memoryId !== ch.memoryId) return false;
    }
  }
  if (hasCycle(commits.map(([id]) => id), (id) => (comMap[id] as Rec).parentIds as string[])) return false;
  for (const [, b] of branches) {
    if (!isStr(b.name)) return false;
    for (const ref of [b.headCommitId, b.baseCommitId]) {
      if (ref !== null && !has(comMap, ref)) return false;
    }
  }
  for (const [, r] of revisions) {
    if (!has(memMap, r.memoryId) || !has(braMap, r.branchId) || !validSnapshot(r.snapshot)) return false;
    if (!isStr(r.createdAt) || !isStr(r.author)) return false;
    if (r.parentRevisionId !== null && !has(revMap, r.parentRevisionId)) return false;
    if (r.parentRevisionId !== null && (revMap[r.parentRevisionId as string] as Rec).memoryId !== r.memoryId) return false;
    if (r.commitId !== null && !has(comMap, r.commitId)) return false;
  }
  const parentOf = (id: string) => {
    const p = (revMap[id] as Rec).parentRevisionId;
    return isStr(p) ? [p] : [];
  };
  if (hasCycle(revisions.map(([id]) => id), parentOf)) return false;

  const pm = raw.pendingMerge;
  if (pm !== null) {
    if (!isPlainObject(pm)) return false;
    if (!has(braMap, pm.sourceBranchId) || !has(braMap, pm.targetBranchId)) return false;
    if (pm.baseCommitId !== null && !has(comMap, pm.baseCommitId)) return false;
    if (!isStr(pm.message) || !isStr(pm.author) || !isPlainObject(pm.merged) || !Array.isArray(pm.conflicts)) return false;
    for (const key of Object.keys(pm.merged)) {
      if (isReservedKey(key) || !has(memMap, key) || !validSnapshot(pm.merged[key])) return false;
    }
    for (const c of pm.conflicts as unknown[]) {
      if (!isPlainObject(c) || !isStr(c.id) || isReservedKey(c.id) || !isStr(c.memoryId)) return false;
      if (!Object.hasOwn(pm.merged, c.memoryId)) return false;
      if (!isStr(c.field) || !(MEMORY_FIELDS as readonly string[]).includes(c.field)) return false;
      const field = c.field as MemoryFieldName;
      if (!validFieldValue(field, c.ours) || !validFieldValue(field, c.theirs)) return false;
      if (c.base !== undefined && !validFieldValue(field, c.base)) return false;
      const res = c.resolution;
      if (res !== null) {
        if (!isPlainObject(res) || !isStr(res.choice) || !CHOICES.includes(res.choice) || !validFieldValue(field, res.value)) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Deep structural + referential validation of untrusted (localStorage / imported) data:
 * field types, id === map key, reserved keys, dangling references and cycles in
 * commit parents / revision parents. Historic revisions may legitimately reference a
 * collection that was later deleted, so snapshot.collectionId is type-checked only.
 */
export function validateWorkspaceState(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return CORRUPT;
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: typeof raw.schemaVersion === "number" ? "version-mismatch" : "corrupt" };
  }
  try {
    if (!validate(raw)) return CORRUPT;
  } catch {
    return CORRUPT;
  }
  return { ok: true, state: raw as unknown as WorkspaceState };
}
