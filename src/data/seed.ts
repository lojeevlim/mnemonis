import {
  addRelation,
  createCollection,
  createEmptyWorkspace,
  createMemory,
  createSequentialContext,
  updateMemory,
  type Actor,
  type MemoryType,
  type WorkspaceState,
} from "../domain";

export const DEMO_TAG = "Demo";
const AUTHOR = "Mnemonis Demo";
/** The demo user: every seed memory is saved (long term) as if the user wrote it. */
const DEMO_USER: Actor = { kind: "user", name: AUTHOR };
/** A demo AI agent: its two writes are left PENDING so the Inbox has something to review. */
const DEMO_AGENT: Actor = { kind: "agent", name: "Demo Agent" };
const DEMO_PROVENANCE = { origin: "demo", createdBy: AUTHOR } as const;

interface SeedMemory {
  id: string;
  title: string;
  type: MemoryType;
  collectionId: string;
  tags: string[];
  content: string;
}

const COL_PRODUCT = "col_product";
const COL_ENGINEERING = "col_engineering";
const COL_PERSONAL = "col_personal";

const FIRST_BATCH: SeedMemory[] = [
  { id: "mem_profile", title: "About me", type: "personal_context", collectionId: COL_PERSONAL, tags: ["profile"], content: "# About me\n\nFull-stack engineer building tools for thought. Works across **TypeScript**, Python and Postgres." },
  { id: "mem_pref_dark", title: "Prefers dark, calm interfaces", type: "preference", collectionId: COL_PERSONAL, tags: ["ui"], content: "Dark-first themes, restrained single accent colour, compact density." },
  { id: "mem_pref_writing", title: "Writing style preferences", type: "preference", collectionId: COL_PERSONAL, tags: ["writing"], content: "- Short sentences\n- Lead with the conclusion\n- Avoid jargon unless defined" },
  { id: "mem_proj_mnemonis", title: "Project: Mnemonis", type: "project", collectionId: COL_PRODUCT, tags: ["mnemonis", "roadmap"], content: "# Mnemonis\n\nA cross-model second brain: memories, versioning, a knowledge graph and an MCP server.\n\n## Status\nFrontend prototype in progress." },
  { id: "mem_dec_local_first", title: "Decision: local-first data layer for the prototype", type: "technical_decision", collectionId: COL_ENGINEERING, tags: ["architecture", "storage"], content: "The frontend ships with a `MemoryRepository` interface and a localStorage implementation.\n\nA backend can replace it without touching the domain logic." },
  { id: "mem_dec_zustand", title: "Decision: Zustand for client state", type: "technical_decision", collectionId: COL_ENGINEERING, tags: ["architecture", "frontend"], content: "Zustand keeps stores thin; all rules live in the pure domain layer." },
  { id: "mem_dec_custom_graph", title: "Decision: custom graph renderer", type: "technical_decision", collectionId: COL_ENGINEERING, tags: ["graph", "frontend"], content: "Draw the knowledge graph with a small in-house force simulation and SVG.\n\nNo graph library dependency." },
];

const SECOND_BATCH: SeedMemory[] = [
  { id: "mem_fact_mcp", title: "MCP lets agents call tools over a standard protocol", type: "fact", collectionId: COL_ENGINEERING, tags: ["mcp", "agents"], content: "Model Context Protocol servers expose tools and resources to clients such as Claude Code." },
  { id: "mem_fact_lojee", title: "lojee-ui is pinned to an exact alpha version", type: "fact", collectionId: COL_ENGINEERING, tags: ["frontend", "dependencies"], content: "Alpha releases may change props; read the type definitions before using a component." },
  { id: "mem_research_memory", title: "Research: agent memory systems", type: "research", collectionId: COL_PRODUCT, tags: ["research", "memory"], content: "## Findings\n\n1. Flat vector stores lose structure.\n2. Explicit relations improve recall.\n3. Human review prevents memory pollution." },
  { id: "mem_research_graph", title: "Research: force-directed layout basics", type: "research", collectionId: COL_ENGINEERING, tags: ["graph", "research"], content: "Repulsion between all nodes, spring attraction along edges, a weak centering force and velocity damping." },
  { id: "mem_proc_release", title: "Procedure: cut a release", type: "procedure", collectionId: COL_ENGINEERING, tags: ["process"], content: "1. Run typecheck, lint, tests\n2. Build\n3. Tag the release\n4. Write release notes" },
  { id: "mem_proc_review", title: "Procedure: review a proposed memory change", type: "procedure", collectionId: COL_PRODUCT, tags: ["process", "review"], content: "Open the diff in the Inbox, check who proposed it, then approve or reject." },
  { id: "mem_meeting_kickoff", title: "Meeting: Mnemonis kickoff", type: "meeting_note", collectionId: COL_PRODUCT, tags: ["meeting"], content: "**Attendees:** product, engineering\n\n- Frontend first, backend later\n- Changes proposed by agents are never auto-saved; they wait in the Inbox" },
  { id: "mem_meeting_design", title: "Meeting: design review", type: "meeting_note", collectionId: COL_PRODUCT, tags: ["meeting", "design"], content: "Agreed on dark-first theme and a compact table layout for memories." },
  { id: "mem_task_seed", title: "Task: write demo seed data", type: "task", collectionId: COL_PRODUCT, tags: ["todo"], content: "- [ ] Realistic memories\n- [ ] Relations incl. isolated nodes\n- [ ] Agent proposals waiting in the Inbox" },
  { id: "mem_task_mcp", title: "Task: design MCP tool surface", type: "task", collectionId: COL_PRODUCT, tags: ["todo", "mcp"], content: "Search, read, propose a change. Agents must never save directly: the user approves." },
  { id: "mem_ref_textile", title: "Reference: Textile syntax cheatsheet", type: "reference", collectionId: COL_ENGINEERING, tags: ["docs"], content: "`h1.` heading, `*bold*`, `_italic_`, `bc.` code block." },
];

