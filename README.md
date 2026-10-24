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

Versions (Save version on Memories and Branches & Versions) are saved only in this browser; they are not sent to Git or any server.
