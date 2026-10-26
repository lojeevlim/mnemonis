import { Link } from "react-router-dom";
import { Badge, Button, Card } from "lojee-ui";
import { formatRelative } from "../../components/memoryMeta";
import { useOptionalAuth } from "../auth/AuthContext";
import { useMcpStatus, type McpStatus } from "../mcp/useMcpStatus";

type Color = "slate" | "amber" | "emerald" | "rose";

function describe(status: McpStatus): { color: Color; label: string; text: string; to?: string; toLabel?: string } {
  switch (status.kind) {
    case "local":
      return { color: "slate", label: "Local only", text: "This workspace lives in your browser. Sign in to a server to connect AI clients over MCP.", to: "/sign-in", toLabel: "Sign in" };
    case "loading":
      return { color: "slate", label: "Checking…", text: "Checking your MCP tokens." };
    case "error":
      return { color: "rose", label: "Unavailable", text: "Could not load your MCP tokens from the server." };
    case "none":
      return { color: "amber", label: "Not set up", text: "No active token yet. Create one to let an AI client connect.", to: "/mcp", toLabel: "MCP Connections" };
    case "waiting":
      return { color: "amber", label: "Waiting for client", text: `${plural(status.active)} created, but no client has used it yet.`, to: "/mcp", toLabel: "Connection steps" };
    case "connected":
      return { color: "emerald", label: "Connected", text: `Last used ${formatRelative(status.lastUsedAt)} · ${plural(status.active)}.`, to: "/mcp", toLabel: "MCP Connections" };
    case "idle":
      return { color: "slate", label: "Idle", text: `Last used ${formatRelative(status.lastUsedAt)} · ${plural(status.active)}.`, to: "/mcp", toLabel: "MCP Connections" };
  }
}

const plural = (n: number) => `${n} active token${n === 1 ? "" : "s"}`;

export function McpStatusCard() {
  const auth = useOptionalAuth();
  const { status, retry } = useMcpStatus(auth?.status === "signedIn");
  const d = describe(status);
  return (
    <Card title="MCP status" variant="outline" padding="sm">
      <div className="flex items-start gap-3">
        <Badge variant="soft" color={d.color} size="sm">
          {d.label}
        </Badge>
        <div className="min-w-0 flex-1 space-y-1 text-sm text-fg-muted">
          <p>{d.text}</p>
          {d.to && (
            <Link to={d.to} className="text-fg underline">
              {d.toLabel}
            </Link>
          )}
          {status.kind === "error" && (
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
