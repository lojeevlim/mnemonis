import { useMemo, useState } from "react";
import { Modal } from "lojee-ui";
import { BUILT_IN_MEMORY_TYPES } from "../../domain";
import { useAction, useMemories } from "../../components/hooks";
import { useWorkspace } from "../../stores/workspaceStore";
import { MemoryForm, type MemoryFormValues } from "./MemoryForm";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  defaultCollectionId?: string | null;
}

export function CreateMemoryModal({ open, onClose, onCreated, defaultCollectionId }: Props) {
  const state = useWorkspace((s) => s.state);
  const createMemory = useWorkspace((s) => s.createMemory);
  const memories = useMemories();
  const act = useAction();
  const [busy, setBusy] = useState(false);
  const collections = useMemo(() => (state ? Object.values(state.collections) : []), [state]);
  const knownTypes = useMemo(
    () => [...new Set(memories.map((m) => m.type))].filter((t) => !(BUILT_IN_MEMORY_TYPES as readonly string[]).includes(t)),
    [memories],
  );

  const submit = async (v: MemoryFormValues) => {
    setBusy(true);
    try {
      const { ok, value } = await act(() => createMemory(v), "Memory created");
      if (ok && value) {
        onClose();
        onCreated?.(value.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New memory">
      <MemoryForm
        initial={{ collectionId: defaultCollectionId ?? undefined }}
        automaticCollection
        collections={collections}
        knownTypes={knownTypes}
        submitLabel="Create memory"
        busy={busy}
        onSubmit={(v) => void submit(v)}
        onCancel={onClose}
      />
    </Modal>
  );
}
