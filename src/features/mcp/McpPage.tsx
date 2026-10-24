import { Alert, Badge, Button, Card, CodeSnippet, Input, Switch } from "lojee-ui";
import { PageHeader } from "../../components/PageHeader";

export interface McpTool {
  name: string;
  description: string;
}

export const READ_TOOLS: McpTool[] = [
  { name: "memory_search", description: "Search memories by title, content and tags." },
  { name: "memory_read", description: "Read one memory with its metadata and relations." },
  { name: "memory_list", description: "List memories, filtered by type, collection, tag or status." },
  { name: "memory_related", description: "Find memories related to a given memory through stored relations." },
  { name: "memory_history", description: "Show the revision history of a memory." },
  { name: "memory_status", description: "Report the current branch, pending drafts and recent versions." },
];

export const WRITE_TOOLS: McpTool[] = [
  { name: "memory_save", description: "Create a new memory as a draft." },
  { name: "memory_update", description: "Edit a memory, producing a new draft revision." },
  { name: "memory_link", description: "Relate two memories, recording who or what created the link." },
  { name: "memory_archive", description: "Archive a memory (a reviewable draft, never a delete)." },
  { name: "memory_commit", description: "Save drafts as a version with a note (not a git commit; versions are stored by Mnemonis). Only with an explicit read/write grant." },
  { name: "memory_branch_create", description: "Create a branch from a version." },
  { name: "memory_diff", description: "Show the difference between drafts, versions or branches." },
];

export const CLAUDE_CODE_SNIPPET = `# Placeholder values. This will NOT work until the Mnemonis backend is deployed.
claude mcp add --transport http mnemonis <YOUR_MCP_URL>
# Authorization (future): send "Authorization: Bearer <YOUR_TOKEN>" from the token created in this page.`;

function endpoint(): string | null {
  const v = (import.meta.env.VITE_MCP_SERVER_URL as string | undefined)?.trim();
  return v ? v : null;
}

function ToolList({ title, tools }: { title: string; tools: McpTool[] }) {
  return (
    <Card variant="outline" padding="sm" title={title}>
      <ul aria-label={title} className="divide-y divide-border">
        {tools.map((t) => (
          <li key={t.name} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <code className="text-sm font-medium">{t.name}</code>
              <p className="text-xs text-fg-muted">{t.description}</p>
            </div>
            <Badge variant="soft" size="sm" color="amber">
              Planned
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function McpPage() {
  const url = endpoint();
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="MCP Connections"
        description="Let AI clients such as Claude Code read and propose memories over the Model Context Protocol."
      />

      <Alert variant="warning" title="Backend not built yet — local demo mode">
        There is no MCP server yet. Nothing on this page connects to anything; it previews what will be available once the backend
        ships.
      </Alert>

      <p className="text-sm text-fg-muted">
        Note: "memory_commit" saves a Mnemonis version of your drafts. It is not a git commit and does not touch any Git repository.
      </p>

      <Card variant="outline" padding="sm" title="Endpoint">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-fg-muted">Status</dt>
            <dd>
              <Badge variant="soft" size="sm" color="amber">
                Not connected
              </Badge>
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-fg-muted">Server URL (VITE_MCP_SERVER_URL)</dt>
            <dd>{url ? <code>{url}</code> : <span className="text-fg-muted">not configured</span>}</dd>
          </div>
        </dl>
      </Card>

      <section aria-label="Planned MCP tools" className="grid gap-3 lg:grid-cols-2">
        <ToolList title="Read tools" tools={READ_TOOLS} />
        <ToolList title="Write tools" tools={WRITE_TOOLS} />
      </section>

      <Card variant="outline" padding="sm" title="Access tokens (preview)">
        <div className="space-y-3">
          <Badge variant="soft" size="sm" color="amber">
            Available when the backend ships
          </Badge>
          <p className="text-sm text-fg-muted">
            This is a disabled preview. No token is generated or stored in this mode.
          </p>
          <div className="flex flex-wrap items-end gap-3 opacity-70">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Token name</span>
              <Input size="sm" disabled placeholder="e.g. Claude Code on laptop" />
            </div>
            <Switch label="Allow writes (read-only otherwise)" disabled />
            <Button size="sm" disabled>
              Create token
            </Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>
              <strong>Scopes:</strong> read-only tokens can search and read; read/write tokens can also create drafts and save versions.
            </li>
            <li>
              <strong>Shown once:</strong> the full token is displayed only when created.
            </li>
            <li>
              <strong>Hashed:</strong> the server will store only a hash, never the token itself.
            </li>
            <li>
              <strong>Revocable:</strong> you can revoke a token at any time.
            </li>
            <li>
              <strong>Expiring:</strong> tokens will have an expiry date.
            </li>
          </ul>
        </div>
      </Card>

      <Card variant="outline" padding="sm" title="Connect Claude Code">
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Replace <code>&lt;YOUR_MCP_URL&gt;</code> and <code>&lt;YOUR_TOKEN&gt;</code> with real values. They are placeholders: this
            will not work until the backend is deployed and a token can be created.
          </p>
          <CodeSnippet code={CLAUDE_CODE_SNIPPET} language="bash" title="Terminal" />
        </div>
      </Card>

      <Card variant="outline" padding="sm" title="Token usage transparency">
        <p className="text-sm text-fg-muted">
          Storing and retrieving memories through Mnemonis costs no LLM tokens. Any memory content that a client sends to a hosted
          model (for example the text Claude Code reads from a tool result) counts as input tokens for that model and is governed by
          that provider.
        </p>
      </Card>
    </div>
  );
}
