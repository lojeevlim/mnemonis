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
  { name: "memory_status", description: "Report the pending count (changes waiting for review) and recent saved changes." },
  { name: "memory_diff", description: "Show the difference between a pending proposal and the saved memory, or between two revisions." },
];

/** Every write lands in the Inbox (short-term memory); only the user can approve or reject it. */
export const WRITE_TOOLS: McpTool[] = [
  { name: "memory_save", description: "Propose a new memory. It waits in your Inbox until you approve it." },
  { name: "memory_update", description: "Propose an edit to a memory. It waits in your Inbox until you approve it." },
  { name: "memory_link", description: "Propose a link between two memories, recording who or what created it. It waits in your Inbox until you approve it." },
  { name: "memory_archive", description: "Propose archiving a memory (reviewable in your Inbox, never a delete)." },
];

export const MCP_URL = "http://localhost:8787/mcp";

/** The token comes from `npm run token` in the server project; never paste it into a chat. */
export const CLAUDE_CODE_SNIPPET = `claude mcp add --transport http mnemonis ${MCP_URL} --header "Authorization: Bearer <token>"`;

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

      <Alert variant="warning" title="Backend pending — connect it in Settings">
        This page does not connect to anything by itself. Run the Mnemonis server, then connect this app to it in Settings
        (Mnemonis server). Until then the app stays in local demo mode and the tool list below is a preview.
      </Alert>

      <p className="text-sm text-fg-muted">
        Note: tools never save on their own. Anything an AI client writes waits in your Inbox as short-term memory; approving or rejecting it is something only you can do in this app, so there are no approve or reject tools.
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
              <strong>Scopes:</strong> read-only tokens can search and read; read/write tokens can also propose changes, which wait in your Inbox until you approve them (a token can never approve its own changes).
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
            Start the server project, then run this in a terminal. Replace <code>&lt;token&gt;</code> with the output of{" "}
            <code>npm run token</code> in the server project. Keep the token private: do not paste it into a chat or commit it.
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
