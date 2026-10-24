import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertDialog, Badge, Button, Card, Input, ThemeSwitcher } from "lojee-ui";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ToastProvider";
import { MAX_IMPORT_BYTES, validateWorkspaceState } from "../../domain";
import { CORRUPT_BACKUP_KEY } from "../../data/localRepository";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "../branches/InlineError";
import { RUN_LOG_KEY } from "../agents/runLog";
import { useAuth } from "../auth/AuthContext";
export const APP_VERSION: string = __APP_VERSION__;

interface ImportPreview {
  json: string;
  fileName: string;
  memories: number;
  branches: number;
  commits: number;
}

type Confirm = "import" | "reset" | "clear" | null;

export function downloadText(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parses + validates an export without touching the store. */
export function previewImport(json: string, fileName: string): ImportPreview {
  if (json.length > MAX_IMPORT_BYTES) throw new Error("Import failed: the file is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Import failed: the file is not valid JSON.");
  }
  const candidate = (parsed as { state?: unknown } | null)?.state ?? parsed;
  const v = validateWorkspaceState(candidate);
  if (!v.ok) throw new Error(`Import failed: ${v.reason}`);
  return {
    json,
    fileName,
    memories: Object.keys(v.state.memories).length,
    branches: Object.keys(v.state.branches).length,
    commits: Object.keys(v.state.commits).length,
  };
}

export function SettingsPage() {
  const { user, updateProfile, deleteProfile } = useAuth();
  const toast = useToast();
  const loadIssue = useWorkspace((s) => s.loadIssue);
  const persistError = useWorkspace((s) => s.persistError);
  const memoryCount = useWorkspace((s) => (s.state ? Object.keys(s.state.memories).length : 0));
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const [name, setName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    try {
      updateProfile({ displayName: name, email });
      setProfileError(null);
      toast("Profile saved on this device", "success");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    }
  };

  const doExport = async () => {
    const json = await useWorkspace.getState().exportJson();
    if (json === undefined) return;
    downloadText(`mnemonis-export-${new Date().toISOString().slice(0, 10)}.json`, json);
    toast("Workspace exported", "success");
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Import failed: the file is too large.");
      setPreview(previewImport(await file.text(), file.name));
      setDataError(null);
      setConfirm("import");
    } catch (err) {
      setPreview(null);
      setDataError(err instanceof Error ? err.message : String(err));
    }
  };

  const doImport = async () => {
    if (!preview) return;
    const ok = await useWorkspace.getState().importJson(preview.json);
    const { error, clearError } = useWorkspace.getState();
    if (!ok) {
      setDataError(error ?? "Import failed");
      clearError();
    } else {
      setDataError(null);
      toast("Workspace imported", "success");
    }
    setPreview(null);
  };

  const doReset = async () => {
    await useWorkspace.getState().reset({ seed: true });
    toast("Reset to demo data", "success");
  };

  const doClear = async () => {
    await useWorkspace.getState().reset({ seed: false });
    try {
      localStorage.removeItem(RUN_LOG_KEY);
      localStorage.removeItem(CORRUPT_BACKUP_KEY);
    } catch {
      /* storage unavailable */
    }
    deleteProfile(); // signs out; ProtectedRoute sends you to /sign-in
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title="Settings" description="Local profile, appearance and your data. Everything stays in this browser." />

      <Card variant="outline" padding="sm" title="Profile">
        <form onSubmit={saveProfile} className="space-y-3" noValidate>
          <p className="text-xs text-fg-muted">Stored locally on this device only. It is not sent anywhere.</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-name`} className="text-xs font-medium text-fg-muted">
              Display name
            </label>
            <Input id={`${uid}-name`} size="sm" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-email`} className="text-xs font-medium text-fg-muted">
              Email
            </label>
            <Input id={`${uid}-email`} size="sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <InlineError message={profileError} />
          <Button type="submit" size="sm">
            Save profile
          </Button>
        </form>
      </Card>

      <Card variant="outline" padding="sm" title="Appearance">
        <div className="space-y-2">
          <p className="text-xs text-fg-muted">Light or dark mode and the accent colour.</p>
          <ThemeSwitcher variant="segmented" showDesign={false} showActiveItems={false} />
        </div>
      </Card>

      <Card variant="outline" padding="sm" title="Data">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft" size="sm" color={persistError ? "rose" : "emerald"}>
              {persistError ? "Browser storage: write failed" : "Browser storage: OK"}
            </Badge>
            <Badge variant="soft" size="sm" color={loadIssue && loadIssue !== "missing" ? "amber" : "slate"}>
              {loadIssue && loadIssue !== "missing" ? `Load issue: ${loadIssue}` : "Last load: no issues"}
            </Badge>
            <span className="text-xs text-fg-muted">{memoryCount} memories</span>
          </div>
          {persistError && <InlineError message={`Storage error: ${persistError}`} />}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="download" onClick={() => void doExport()}>
              Export workspace JSON
            </Button>
            <Button size="sm" variant="outline" icon="upload" onClick={() => fileRef.current?.click()}>
              Import workspace JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import workspace JSON file"
              onChange={(e) => void onFile(e)}
              tabIndex={-1}
            />
          </div>
          <InlineError message={dataError} />

          <div className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium">Reset and clear</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirm("reset")}>
                Reset to demo data
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setConfirm("clear")}>
                Clear all local data
              </Button>
            </div>
            <p className="text-xs text-fg-muted">
              There is no server account in this mode, so “account deletion” means clearing the data stored in this browser: the
              workspace becomes empty, and your local profile and agent run history are removed. Exported files are not affected.
            </p>
          </div>
        </div>
      </Card>

      <Card variant="outline" padding="sm" title="About">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Version</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Mode</dt>
            <dd>Local demo mode</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-fg-muted">
          Mnemonis is running in local mode: your memories, profile and settings are stored only in this browser. Nothing is synced
          to a server or shared with any model.
        </p>
      </Card>

      <AlertDialog
        open={confirm === "import"}
        onClose={() => {
          setConfirm(null);
          setPreview(null);
        }}
        variant="destructive"
        title="Replace your workspace with this file?"
        description={
          preview
            ? `${preview.fileName} contains ${preview.memories} memories, ${preview.branches} branches and ${preview.commits} versions. Your current workspace will be replaced.`
            : undefined
        }
        confirmLabel="Replace workspace"
        onConfirm={() => void doImport()}
      />
      <AlertDialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        variant="destructive"
        title="Reset to demo data?"
        description="This replaces your current workspace, including any versions and drafts, with the demo data. Export first if you want to keep it."
        confirmLabel="Reset to demo data"
        onConfirm={() => void doReset()}
      />
      <AlertDialog
        open={confirm === "clear"}
        onClose={() => setConfirm(null)}
        variant="destructive"
        title="Clear all local data?"
        description="This empties the workspace and removes your local profile and agent run history from this browser. You will be signed out. This cannot be undone."
        confirmLabel="Clear all local data"
        onConfirm={() => void doClear()}
      />
    </div>
  );
}
