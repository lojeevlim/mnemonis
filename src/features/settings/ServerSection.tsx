import { useId, useState } from "react";
import { AlertDialog, Badge, Button, Card, Input } from "lojee-ui";
import { InlineError } from "../../components/InlineError";
import { useToast } from "../../components/ToastProvider";
import { createRemoteRepository } from "../../data/createRepository";
import { LocalRepository } from "../../data/localRepository";
import {
  DEFAULT_SERVER_URL,
  clearServerSettings,
  loadServerSettings,
  normalizeServerUrl,
  saveServerSettings,
} from "../../data/serverSettings";
import { testServerConnection } from "../../data/testConnection";
import { useWorkspace } from "../../stores/workspaceStore";

/** Settings card for the optional Mnemonis server (default: local mode, nothing is sent anywhere). */
export function ServerSection() {
  const toast = useToast();
  const uid = useId();
  const mode = useWorkspace((s) => s.mode);
  const rev = useWorkspace((s) => s.remoteRev);
  const connected = mode === "remote";

  const [url, setUrl] = useState(() => loadServerSettings()?.url ?? DEFAULT_SERVER_URL);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);

  /** URL + token to use: the typed ones, else (when connected and the token field is empty) the saved ones. */
  const inputs = () => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) {
      setError("Enter a valid http(s) server URL, for example http://localhost:8787.");
      return null;
    }
    const t = token.trim() || (connected ? (loadServerSettings()?.token ?? "") : "");
    if (!t) {
      setError("Enter the access token (run `npm run token` in the server project).");
      return null;
    }
    setError(null);
    return { url: normalized, token: t };
  };

  const test = async () => {
    const i = inputs();
    if (!i) return;
    setBusy(true);
    const r = await testServerConnection(i.url, i.token);
    setBusy(false);
    setMessage({ ok: r.ok, text: r.ok ? `${r.message}${r.rev !== undefined ? ` Server revision ${r.rev}.` : ""}` : r.message });
  };

  const connect = async () => {
    const i = inputs();
    if (!i) return;
    setBusy(true);
    setMessage(null);
    const ok = await useWorkspace.getState().switchRepository(createRemoteRepository(i));
    setBusy(false);
    if (!ok) {
      const { error: e, clearError } = useWorkspace.getState();
      setError(e ?? "Could not connect to the server.");
      clearError();
      return;
    }
    if (!saveServerSettings(i)) setMessage({ ok: false, text: "Connected, but this browser cannot store the settings, so it will not persist after a reload." });
    setToken("");
    setUrl(i.url);
    toast("Connected to the Mnemonis server", "success");
  };

  const disconnect = async () => {
    setBusy(true);
    clearServerSettings();
    await useWorkspace.getState().switchRepository(new LocalRepository());
    setBusy(false);
    setMessage(null);
    setError(null);
    toast("Disconnected; using this browser's data", "success");
  };

  const copyToServer = async () => {
    try {
      // Read-only view of the browser workspace: never writes (or seeds) local storage.
      const local = new LocalRepository({
        storage: {
          getItem: (k) => localStorage.getItem(k),
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      });
      const json = await local.export();
      const ok = await useWorkspace.getState().importJson(json);
      const { error: e, clearError } = useWorkspace.getState();
      if (!ok) {
        setError(e ?? "Copy failed");
        clearError();
      } else {
        setError(null);
        toast("Browser data copied to the server", "success");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card variant="outline" padding="sm" title="Mnemonis server">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="soft" size="sm" color={connected ? "emerald" : "slate"}>
            {connected ? "Connected" : "Local mode"}
          </Badge>
          <span className="text-xs text-fg-muted" role="status">
            {connected
              ? `Using the server${rev !== null ? ` (revision ${rev})` : ""}. Changes made by AI clients appear here automatically.`
              : "Not connected: data stays in this browser."}
          </span>
        </div>
        <p className="text-xs text-fg-muted">
          Connect to a Mnemonis server you run yourself so AI clients (MCP) share this workspace. Get the token with{" "}
          <code>npm run token</code> in the server project. The token is kept in this browser's storage and sent as a request header.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-url`} className="text-xs font-medium text-fg-muted">
            Server URL
          </label>
          <Input id={`${uid}-url`} size="sm" value={url} onChange={(e) => setUrl(e.target.value)} disabled={connected} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-token`} className="text-xs font-medium text-fg-muted">
            Access token
          </label>
          <Input
            id={`${uid}-token`}
            size="sm"
            type="password"
            autoComplete="off"
            value={token}
            placeholder={connected ? "Saved in this browser" : ""}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <InlineError message={error} />
        {message && (
          <p role="status" className={message.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
            {message.text}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void test()}>
            Test connection
          </Button>
          {connected ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              Connect
            </Button>
          )}
        </div>
        {connected && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-fg-muted">
              Optional: upload the workspace stored in this browser to the server. This replaces the server&apos;s data.
            </p>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmCopy(true)}>
              Copy my browser data to the server
            </Button>
          </div>
        )}
      </div>
      <AlertDialog
        open={confirmCopy}
        onClose={() => setConfirmCopy(false)}
        variant="destructive"
        title="Replace the server's data with this browser's data?"
        description="This REPLACES everything stored on the server (memories, history and the Inbox) with the workspace stored in this browser. It cannot be undone. Export the server data first if you want to keep it."
        confirmLabel="Replace server data"
        onConfirm={() => void copyToServer()}
      />
    </Card>
  );
}
