import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Alert, AlertDialog, Badge, Button, Card, CodeSnippet, Input } from "lojee-ui";
import { InlineError } from "../../components/InlineError";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";
import { ApiError, describeApiError } from "../../data/accountApi";
import { formatDateTime } from "../../components/memoryMeta";
import { useAuth } from "../auth/AuthContext";
import { serverAuthProvider } from "../auth/serverAuthProvider";
import { createToken, listTokens, revokeToken, tokenStatus, type CreatedToken, type McpToken } from "./tokensApi";

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

/** Shown in the command until the API publishes the MCP adapter's URL (GET /api/auth/config). */
export const MCP_URL_PLACEHOLDER = "<mcp-url>";

/** POSIX shell single-quoting: the value is always one literal word (embedded single quotes become '\'' ). */
export const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The command a user runs once. `token` is a placeholder until a token has just been created. The URL (server supplied)
 * and the header are single-quoted so neither can break out into the shell; the `<mcp-url>` placeholder stays bare.
 */
export function claudeCodeCommand(mcpUrl: string | null, token = "<token>"): string {
  return `claude mcp add --transport http mnemonis ${mcpUrl === null ? MCP_URL_PLACEHOLDER : shellQuote(mcpUrl)} --header ${shellQuote(`Authorization: Bearer ${token}`)}`;
}

