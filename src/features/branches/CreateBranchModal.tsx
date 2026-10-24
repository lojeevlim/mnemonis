import { useId, useState, type FormEvent } from "react";
import { Button, Checkbox, Input, Modal, Select } from "lojee-ui";
import { commitLog, getBranch } from "../../domain";
import { useWorkspace } from "../../stores/workspaceStore";
import { InlineError } from "./InlineError";
import { useInlineAction } from "./useInlineAction";

const CURRENT_HEAD = "";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Preselected commit; defaults to the current branch head. */
  fromCommitId?: string;
}

export function CreateBranchModal({ open, onClose, fromCommitId }: Props) {
  // Remount the form each time so state starts fresh.
  return (
    <Modal open={open} onClose={onClose} title="Create branch">
      {open && <CreateBranchForm onClose={onClose} fromCommitId={fromCommitId} />}
    </Modal>
  );
}

function CreateBranchForm({ onClose, fromCommitId }: { onClose: () => void; fromCommitId?: string }) {
  const uid = useId();
  const state = useWorkspace((s) => s.state);
  const createBranch = useWorkspace((s) => s.createBranch);
  const { run, error } = useInlineAction();
  const [name, setName] = useState("");
  const [from, setFrom] = useState(fromCommitId ?? CURRENT_HEAD);
  const [switchTo, setSwitchTo] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const log = commitLog(state);
  const current = getBranch(state, state.currentBranchId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { ok, value } = await run(
        () => createBranch(name, from === CURRENT_HEAD ? undefined : from, switchTo),
        undefined,
      );
      if (ok && value) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-name`} className="text-xs font-medium text-fg-muted">
          Branch name
        </label>
        <Input id={`${uid}-name`} size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-from`} className="text-xs font-medium text-fg-muted">
          Start from
        </label>
        <Select
          id={`${uid}-from`}
          size="sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          options={[
            { value: CURRENT_HEAD, label: `Current head of ${current.name}` },
            ...log.map((c) => ({ value: c.id, label: c.message })),
          ]}
        />
      </div>
      <Checkbox label="Switch to the new branch" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} />
      <InlineError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          Create branch
        </Button>
      </div>
    </form>
  );
}
