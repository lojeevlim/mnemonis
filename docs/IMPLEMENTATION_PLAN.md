# Mnemonis — Frontend-first build (Phase 1 + UI of Phases 2/3/5)

## Context
Mnemonis is a cross-model "second brain" (memories, versioning, graph, MCP). The user wants the **frontend only** first, using **lojee-ui** as an addition to the recommended stack (React, Vite, TS, React Router, Zustand, Tailwind, custom graph). No Supabase, no MCP server, no real backend yet. Repo `/Users/lojeelim/Documents/mnemonis` is empty (not a git repo; Node 25.6, npm 11.9).

lojee-ui (0.1.0-alpha.17) facts: needs peers `react@19`, `react-dom@19`, `tailwindcss@^4.3.3`, `lucide-react@^1.47`, plus `maplibre-gl` (listed peer; only needed for Map components — verify if npm complains). Setup: `@import "tailwindcss"; @import "lojee-ui/theme.css";`, wrap in `ThemeProvider` (light/dark, accents). Provides AppLayout (`App/Top/Side/Main`), Sidebar, Table, Tabs, Modal/Drawer/Sheet, CommandMenu, SearchInput, TagInput, Select/MultiSelect, Badge, Stat, Timeline, ActivityFeed, EmptyState/Skeleton, Toast, LoginForm/SignupForm, AccountSettings, CodeSnippet. Alpha → pin exact version; read `dist/lib/index.d.ts` before using each component (don't guess props).

## Approach
**Stack:** Vite + React 19 + TS + React Router + Zustand + Tailwind v4 (`@tailwindcss/vite`) + lojee-ui + lucide-react. Vitest + Testing Library for frontend tests (Playwright deferred until a backend exists).

**Data layer (frontend-only, honest):** a `MemoryRepository` interface (`src/data/repository.ts`) with a single `LocalRepository` implementation (Zustand + localStorage persist). Pure versioning logic (revisions, commits, branches, diff, rollback, merge/conflict) lives in `src/domain/` — framework-free so it can move to the shared backend/MCP service later. A persistent banner states "Local demo mode — not synced to Supabase". Seed data is labeled **Demo**. Auth is a local-mode stub behind an `AuthProvider` interface (Supabase swap later); no fake claims of persistence.

**Structure**
```
src/
  app/        router, providers (ThemeProvider), AppShell (collapsible Sidebar, CommandMenu ⌘K)
  domain/     types, memory ops, search (title/FTS-like/tags), versioning, diff, merge  (+ unit tests)
  data/       repository interface, LocalRepository, seed (labeled demo)
  stores/     zustand slices (memories, branches/commits, ui)
  features/   overview, memories, graph, collections, branches, agents, mcp, settings, auth
  components/ thin wrappers over lojee-ui, MarkdownView, StatusBadge (draft/committed/archived/conflict)
docs/IMPLEMENTATION_PLAN.md   (short copy of this plan, per spec)
.env.example                   (names only; VITE_ vars for future Supabase/MCP URL)
```

**Screens (all 8 nav items)**
1. Overview — stats, recent changes, drafts, commits, branches, top topics, MCP status (shown as "Not connected — backend pending").
2. Memories — list + filters (type/collection/branch/status), search, create/edit/archive in a detail Drawer/panel, Markdown, tags, relations, revision history, draft→save-version approval.
3. Knowledge Graph — **custom** SVG/canvas force layout (own small simulation, no graph lib): zoom/pan, node select → detail panel, create/remove user-defined edges, filters, search, isolated-node highlighting. Edges only from stored relations.
4. Collections — CRUD + membership view.
5. Branches & Versions — create branch from version, switch, review unsaved changes, diff view, save version with a note, history, merge with conflict resolution UI, rollback (new revision).
6. Agents — Librarian (duplicates, missing metadata), Reviewer (stale/contradiction heuristics), Researcher/Sync as clearly labeled "planned"; deterministic runs emit reviewable proposed changes, never auto-commit.
7. MCP Connections — token UI mock + Claude Code connection instructions, clearly marked "available when backend ships".
8. Settings — profile, theme/accent (lojee ThemeSwitcher), export JSON, clear local data.

**Design:** dark-first, calm neutral surfaces, restrained single accent, compact density, subtle transitions, keyboard accessible, empty/loading/error states via lojee EmptyState/Skeleton. Override lojee tokens only through its CSS variables.

## Build order (each step runnable)
1. Scaffold Vite + install deps, Tailwind + lojee theme, ThemeProvider, AppShell, routing, lint/tsc/vitest setup.
2. Domain + LocalRepository + seed, with unit tests (search, revisions, commit, branch, diff, rollback, merge conflict).
3. Memories + Overview + Collections.
4. Branches/Commits UI.
5. Knowledge graph.
6. Agents, MCP, Settings, auth stub.
7. Frontend tests for key flows (create → edit → save version → rollback; graph link create).

Execution follows the user's Haruto workflow: Ren (analysis) → Takumi (implement, one phase at a time) → Daiki (tests/tsc/lint/build) → Akira (review). No git commit/push.

## Deferred (explicitly not now)
Supabase schema/RLS/migrations, MCP server + tokens, Playwright e2e, deployment configs, real auth.

## Verification
- `npm run dev` launches; walk through: create memory → edit → save version with a note → branch → conflicting edit → merge/resolve → rollback; link two memories and see edge in graph; search/filter; theme toggle; reload persists local data.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass (report actual output).
- Confirm no secrets in repo; `.env.example` placeholders only.
