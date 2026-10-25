import { useId, useState, type FormEvent } from "react";
import { Button, Input } from "lojee-ui";

export interface ProjectFormValues {
  name: string;
  /** Empty when none was given. */
  repo: string;
}

interface Props {
  initial?: Partial<ProjectFormValues>;
  /** Show the repository field (creating only: renaming never changes the sources). */
  withRepo?: boolean;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: ProjectFormValues) => void;
  onCancel: () => void;
}

export function ProjectForm({ initial, withRepo, submitLabel, busy, onSubmit, onCancel }: Props) {
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && !name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), repo: repo.trim() });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-name`} className="text-xs font-medium text-fg-muted">
          Project name
        </label>
        <Input id={`${uid}-name`} size="sm" value={name} invalid={invalid} autoFocus onChange={(e) => setName(e.target.value)} />
        {invalid && (
          <p role="alert" className="text-xs text-rose-400">
            Name is required.
          </p>
        )}
      </div>
      {withRepo && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-repo`} className="text-xs font-medium text-fg-muted">
            Repository (optional)
          </label>
          <Input
            id={`${uid}-repo`}
            size="sm"
            placeholder="https://github.com/owner/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <p className="text-xs text-fg-subtle">Agents working in this repository file their memories under the project.</p>
        </div>
      )}
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