function ToolList({ title, tools, badge }: { title: string; tools: McpTool[]; badge: string }) {
  return (
    <Card variant="outline" padding="sm" title={title}>
      <ul aria-label={title} className="divide-y divide-border">
        {tools.map((t) => (
          <li key={t.name} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <code className="text-sm font-medium">{t.name}</code>
              <p className="text-xs text-fg-muted">{t.description}</p>
            </div>
            <Badge variant="soft" size="sm" color="slate">
              {badge}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STATUS_COLOR = { Active: "emerald", Revoked: "rose", Expired: "amber" } as const;
const when = (iso: string | null) => (iso ? formatDateTime(iso) : "Never");

function TokensCard({ mcpUrl }: { mcpUrl: string | null }) {
  const toast = useToast();
  const uid = useId();
  const [tokens, setTokens] = useState<McpToken[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The full secret lives in component state only, for as long as this card is open.
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [revoking, setRevoking] = useState<McpToken | null>(null);

  const reload = useCallback(async () => {
    try {
      setTokens(await listTokens());
    } catch (e) {
      setError(describeApiError(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTokens().then(
      (t) => !cancelled && setTokens(t),
      (e) => !cancelled && setError(describeApiError(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    if (!name) return setError("Give the token a name, for example Claude Code on laptop.");
    if (name.length > 80) return setError("The name can be at most 80 characters.");
    setBusy(true);
    setError(null);
    try {
      setCreated(await createToken(name));
      setLabel("");
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "token_limit_reached"
          ? "You have reached the limit of active tokens. Revoke one first."
          : describeApiError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (t: McpToken) => {
    try {
      await revokeToken(t.id);
      if (created?.id === t.id) setCreated(null);
      toast(`Token "${t.label}" revoked`, "success");
      await reload();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  const command = claudeCodeCommand(mcpUrl, created?.token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast("Command copied", "success");
    } catch {
      toast("Could not copy. Select the command and copy it manually.", "error");
    }
  };

  return (
    <>
      <Card variant="outline" padding="sm" title="Access tokens">
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Each token belongs to your account and reaches only your memories. The server stores a hash, so the full token is
            shown only once, when you create it. Revoke a token at any time.
          </p>
          <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-label`} className="text-xs font-medium text-fg-muted">
                Token name
              </label>
              <Input
                id={`${uid}-label`}
                size="sm"
                value={label}
                maxLength={80}
                placeholder="e.g. Claude Code on laptop"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              Create token
            </Button>
          </form>
          <InlineError message={error} />

          {tokens === null ? (
            <p className="text-sm text-fg-muted">Loading tokens...</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-fg-muted">No tokens yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Your MCP access tokens</caption>
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Name</th>
                    <th className="py-1 pr-3 font-medium">Prefix</th>
                    <th className="py-1 pr-3 font-medium">Created</th>
                    <th className="py-1 pr-3 font-medium">Last used</th>
                    <th className="py-1 pr-3 font-medium">Expires</th>
                    <th className="py-1 pr-3 font-medium">Status</th>
                    <th className="py-1 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tokens.map((t) => {
                    const status = tokenStatus(t);
                    return (
                      <tr key={t.id}>
                        <td className="py-2 pr-3">{t.label}</td>
                        <td className="py-2 pr-3">
                          <code>{t.prefix}</code>
                        </td>
                        <td className="py-2 pr-3">{when(t.createdAt)}</td>
                        <td className="py-2 pr-3">{when(t.lastUsedAt)}</td>
                        <td className="py-2 pr-3">{when(t.expiresAt)}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="soft" size="sm" color={STATUS_COLOR[status]}>
                            {status}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">
                          {status === "Active" && (
                            <Button size="sm" variant="outline" onClick={() => setRevoking(t)}>
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card variant="outline" padding="sm" title="Connect Claude Code">
        <div className="space-y-3">
          {created ? (
            <Alert variant="warning" title="Copy your command now: it is shown once">
              This command contains your new token <strong>{created.label}</strong>. It will not be shown again; if you lose it,
              revoke the token and create another. Keep it private: do not paste it into a chat or commit it.
            </Alert>
          ) : (
            <p className="text-sm text-fg-muted">
              Create a token above and the full command appears here, ready to run in a terminal. Until then this is a placeholder.
            </p>
          )}
          <CodeSnippet code={command} language="bash" title="Terminal" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!created} onClick={() => void copy()}>
              Copy command
            </Button>
            {created && (
              <Button size="sm" variant="outline" onClick={() => setCreated(null)}>
                Done, hide the token
              </Button>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        variant="destructive"
        title={revoking ? `Revoke "${revoking.label}"?` : "Revoke token?"}
        description="Any AI client using this token stops working immediately. This cannot be undone."
        confirmLabel="Revoke token"
        onConfirm={() => {
          const t = revoking;
          setRevoking(null);
          if (t) void doRevoke(t);
        }}
      />
    </>
  );
}

export function McpPage() {
  const { mode } = useAuth();
  // The MCP adapter is a separate server: its URL is whatever the API publishes in GET /api/auth/config (never derived from the API URL).
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    if (mode !== "server") return;
    let cancelled = false;
    void serverAuthProvider.config().then((c) => {
      if (cancelled) return;
      setMcpUrl(c.mcpUrl ?? null);
      setConfigLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title="MCP Connections"
        description="Let AI clients such as Claude Code read and propose memories over the Model Context Protocol."
      />

      {mode !== "server" && (
        <Alert variant="info" title="Sign in to connect AI clients">
          You are using Mnemonis without an account, so your data stays in this browser and no AI client can reach it. Sign in or
          register (Settings) to create access tokens.
        </Alert>
      )}

      <p className="text-sm text-fg-muted">
        Note: tools never save on their own. Anything an AI client writes waits in your Inbox as short-term memory; approving or rejecting it is something only you can do in this app, so there are no approve or reject tools.
      </p>

      <Card variant="outline" padding="sm" title="Endpoint">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-fg-muted">MCP URL</dt>
            <dd>
              {mode !== "server" ? (
                <span className="text-fg-muted">Available after you sign in</span>
              ) : mcpUrl ? (
                <code>{mcpUrl}</code>
              ) : (
                <span className="text-fg-muted">{configLoaded ? "Not published by the server" : "Loading..."}</span>
              )}
            </dd>
          </div>
        </dl>
        {mode === "server" && configLoaded && !mcpUrl && (
          <p className="mt-2 text-xs text-fg-muted">
            The Mnemonis server did not publish an MCP URL (or it is not https / localhost). Ask the operator to set{" "}
            <code>MNEMONIS_MCP_URL</code> on the API, then reload. Until then the command below shows <code>{MCP_URL_PLACEHOLDER}</code>: replace
            it with the address of your MCP adapter.
          </p>
        )}
      </Card>

      {mode === "server" && <TokensCard mcpUrl={mcpUrl} />}

      <section aria-label="MCP tools" className="grid gap-3 lg:grid-cols-2">
        <ToolList title="Read tools" tools={READ_TOOLS} badge="Read" />
        <ToolList title="Write tools" tools={WRITE_TOOLS} badge="Waits in Inbox" />
      </section>

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
