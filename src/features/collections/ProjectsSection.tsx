import { useMemo, useState } from "react";
import { AlertDialog, Badge, Button, EmptyState, Modal, Select } from "lojee-ui";
import { projectOfMemory, type Project, type WorkspaceState } from "../../domain";
import { useMemories } from "../../components/hooks";
import { InlineError } from "../../components/InlineError";
import { useToast } from "../../components/ToastProvider";
import { useInlineAction } from "../../components/useInlineAction";
import { useWorkspace } from "../../stores/workspaceStore";
import { OrganizationForm } from "./OrganizationForm";
import { OrganizationsSection } from "./OrganizationsSection";
import { ProjectForm, type ProjectFormValues } from "./ProjectForm";

type Dialog =
  | { kind: "create" }
  | { kind: "rename"; project: Project }
  | { kind: "delete"; project: Project }
  | { kind: "newOrganization"; project: Project }
  | null;

const NO_ORGANIZATION = "__none__";
const NEW_ORGANIZATION = "__new__";

const AUTO_NOTE = "Filed automatically into";

/** How many of the user's own memories a write just filed into a project on its own (new revisions with the auto-file note). */
function autoFiledCount(before: WorkspaceState | null, after: WorkspaceState | null): number {
  if (!before || !after) return 0;
  return Object.values(after.revisions).filter((r) => r.note.startsWith(AUTO_NOTE) && !Object.hasOwn(before.revisions, r.id)).length;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ProjectsSection() {
  const state = useWorkspace((s) => s.state);
  const createProject = useWorkspace((s) => s.createProject);
  const confirmProject = useWorkspace((s) => s.confirmProject);
  const renameProject = useWorkspace((s) => s.renameProject);
  const deleteProject = useWorkspace((s) => s.deleteProject);
  const createOrganization = useWorkspace((s) => s.createOrganization);
  const assignProjectOrganization = useWorkspace((s) => s.assignProjectOrganization);
  const memories = useMemories();
  const toast = useToast();
  const { run, error, clearError } = useInlineAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const projects = useMemo(
    () => (state ? Object.values(state.projects).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)) : []),
    [state],
  );
  const members = useMemo(() => {
    const count = new Map<string, number>();
    if (!state) return count;
    for (const m of memories) {
      if (m.archived) continue;
      const p = projectOfMemory(state, m);
      if (p) count.set(p.id, (count.get(p.id) ?? 0) + 1);
    }
    return count;
  }, [state, memories]);
  if (!state) return null;

  const close = () => {
    setDialog(null);
    clearError();
  };
  const withNotice = (message: string, before: WorkspaceState | null): void => {
    const filed = autoFiledCount(before, useWorkspace.getState().state);
    toast(filed > 0 ? `${message} ${plural(filed, "of your memories was", "of your memories were")} filed into a project automatically.` : message, "success");
  };

  const create = async (v: ProjectFormValues) => {
    const before = useWorkspace.getState().state;
    setBusy(true);
    try {
      const { ok } = await run(() => createProject({ name: v.name, ...(v.repo ? { repo: v.repo } : {}) }));
      if (ok) {
        close();
        withNotice("Project created.", before);
      }
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (p: Project) => {
    const before = useWorkspace.getState().state;
    const { ok } = await run(() => confirmProject(p.id));
    if (ok) withNotice("Project confirmed.", before);
  };
  const rename = async (p: Project, v: ProjectFormValues) => {
    const before = useWorkspace.getState().state;
    setBusy(true);
    try {
      const { ok } = await run(() => renameProject(p.id, v.name));
      if (ok) {
        close();
        withNotice("Project renamed.", before);
      }
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: Project) => {
    setDialog(null);
    await run(() => deleteProject(p.id), "Project deleted");
  };

  const chooseOrganization = (p: Project, value: string) => {
    if (value === NEW_ORGANIZATION) {
      setDialog({ kind: "newOrganization", project: p });
      return;
    }
    void run(() => assignProjectOrganization(p.id, value === NO_ORGANIZATION ? null : value), "Organization updated");
  };
  const createAndAssign = async (p: Project, name: string) => {
    setBusy(true);
    try {
      const created = await run(() => createOrganization(name));
      if (!created.ok || !created.value) return;
      const { ok } = await run(() => assignProjectOrganization(p.id, created.value!.id), "Organization created and assigned");
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };

  const unconfirmed = projects.filter((p) => !p.confirmed).length;
  const organizations = Object.values(state.organizations).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));

  return (
    <>
      <OrganizationsSection />
      <section id="projects" aria-label="Projects" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">Projects</h2>
          {unconfirmed > 0 && (
            <Badge variant="soft" color="amber" size="sm">
              {unconfirmed} unconfirmed
            </Badge>
          )}
          <Button size="xs" variant="outline" icon="plus" className="ml-auto" onClick={() => setDialog({ kind: "create" })}>
            New project
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          A project groups the memories of one codebase. Agents detect it from the repository they work in; a project an agent
          created stays unconfirmed until you confirm it or approve a memory in it.
        </p>
        <InlineError message={dialog === null ? error : null} />

        {projects.length === 0 ? (
          <EmptyState icon="folder" title="No projects yet">
            Projects appear when you create one or when an agent files a memory for a repository.
          </EmptyState>
        ) : (
          <ul className="space-y-2" aria-label="Projects list">
            {projects.map((p) => {
              const folder = p.collectionId && Object.hasOwn(state.collections, p.collectionId) ? state.collections[p.collectionId] : undefined;
              const count = members.get(p.id) ?? 0;
              const org = p.organizationId && Object.hasOwn(state.organizations, p.organizationId) ? state.organizations[p.organizationId] : undefined;
              return (
                <li key={p.id} className="space-y-1.5 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{p.name}</span>
                    <Badge variant="soft" size="xs" color={p.confirmed ? "emerald" : "amber"}>
                      {p.confirmed ? "Confirmed" : "Unconfirmed"}
                    </Badge>
                    {p.autoCreated && (
                      <span className="text-xs text-fg-muted">{`created by ${p.createdBy}`}</span>
                    )}
                    <Badge variant="soft" size="sm" color="slate" className="ml-auto">
                      {plural(count, "memory", "memories")}
                    </Badge>
                  </div>
                  <p className="text-xs text-fg-muted">{`Folder: ${folder ? folder.name : "none"}`}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span>{`Organization: ${org ? org.name : "none"}`}</span>
                    {org && !org.confirmed && (
                      <Badge variant="soft" size="xs" color="amber">
                        Unconfirmed organization
                      </Badge>
                    )}
                    <div className="w-44">
                      <Select
                        size="sm"
                        aria-label={`Organization of ${p.name}`}
                        value={org ? org.id : NO_ORGANIZATION}
                        onChange={(e) => chooseOrganization(p, e.target.value)}
                        options={[
                          { value: NO_ORGANIZATION, label: "None" },
                          ...organizations.map((o) => ({ value: o.id, label: o.name })),
                          { value: NEW_ORGANIZATION, label: "New organization…" },
                        ]}
                      />
                    </div>
                  </div>
                  {p.sources.some((s) => s.kind === "repo" || s.kind === "workspace") && (
                    <ul className="flex flex-wrap gap-x-3 text-xs text-fg-muted" aria-label={`Sources of ${p.name}`}>
                      {p.sources
                        .filter((s) => s.kind === "repo" || s.kind === "workspace")
                        .map((s) => (
                          <li key={`${s.kind}:${s.ref}`}>{`${s.kind === "repo" ? "Repository" : "Workspace"}: ${s.ref}`}</li>
                        ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {!p.confirmed && (
                      <Button size="xs" variant="ghost" icon="check" onClick={() => void confirm(p)}>
                        <span aria-hidden="true">Confirm</span>
                        <span className="sr-only">Confirm {p.name}</span>
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" icon="pencil" onClick={() => setDialog({ kind: "rename", project: p })}>
                      <span aria-hidden="true">Rename</span>
                      <span className="sr-only">Rename project {p.name}</span>
                    </Button>
                    <Button size="xs" variant="ghost" icon="trash-2" color="rose" onClick={() => setDialog({ kind: "delete", project: p })}>
                      <span aria-hidden="true">Delete</span>
                      <span className="sr-only">Delete project {p.name}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Modal open={dialog?.kind === "create"} onClose={close} title="New project">
          <div className="space-y-3">
            <InlineError message={error} />
            <ProjectForm withRepo submitLabel="Create project" busy={busy} onSubmit={(v) => void create(v)} onCancel={close} />
          </div>
        </Modal>
        <Modal open={dialog?.kind === "rename"} onClose={close} title="Rename project">
          {dialog?.kind === "rename" && (
            <div className="space-y-3">
              <InlineError message={error} />
              <ProjectForm
                key={dialog.project.id}
                initial={{ name: dialog.project.name }}
                submitLabel="Save"
                busy={busy}
                onSubmit={(v) => void rename(dialog.project, v)}
                onCancel={close}
              />
            </div>
          )}
        </Modal>
        <Modal open={dialog?.kind === "newOrganization"} onClose={close} title="New organization">
          {dialog?.kind === "newOrganization" && (
            <div className="space-y-3">
              <InlineError message={error} />
              <p className="text-xs text-fg-muted">{`It will be assigned to ${dialog.project.name}.`}</p>
              <OrganizationForm submitLabel="Create and assign" busy={busy} onSubmit={(name) => void createAndAssign(dialog.project, name)} onCancel={close} />
            </div>
          )}
        </Modal>
        <AlertDialog
          open={dialog?.kind === "delete"}
          onClose={close}
          variant="destructive"
          title={dialog?.kind === "delete" ? `Delete project “${dialog.project.name}”?` : "Delete project?"}
          description="Only a project with no memories can be deleted. Its folder (collection) and memories are never removed by this action."
          confirmLabel="Delete project"
          onConfirm={() => dialog?.kind === "delete" && void remove(dialog.project)}
        />
      </section>
    </>
  );
}
