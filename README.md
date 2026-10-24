# Mnemonis

Your mind, independent of the model. A cross-model "second brain" (memories, versioning, graph, MCP).

Status: frontend only. Runs in **local demo mode** - data stays in this browser and is not synced. No backend, Supabase or MCP server yet. See `docs/IMPLEMENTATION_PLAN.md`.

## Stack
Vite, React 19, TypeScript, React Router, Zustand, Tailwind v4, [lojee-ui](https://www.npmjs.com/package/lojee-ui) (pinned alpha), lucide-react.

## Local development
```bash
npm install
cp .env.example .env.local   # optional; placeholders only
npm run dev                  # http://localhost:5173
```

Scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Press Cmd/Ctrl+K to open the command menu.

## How memory works
- **Long Term Memory** is saved memory. Your own edits save automatically, with an automatic note, and every memory keeps a revision history you can roll back from.
- **Short Term Memory** is anything waiting for review in the **Inbox** (`/inbox`). Changes made by agents, such as Memory Health proposals you apply (and, later, AI clients over MCP), never save on their own: you Approve or Reject them one by one, or Approve all. The Inbox page also has a Timeline of every saved change.
- **Memory Health** (`/health`) runs rule-based checks (Organize, Review) in your browser; no AI model is involved.
- Everything is stored only in this browser (`localStorage`); nothing is sent to Git or any server. Data from older versions (`mnemonis.workspace.v1`) is migrated automatically and the old copy is left in place.
