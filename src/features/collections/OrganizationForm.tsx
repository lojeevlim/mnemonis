import { useId, useState, type FormEvent } from "react";
import { Button, Input } from "lojee-ui";

interface Props {
  initialName?: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function OrganizationForm({ initialName = "", submitLabel, busy, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && !name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    onSubmit(name.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-name`} className="text-xs font-medium text-fg-muted">
          Organization name
        </label>
        <Input id={`${uid}-name`} size="sm" value={name} invalid={invalid} autoFocus onChange={(e) => setName(e.target.value)} />
        {invalid && (
          <p role="alert" className="text-xs text-rose-400">
            Name is required.
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
