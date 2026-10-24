# Mnemonis

Your mind, independent of the model. A cross-model "second brain" (memories, versioning, graph, MCP).

Status: runs in **local demo mode** by default (data stays in this browser and is not synced). Sign in to an account on the Mnemonis API (Settings) to keep your workspace on the server and to let AI clients such as Claude Code reach it over MCP. See `docs/IMPLEMENTATION_PLAN.md`.

## Three projects, three ports
| Project | Role | Port |
| --- | --- | --- |
| **`mnemonis` (this repo)** | the web app: sign in, review the Inbox, create MCP tokens | 5173 (Vite dev) |
| `mnemonis_api` | accounts, sessions, MCP tokens, Postgres, REST `/api/*`, internal `/api/agent/*` | 8787 |
| `mnemonis_mcp` | the thin MCP adapter (`POST /mcp`) that Claude Code connects to | 8788 |

```
Browser -- mnemonis (:5173) --ms_ session--> mnemonis_api (:8787) --> PostgreSQL
Claude Code / MCP client --POST /mcp, Bearer mn_--> mnemonis_mcp (:8788) --> mnemonis_api /api/agent/*
```

The web app talks **only to the API**. It does not know the MCP adapter's address: the **MCP Connections** page reads `mcpUrl` from the API's `GET /api/auth/config` (set `MNEMONIS_MCP_URL` on the API, default `http://localhost:8788/mcp`) and shows the command to run, with your new token:

```bash
claude mcp add --transport http mnemonis http://localhost:8788/mcp --header "Authorization: Bearer mn_..."
```

If the API publishes no MCP URL (or one that is not `https`, or `http` on localhost), the page shows a `<mcp-url>` placeholder and a note instead of guessing. Run all three locally: start `mnemonis_api` (`npm run dev`, with its PostgreSQL), then `mnemonis_mcp` (`npm run dev`), then this app (`npm run dev`); see the README of each.

## Stack
Vite, React 19, TypeScript, React Router, Zustand, Tailwind v4, [lojee-ui](https://www.npmjs.com/package/lojee-ui) (pinned alpha), lucide-react.

## Local development
```bash
npm install
cp .env.example .env.local   # optional; VITE_API_URL defaults to http://localhost:8787
npm run dev                  # http://localhost:5173
```

`VITE_API_URL` is the Mnemonis API (default `http://localhost:8787`); `VITE_MCP_SERVER_URL` is still read as a deprecated alias for one release. A server URL saved in Settings wins over both.

Scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Press Cmd/Ctrl+K to open the command menu.

## How memory works
- **Long Term Memory** is saved memory. Your own edits save automatically, with an automatic note, and every memory keeps a revision history you can roll back from.
- **Short Term Memory** is anything waiting for review in the **Inbox** (`/inbox`). Changes made by agents, such as Memory Health proposals you apply (and, later, AI clients over MCP), never save on their own: you Approve or Reject them one by one, or Approve all. The Inbox page also has a Timeline of every saved change.
- **Memory Health** (`/health`) runs rule-based checks (Organize, Review) in your browser; no AI model is involved.
- Everything is stored only in this browser (`localStorage`); nothing is sent to Git or any server. Data from older versions (`mnemonis.workspace.v1`) is migrated automatically and the old copy is left in place.
