# Mnemonis — Frontend-first build (Phase 1 + UI of Phases 2/3/5)

## Context
Mnemonis is a cross-model "second brain" (memories, versioning, graph, MCP). The user wants the **frontend only** first, using **lojee-ui** as an addition to the recommended stack (React, Vite, TS, React Router, Zustand, Tailwind, custom graph). No Supabase, no MCP server, no real backend yet. Repo `/Users/lojeelim/Documents/mnemonis` is empty (not a git repo; Node 25.6, npm 11.9).

lojee-ui (0.1.0-alpha.17) facts: needs peers `react@19`, `react-dom@19`, `tailwindcss@^4.3.3`, `lucide-react@^1.47`, plus `maplibre-gl` (listed peer; only needed for Map components — verify if npm complains). Setup: `@import "tailwindcss"; @import "lojee-ui/theme.css";`, wrap in `ThemeProvider` (light/dark, accents). Provides AppLayout (`App/Top/Side/Main`), Sidebar, Table, Tabs, Modal/Drawer/Sheet, CommandMenu, SearchInput, TagInput, Select/MultiSelect, Badge, Stat, Timeline, ActivityFeed, EmptyState/Skeleton, Toast, LoginForm/SignupForm, AccountSettings, CodeSnippet. Alpha → pin exact version; read `dist/lib/index.d.ts` before using each component (don't guess props).

## Approach
**Stack:** Vite + React 19 + TS + React Router + Zustand + Tailwind v4 (`@tailwindcss/vite`) + lojee-ui + lucide-react. Vitest + Testing Library for frontend tests (Playwright deferred until a backend exists).

**Data layer (frontend-only, honest):** a `MemoryRepository` interface (`src/data/repository.ts`) with a single `LocalRepository` implementation (Zustand + localStorage persist). Pure versioning logic (a single timeline of per-memory revisions, diff, rollback, and the pending/approve/reject review flow) lives in `src/domain/` — framework-free so it can move to the shared backend/MCP service later. A persistent banner states "Local demo mode — not synced to Supabase". Seed data is labeled **Demo**. Auth is a local-mode stub behind an `AuthProvider` interface (Supabase swap later); no fake claims of persistence.

**Structure**
```
src/
  app/        router, providers (ThemeProvider), AppShell (collapsible Sidebar, CommandMenu ⌘K)
  domain/     types, memory ops, search (title/FTS-like/tags), versioning (approve/reject), diff, v1->v2 migration  (+ unit tests)
  data/       repository interface, LocalRepository, seed (labeled demo)
  stores/     zustand store (workspace state, selectors for pending changes and the timeline)
  features/   overview, memories, graph, collections, inbox, health, mcp, settings, auth
  components/ thin wrappers over lojee-ui, MarkdownView, StatusBadge (saved = Long term / pending = Waiting for review / archived)
docs/IMPLEMENTATION_PLAN.md   (short copy of this plan, per spec)
.env.example                   (names only; VITE_ vars for future Supabase/MCP URL)
```

**Screens (all 8 nav items)**
1. Overview — stats (memories, waiting for review, archived, saved changes), recent changes, recent activity, top topics, MCP status (derived from the signed-in user's tokens: Local only, Not set up, Waiting for client, Connected, Idle).
2. Memories — list + filters (type/collection/status), search, create/edit/archive in a detail Drawer/panel, Markdown, tags, relations, revision history with rollback. Your own edits auto-save to Long Term Memory with an automatic note; changes written by agents wait for review (Approve / Reject in the drawer or the Inbox).
3. Knowledge Graph — **custom** SVG/canvas force layout (own small simulation, no graph lib): zoom/pan, node select → detail panel, create/remove user-defined edges, filters, search, isolated-node highlighting. Edges come from stored relations, plus view-only title-prefix links (`<project>: ...` -> `<project>`, label "part of") that are derived at render time and never saved. Any memory with a `<project>: ` prefix and no memory titled `<project>` yields a project drawn as a virtual hub (dashed big circle, no memory required; legacy `<project> ...` titles join it once a `<project>: ...` memory exists). Its side panel offers to create the real memory, which then replaces the hub.
   Graph colours are per project: each project (hub, its `<project>: ...` memories and followers) gets a stable colour from the lojee-ui accent palettes (`data-accent`); memories without a project are neutral.
   - Topic links: memories of different projects (`<project>: ...` titles; no colon prefix = not eligible) that share a tag are linked automatically (`shares topic: <tag>`, process `topic-tag`, max 3 per other project and 12 per write; project tags and demo memories never count), reconciled when tags or title change.
4. Collections — CRUD + membership view.
5. Inbox — Inbox section (Short Term Memory: each pending change with diff, author, origin and note; Approve / Reject per item, Approve all / Reject all) and Timeline section (every saved change, newest first). `/branches` redirects here.
6. Memory Health (`/health`; `/agents` redirects) — rule-based Organize (duplicates, missing metadata) and Review (stale/contradiction heuristics) checks, Researcher/Sync as clearly labeled "planned"; applying a proposal sends it to the Inbox as a pending change, never auto-saved. "Agent" is reserved for real AI writers (MCP, later).
7. MCP Connections — token UI mock + Claude Code connection instructions, clearly marked "available when backend ships". Planned tools: memory_search/read/list/related/history/status/diff (read) and memory_save/update/link/archive (writes land in the Inbox). Approve/reject are user-only, so there are no such tools.
8. Settings — profile, theme/accent (lojee ThemeSwitcher), export JSON, clear local data.

**Design:** dark-first, calm neutral surfaces, restrained single accent, compact density, subtle transitions, keyboard accessible, empty/loading/error states via lojee EmptyState/Skeleton. Override lojee tokens only through its CSS variables.

## Build order (each step runnable)
1. Scaffold Vite + install deps, Tailwind + lojee theme, ThemeProvider, AppShell, routing, lint/tsc/vitest setup.
2. Domain + LocalRepository + seed, with unit tests (search, revisions, auto-save vs pending, approve/reject, diff, rollback, v1 migration).
3. Memories + Overview + Collections.
4. Inbox (pending review) and Timeline UI.
5. Knowledge graph.
6. Memory Health, MCP, Settings, auth stub.
7. Frontend tests for key flows (create → edit (auto-saved) → rollback; agent proposal → approve/reject in the Inbox; graph link create).

Execution follows the user's Haruto workflow: Ren (analysis) → Takumi (implement, one phase at a time) → Daiki (tests/tsc/lint/build) → Akira (review). No git commit/push.

## Deferred (explicitly not now)
Supabase schema/RLS/migrations, MCP server + tokens, Playwright e2e, deployment configs, real auth.

## Verification
- `npm run dev` launches; walk through: create memory → edit (auto-saved) → rollback; run a Memory Health check → apply a proposal → approve or reject it in the Inbox; link two memories and see edge in graph; search/filter; theme toggle; reload persists local data.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass (report actual output).
- Confirm no secrets in repo; `.env.example` placeholders only.

## Update: single timeline, auto-save, agent Inbox
Memory lines (branches), compare, merge/integrate and conflicts were removed. There is one timeline of per-memory revisions:
- The user's own writes are saved at once (Long Term Memory) with an automatic note; rollback appends a new saved revision.
- Writes by agents (Memory Health today, MCP later) are never saved directly: they become pending revisions (Short Term Memory) shown in the Inbox. Only the user can approve or reject them, one by one or all at once.
- Stored data is `mnemonis.workspace.v2`. A v1 workspace (`mnemonis.workspace.v1`) is migrated on first load and the v1 key is left untouched; imports accept v1 or v2. Unsaved v1 drafts and the content of other memory lines arrive as pending items in the Inbox.
- Memory Health "link" proposals still create relations immediately (additive, provenance `process`); making them pending is a later step.

## Projects: automatic filing rules and known limits

- Automatic filing (`autoFileOwnMemories`) only moves the USER'S OWN memories that sit in Unsorted and uniquely match a project by title. It never targets an unconfirmed agent project and never confirms one; only the explicit user action (`applyReassignments` / `fileUnsorted`) may use and then confirm such a project.
- The bulk pass runs only in `createProject` (the moment a new project name appears), only into the new project, at most 50 memories per call, only memories whose saved history is the single revision (a memory with edits is never rewritten), and it is skipped silently when the workspace is within about 10% of its size cap (`ctx.workspaceQuotaBytes`, default 5 MiB). It never makes `createProject` fail. `confirmProject` and `renameProject` file nothing; the matches stay suggestions.
- Creating or retitling ONE memory files that memory only (`only: [id]`).
- Limitation: an explicit "no project" (`projectId: null` on create or update) is respected when it is written, but it is not remembered: the snapshot schema has no field for it and adding one would change the contract. A never-edited memory created that way can therefore be filed by a later bulk pass when its title matches a newly created project. A memory with more than one saved revision is never bulk-filed, which covers memories the user has touched.
- Loading repairs project data instead of rejecting the workspace (`repairProjects`): project <-> folder link mismatches and dangling links lose the inconsistent pointer (both objects kept), duplicate keys keep the oldest project (a later one is renamed "<name> (n)"), and names, aliases and sources that break the Cf / NFC / length rules are cleaned or dropped. Memories, revisions and relations are never touched.
- The v2 -> v3 migration derives a project only from a prefix with at least 2 memories, and at most 100 (the busiest) of them, leaving room under the 200-project cap.