const RELATIONS: [string, string, string][] = [
  ["mem_proj_mnemonis", "mem_dec_local_first", "decided"],
  ["mem_proj_mnemonis", "mem_dec_zustand", "decided"],
  ["mem_proj_mnemonis", "mem_dec_custom_graph", "decided"],
  ["mem_proj_mnemonis", "mem_task_seed", "has task"],
  ["mem_proj_mnemonis", "mem_task_mcp", "has task"],
  ["mem_proj_mnemonis", "mem_meeting_kickoff", "discussed in"],
  ["mem_meeting_kickoff", "mem_meeting_design", "followed by"],
  ["mem_dec_custom_graph", "mem_research_graph", "based on"],
  ["mem_task_mcp", "mem_fact_mcp", "relies on"],
  ["mem_proj_mnemonis", "mem_research_memory", "informed by"],
  ["mem_proc_review", "mem_research_memory", "derived from"],
  ["mem_meeting_design", "mem_pref_dark", "reflects"],
  ["mem_dec_zustand", "mem_fact_lojee", "related"],
  ["mem_proc_release", "mem_proc_review", "related"],
  ["mem_task_seed", "mem_dec_local_first", "implements"],
  ["mem_ref_textile", "mem_proc_release", "used by"],
];

/**
 * Builds the demo workspace through the real domain operations (so revisions are authentic) using
 * a fixed clock and sequential ids: fully deterministic. User writes are saved; two agent writes and
 * one agent link stay pending (Inbox demo content).
 * Isolated memories: mem_profile, mem_pref_writing.
 */
export function createSeedWorkspace(): WorkspaceState {
  const ctx = createSequentialContext("2026-09-01T09:00:00.000Z", 3_600_000);
  let s = createEmptyWorkspace();

  for (const [id, name, description] of [
    [COL_PRODUCT, "Mnemonis Product", "Product direction, meetings and tasks"],
    [COL_ENGINEERING, "Engineering", "Decisions, facts and procedures"],
    [COL_PERSONAL, "Personal", "Profile and preferences"],
  ]) {
    s = createCollection(s, ctx, { id, name, description }).state;
  }

  const add = (m: SeedMemory, actor: Actor = DEMO_USER) => {
    s = createMemory(s, ctx, {
      id: m.id,
      title: m.title,
      content: m.content,
      type: m.type,
      collectionId: m.collectionId,
      tags: [...m.tags, DEMO_TAG],
      source: "demo-seed",
      provenance: { ...DEMO_PROVENANCE },
      metadata: { demo: true },
      actor,
    }).state;
  };

  FIRST_BATCH.forEach((m) => add(m));
  SECOND_BATCH.forEach((m) => add(m));
  s = updateMemory(s, ctx, {
    id: "mem_proj_mnemonis",
    patch: { content: "# Mnemonis\n\nA cross-model second brain: memories, versioning, a knowledge graph and an MCP server.\n\n## Status\nFrontend prototype built; backend and MCP server are next." },
    actor: DEMO_USER,
  }).state;
  s = updateMemory(s, ctx, {
    id: "mem_task_seed",
    patch: { content: "- [x] Realistic memories\n- [x] Relations incl. isolated nodes\n- [x] Agent proposals waiting in the Inbox" },
    actor: DEMO_USER,
  }).state;

  for (const [fromId, toId, label] of RELATIONS) {
    s = addRelation(s, ctx, {
      fromId,
      toId,
      label,
      provenance: { origin: "user", createdBy: AUTHOR, demo: true },
      actor: DEMO_USER,
    }).state;
  }

  // Agent proposals, left pending for the Inbox: an edit to a saved memory and a brand new memory.
  s = updateMemory(s, ctx, {
    id: "mem_dec_custom_graph",
    patch: { content: "Draw the knowledge graph with a small in-house force simulation and SVG.\n\nNo graph library dependency.\n\nUpdate: add Barnes-Hut approximation if node count exceeds 500." },
    actor: DEMO_AGENT,
  }).state;
  // ...and a link proposed by the agent (pending until approved; hidden from the graph meanwhile).
  s = addRelation(s, ctx, {
    fromId: "mem_fact_mcp",
    toId: "mem_proj_mnemonis",
    label: "supports",
    provenance: { origin: "process", createdBy: DEMO_AGENT.name, process: DEMO_AGENT.name, demo: true },
    actor: DEMO_AGENT,
  }).state;
  add(
    {
      id: "mem_research_ranking",
      title: "Research: search ranking signals",
      type: "research",
      collectionId: COL_PRODUCT,
      tags: ["research", "search"],
      content: "Exact id and title matches should outrank body matches; recency breaks ties.",
    },
    DEMO_AGENT,
  );
  return s;
}
