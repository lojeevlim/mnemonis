import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertDialog, Badge, Button, Card, EmptyState, Modal } from "lojee-ui";
import type { Collection } from "../../domain";
import { useAction, useMemories } from "../../components/hooks";
import { DemoBadge } from "../../components/DemoBadge";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { isDemoMemory } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { CollectionForm, type CollectionFormValues } from "./CollectionForm";

type Dialog = { kind: "create" } | { kind: "rename"; collection: Collection } | { kind: "delete"; collection: Collection } | null;

export function CollectionsPage() {
  const state = useWorkspace((s) => s.state);
  const createCollection = useWorkspace((s) => s.createCollection);
  const updateCollection = useWorkspace((s) => s.updateCollection);
  const deleteCollection = useWorkspace((s) => s.deleteCollection);
  const memories = useMemories();
  const act = useAction();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const collections = useMemo(
    () => (state ? Object.values(state.collections).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [state],
  );
  const members = useMemo(() => {
    const map = new Map<string, typeof memories>();
    for (const m of memories) {
      if (!m.collectionId) continue;
      map.set(m.collectionId, [...(map.get(m.collectionId) ?? []), m]);
    }
    return map;
  }, [memories]);

  if (!state) return null;
  const selected = collections.find((c) => c.id === selectedId) ?? null;
  const selectedMembers = selected ? (members.get(selected.id) ?? []) : [];
  const countOf = (id: string) => (members.get(id) ?? []).filter((m) => !m.archived).length;

  const close = () => setDialog(null);

  const create = async (v: CollectionFormValues) => {
    setBusy(true);
    try {
      const { ok } = await act(() => createCollection(v.name, v.description), "Collection created");
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };
  const rename = async (c: Collection, v: CollectionFormValues) => {
    setBusy(true);
    try {
      const { ok } = await act(() => updateCollection(c.id, v), "Collection updated");
      if (ok) close();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: Collection) => {
    close();
    const { ok } = await act(() => deleteCollection(c.id), "Collection deleted");
    if (ok && selectedId === c.id) setSelectedId(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4">
      <PageHeader
        title="Collections"
        description="Group related memories. Counts exclude archived memories."
        actions={
          <Button size="sm" icon="plus" onClick={() => setDialog({ kind: "create" })}>
            New collection
          </Button>
        }
      />

      {collections.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No collections yet"
          action={
            <Button size="sm" icon="plus" onClick={() => setDialog({ kind: "create" })}>
              New collection
            </Button>
          }
        >
          Collections help you organise memories by project or topic.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="space-y-2" aria-label="Collections">
            {collections.map((c) => (
              <li key={c.id}>
                <div
                  className={`rounded-lg border p-3 ${selectedId === c.id ? "border-accent-500/60 bg-surface-muted" : "border-border"}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg hover:underline"
                      aria-pressed={selectedId === c.id}
                      onClick={() => setSelectedId(c.id)}
                    >
                      {c.name}
                    </button>
                    <Badge variant="soft" size="sm" color="slate">
                      {countOf(c.id)} {countOf(c.id) === 1 ? "memory" : "memories"}
                    </Badge>
                  </div>
                  {c.description && <p className="mt-1 text-xs text-fg-muted">{c.description}</p>}
                  <div className="mt-2 flex gap-1">
                    <Button size="xs" variant="ghost" icon="pencil" onClick={() => setDialog({ kind: "rename", collection: c })}>
                      <span aria-hidden="true">Rename</span>
                      <span className="sr-only">Rename {c.name}</span>
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon="trash-2"
                      color="rose"
                      onClick={() => setDialog({ kind: "delete", collection: c })}
                    >
                      <span aria-hidden="true">Delete</span>
                      <span className="sr-only">Delete {c.name}</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Card variant="outline" padding="sm" title={selected ? selected.name : "Members"}>
            {!selected ? (
              <p className="text-sm text-fg-muted">Select a collection to see its memories.</p>
            ) : selectedMembers.length === 0 ? (
              <EmptyState icon="inbox" title="No memories in this collection">
                Assign memories to it when you create or edit them.
              </EmptyState>
            ) : (
              <div className="space-y-2">
                <ul className="divide-y divide-border" aria-label={`Memories in ${selected.name}`}>
                  {selectedMembers.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <Link to={`/memories?memory=${encodeURIComponent(m.id)}`} className="min-w-0 flex-1 truncate hover:underline">
                        {m.title}
                      </Link>
                      {isDemoMemory(m) && <DemoBadge />}
                      <StatusBadge status={m.status} />
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/memories?collection=${encodeURIComponent(selected.id)}`}
                  className="inline-block text-sm text-accent-400 underline underline-offset-2"
                >
                  Open in Memories
                </Link>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={dialog?.kind === "create"} onClose={close} title="New collection">
        <CollectionForm submitLabel="Create collection" busy={busy} onSubmit={(v) => void create(v)} onCancel={close} />
      </Modal>
      <Modal open={dialog?.kind === "rename"} onClose={close} title="Rename collection">
        {dialog?.kind === "rename" && (
          <CollectionForm
            key={dialog.collection.id}
            initial={{ name: dialog.collection.name, description: dialog.collection.description }}
            submitLabel="Save"
            busy={busy}
            onSubmit={(v) => void rename(dialog.collection, v)}
            onCancel={close}
          />
        )}
      </Modal>
      <AlertDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        variant="destructive"
        title={dialog?.kind === "delete" ? `Delete “${dialog.collection.name}”?` : "Delete collection?"}
        description="Only empty collections can be deleted. Memories are never removed by this action."
        confirmLabel="Delete"
        onConfirm={() => dialog?.kind === "delete" && void remove(dialog.collection)}
      />
    </div>
  );
}
