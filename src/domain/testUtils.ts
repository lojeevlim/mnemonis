import { createSequentialContext } from "./context";
import { createMemory } from "./memoryOps";
import { createEmptyWorkspace } from "./state";
import { commitDrafts } from "./versioning";
import type { Memory, WorkspaceState } from "./types";

export const A = "tester";

export function setup() {
  return { ctx: createSequentialContext(), state: createEmptyWorkspace() };
}

/** Creates a memory and commits it on the current branch. */
export function seedCommitted(
  state: WorkspaceState,
  ctx = createSequentialContext(),
  input: { id?: string; title?: string; content?: string } = {},
): { state: WorkspaceState; memory: Memory; ctx: ReturnType<typeof createSequentialContext> } {
  const created = createMemory(state, ctx, { title: input.title ?? "Base", content: input.content ?? "line1\nline2\nline3", id: input.id, author: A });
  const committed = commitDrafts(created.state, ctx, { message: "init", author: A });
  return { state: committed.state, memory: created.value, ctx };
}
