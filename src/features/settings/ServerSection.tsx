import { useId, useState, type FormEvent } from "react";
import { AlertDialog, Badge, Button, Card, Input } from "lojee-ui";
import { InlineError } from "../../components/InlineError";
import { useToast } from "../../components/ToastProvider";
import { describeApiError } from "../../data/accountApi";
import { LocalRepository } from "../../data/localRepository";
import { getServerUrl } from "../../data/serverSettings";
import { testServerConnection } from "../../data/testConnection";
import { useWorkspace } from "../../stores/workspaceStore";
import { useAuth } from "../auth/AuthContext";
import { getSessionToken } from "../auth/session";

function PasswordField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg-muted">
        {label}
      </label>
      <Input id={id} size="sm" type="password" autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ChangePassword() {
  const { changePassword } = useAuth();
  const toast = useToast();
  const uid = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !next) return setError("Enter your current and new password.");
    if (next !== confirm) return setError("The new passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast("Password changed. Other devices were signed out.", "success");
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 border-t border-border pt-3" noValidate aria-label="Change password">
      <h3 className="text-sm font-medium">Change password</h3>
      <PasswordField id={`${uid}-cur`} label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField id={`${uid}-new`} label="New password (at least 12 characters)" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordField id={`${uid}-conf`} label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <InlineError message={error} />
      <Button type="submit" size="sm" variant="outline" disabled={busy}>
        Change password
      </Button>
    </form>
  );
}

function DeleteAccount() {
  const { deleteAccount } = useAuth();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doDelete = async () => {
    try {
      await deleteAccount(password);
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-sm font-medium">Delete account</h3>
      <p className="text-xs text-fg-muted">Permanently deletes your account, its memories, history, sessions and MCP tokens on the server.</p>
      {open ? (
        <div className="space-y-2">
          <PasswordField id={`${uid}-del`} label="Confirm with your password" value={password} onChange={setPassword} autoComplete="current-password" />
          <InlineError message={error} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => (password ? setConfirm(true) : setError("Enter your password to delete the account."))}
            >
              Delete my account
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      )}
      <AlertDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        variant="destructive"
        title="Delete your account?"
        description="This permanently deletes your account and everything stored for it on the server. It cannot be undone. Export your workspace first if you want to keep it."
        confirmLabel="Delete account"
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

/** Settings card for the Mnemonis server account (or, in local mode, how to get one). */
export function ServerSection() {
  const toast = useToast();
  const { mode: authMode, user, signOut } = useAuth();
  const rev = useWorkspace((s) => s.remoteRev);
  const connected = authMode === "server";
  const serverUrl = getServerUrl();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);

  const test = async () => {
    setBusy(true);
    const r = await testServerConnection(serverUrl, getSessionToken() ?? "");
    setBusy(false);
    setMessage({ ok: r.ok, text: r.ok ? `${r.message}${r.rev !== undefined ? ` Server revision ${r.rev}.` : ""}` : r.message });
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
        toast("Browser data copied to your account", "success");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card variant="outline" padding="sm" title="Mnemonis account">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="soft" size="sm" color={connected ? "emerald" : "slate"}>
            {connected ? "Connected" : "Local mode"}
          </Badge>
          <span className="text-xs text-fg-muted" role="status">
            {connected
              ? `Signed in as ${user?.email ?? "your account"}${rev !== null ? ` (revision ${rev})` : ""}. Changes made by AI clients appear here automatically.`
              : "No account: data stays in this browser."}
          </span>
        </div>
        <dl className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <dt className="text-fg-muted">Server</dt>
          <dd>
            <code>{serverUrl}</code>
          </dd>
        </dl>
        <InlineError message={error} />
        {message && (
          <p role="status" className={message.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
            {message.text}
          </p>
        )}
        {connected ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void test()}>
                Test connection
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void signOut()}>
                Log out
              </Button>
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-fg-muted">
                Optional: upload the workspace stored in this browser to your account. This replaces your account&apos;s data.
              </p>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmCopy(true)}>
                Copy my browser data to my account
              </Button>
            </div>
            <ChangePassword />
            <DeleteAccount />
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-fg-muted">
              Sign in to, or register, a Mnemonis account so AI clients (MCP) can share this workspace. Your browser data can be copied
              to the account afterwards.
            </p>
            <Button size="sm" onClick={() => void signOut()}>
              Sign in or register
            </Button>
          </div>
        )}
      </div>
      <AlertDialog
        open={confirmCopy}
        onClose={() => setConfirmCopy(false)}
        variant="destructive"
        title="Replace your account's data with this browser's data?"
        description="This REPLACES everything stored in your account (memories, history and the Inbox) with the workspace stored in this browser. It cannot be undone. Export your account data first if you want to keep it."
        confirmLabel="Replace account data"
        onConfirm={() => void copyToServer()}
      />
    </Card>
  );
}
