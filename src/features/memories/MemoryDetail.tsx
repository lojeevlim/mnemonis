import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, EmptyState } from "lojee-ui";
import { BUILT_IN_MEMORY_TYPES, diffPending, getMemory, pendingRevisionFor } from "../../domain";
import { useAction, useMemories } from "../../components/hooks";
import { DemoBadge } from "../../components/DemoBadge";
import { FieldDiff } from "../../components/FieldDiff";
import { isUnsaved } from "../../components/isUnsaved";
import { OriginBadge } from "../../components/OriginBadge";
import { MarkdownView } from "../../components/MarkdownView";
import { StatusBadge } from "../../components/StatusBadge";
import { formatDateTime, isDemoMemory, typeLabel } from "../../components/memoryMeta";
import { useWorkspace } from "../../stores/workspaceStore";
import { MemoryForm, type MemoryFormValues } from "./MemoryForm";
import { RelatedMemories } from "./RelatedMemories";
import { RevisionHistory } from "./RevisionHistory";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Body of the detail drawer. Keyed by memory id by the caller so edit state resets. */
export function MemoryDetail({ memoryId, onOpenMemory }: { memoryId: string; onOpenMemory: (id: string) => void }) {
  const state = useWorkspace((s) => s.state);
  const updateMemory = useWorkspace((s) => s.updateMemory);
  const archiveMemory = useWorkspace((s) => s.archiveMemory);
  const restoreMemory = useWorkspace((s) => s.restoreMemory);
  const approve = useWorkspace((s) => s.approve);
  const reject = useWorkspace((s) => s.reject);
  const memories = useMemories();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const memory = useMemo(() => (state ? getMemory(state, memoryId) : undefined), [state, memoryId]);
  const proposal = useMemo(
    () => (state && memory?.hasPending ? pendingRevisionFor(state, memoryId) : undefined),
    [state, memory, memoryId],
  );
  const collections = useMemo(() => (state ? Object.values(state.collections) : []), [state]);
  const knownTypes = useMemo(
    () => [...new Set(memories.map((m) => m.type))].filter((t) => !(BUILT_IN_MEMORY_TYPES as readonly string[]).includes(t)),
    [memories],
  );

  if (!state || !memory) {
    return (
      <EmptyState icon="search" title="Memory not found">
        It may have been removed or never existed.
      </EmptyState>
    );
  }
  // A memory that exists only as a proposal has no saved content yet: nothing to edit until it is approved.
  const unsaved = isUnsaved(state, memory);
  const collection = memory.collectionId ? state.collections[memory.collectionId] : undefined;

  const save = async (v: MemoryFormValues) => {
    setBusy(true);
    try {
      const { ok } = await act(() => updateMemory(memory.id, v), "Saved");
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <MemoryForm
        initial={{
          title: memory.title,
          content: memory.content,
          type: memory.type,
          tags: memory.tags,
          collectionId: memory.collectionId,
        }}
        collections={collections}
        knownTypes={knownTypes}
        submitLabel="Save changes"
        busy={busy}
        onSubmit={(v) => void save(v)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold leading-snug">{memory.title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={memory.status} />
          {isDemoMemory(memory) && <DemoBadge />}
          <Badge variant="outline" size="sm">
            {typeLabel(memory.type)}
          </Badge>
          {collection && (
            <Badge variant="outline" size="sm" icon="folder">
              {collection.name}
            </Badge>
          )}
        </div>
        {!unsaved && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" icon="pencil" disabled={memory.archived} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {memory.archived ? (
            <Button size="sm" variant="outline" onClick={() => void act(() => restoreMemory(memory.id), "Restored")}>
              Restore
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void act(() => archiveMemory(memory.id), "Archived")}>
              Archive
            </Button>
          )}
        </div>
        )}
        {memory.archived && <p className="text-xs text-fg-muted">Archived memories are read-only. Restore to edit.</p>}
      </div>

      {proposal && (
        <section
          aria-label="Waiting for review"
          className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="soft" color="amber" size="sm">
              Waiting for review
            </Badge>
            <OriginBadge origin={proposal.origin} />
            <span className="text-xs text-fg-muted">
              {proposal.author}
              {proposal.note ? ` · ${proposal.note}` : ""} · {formatDateTime(proposal.createdAt)}
            </span>
          </div>
          <FieldDiff changes={diffPending(state, proposal.id).fields} collections={state.collections} projects={state.projects} />
          <div className="flex gap-2">
            <Button size="sm" icon="check" onClick={() => void act(() => approve(proposal.id), "Approved")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => void act(() => reject(proposal.id), "Rejected")}>
              Reject
            </Button>
          </div>
        </section>
      )}

      <Section title="Content">
        <MarkdownView source={memory.content} />
      </Section>

      <Section title="Tags">
        {memory.tags.length === 0 ? (
          <p className="text-sm text-fg-muted">No tags.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {memory.tags.map((t) => (
              <li key={t}>
                <Badge variant="soft" size="sm" color="slate">
                  #{t}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Source and provenance">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-fg-muted">Source</dt>
          <dd>{memory.source}</dd>
          <dt className="text-fg-muted">Origin</dt>
          <dd>{memory.provenance.origin}</dd>
          <dt className="text-fg-muted">Created by</dt>
          <dd>{memory.provenance.createdBy}</dd>
          <dt className="text-fg-muted">Created</dt>
          <dd>{formatDateTime(memory.createdAt)}</dd>
          <dt className="text-fg-muted">Updated</dt>
          <dd>{formatDateTime(memory.updatedAt)}</dd>
        </dl>
      </Section>

      <Section title="Related memories">
        <RelatedMemories state={state} memory={memory} memories={memories} onOpenMemory={onOpenMemory} />
      </Section>

      <Section title="Revision history">
        <RevisionHistory state={state} memory={memory} />
      </Section>
    </div>
  );
}
