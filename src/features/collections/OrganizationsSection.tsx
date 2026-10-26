import { useMemo, useState } from "react";
import { AlertDialog, Badge, Button, EmptyState, Modal } from "lojee-ui";
import { listOrganizations, type Organization } from "../../domain";
import { InlineError } from "../../components/InlineError";
import { useInlineAction } from "../../components/useInlineAction";
import { useWorkspace } from "../../stores/workspaceStore";
import { OrganizationForm } from "./OrganizationForm";

type Dialog = { kind: "create" } | { kind: "rename"; organization: Organization } | { kind: "delete"; organization: Organization } | null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Organizations: the level above projects. Created by the user (or proposed by an agent together with a new project). */
export function OrganizationsSection() {
  const state = useWorkspace((s) => s.state);
  const createOrganization = useWorkspace((s) => s.createOrganization);
  const renameOrganization = useWorkspace((s) => s.renameOrganization);
  const deleteOrganization = useWorkspace((s) => s.deleteOrganization);
  const confirmOrganization = useWorkspace((s) => s.confirmOrganization);
  const { run, error, clearError } = useInlineAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const organizations = useMemo(() => (state ? listOrganizations(state).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)) : []), [state]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (state) for (const p of Object.values(state.projects)) if (p.organizationId) m.set(p.organizationId, (m.get(p.organizationId) ?? 0) + 1);
    return m;
  }, [state]);
  if (!state) return null;

  const close = () => {
    setDialog(null);
    clearError();
  };
  const submit = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      const { ok } = await run(fn, message);
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };
  const unconfirmed = organizations.filter((o) => !o.confirmed).length;

  return (
    <section id="organizations" aria-label="Organizations" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">Organizations</h2>
        {unconfirmed > 0 && (
          <Badge variant="soft" color="amber" size="sm">
            {unconfirmed} unconfirmed
          </Badge>
        )}
        <Button size="xs" variant="outline" icon="plus" className="ml-auto" onClick={() => setDialog({ kind: "create" })}>
          New organization
        </Button>
      </div>
      <p className="text-xs text-fg-muted">
        An organization groups projects (for example a company and its repositories). A project belongs to at most one. An agent
        can propose one for a new project; it stays unconfirmed until you confirm it or approve a memory in that project.
      </p>
      <InlineError message={dialog === null ? error : null} />

      {organizations.length === 0 ? (
        <EmptyState icon="folder" title="No organizations yet">
          Create one, then choose it in the Organization menu of a project below.
        </EmptyState>
      ) : (
        <ul className="space-y-2" aria-label="Organizations list">
          {organizations.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <span className="min-w-0 truncate text-sm font-medium text-fg">{o.name}</span>
              <Badge variant="soft" size="xs" color={o.confirmed ? "emerald" : "amber"}>
                {o.confirmed ? "Confirmed" : "Unconfirmed"}
              </Badge>
              {o.autoCreated && <span className="text-xs text-fg-muted">{`created by ${o.createdBy}`}</span>}
              <Badge variant="soft" size="sm" color="slate">
                {plural(counts.get(o.id) ?? 0, "project", "projects")}
              </Badge>
              <span className="ml-auto flex flex-wrap gap-1">
                {!o.confirmed && (
                  <Button size="xs" variant="ghost" icon="check" onClick={() => void run(() => confirmOrganization(o.id), "Organization confirmed")}>
                    <span aria-hidden="true">Confirm</span>
                    <span className="sr-only">Confirm organization {o.name}</span>
                  </Button>
                )}
                <Button size="xs" variant="ghost" icon="pencil" onClick={() => setDialog({ kind: "rename", organization: o })}>
                  <span aria-hidden="true">Rename</span>
                  <span className="sr-only">Rename organization {o.name}</span>
                </Button>
                <Button size="xs" variant="ghost" icon="trash-2" color="rose" onClick={() => setDialog({ kind: "delete", organization: o })}>
                  <span aria-hidden="true">Delete</span>
                  <span className="sr-only">Delete organization {o.name}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={dialog?.kind === "create"} onClose={close} title="New organization">
        <div className="space-y-3">
          <InlineError message={error} />
          <OrganizationForm
            submitLabel="Create organization"
            busy={busy}
            onSubmit={(name) => void submit(() => createOrganization(name), "Organization created")}
            onCancel={close}
          />
        </div>
      </Modal>
      <Modal open={dialog?.kind === "rename"} onClose={close} title="Rename organization">
        {dialog?.kind === "rename" && (
          <div className="space-y-3">
            <InlineError message={error} />
            <OrganizationForm
              key={dialog.organization.id}
              initialName={dialog.organization.name}
              submitLabel="Save"
              busy={busy}
              onSubmit={(name) => void submit(() => renameOrganization(dialog.organization.id, name), "Organization renamed")}
              onCancel={close}
            />
          </div>
        )}
      </Modal>
      <AlertDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        variant="destructive"
        title={dialog?.kind === "delete" ? `Delete organization “${dialog.organization.name}”?` : "Delete organization?"}
        description="Its projects are kept and simply lose the link to it. Memories are never touched."
        confirmLabel="Delete organization"
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          const o = dialog.organization;
          setDialog(null);
          void run(() => deleteOrganization(o.id), "Organization deleted");
        }}
      />
    </section>
  );
}
