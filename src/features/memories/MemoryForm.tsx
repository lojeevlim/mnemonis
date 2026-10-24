import { useId, useMemo, useState, type FormEvent } from "react";
import { Button, Input, Select, TagInput, Textarea } from "lojee-ui";
import { BUILT_IN_MEMORY_TYPES, type Collection } from "../../domain";
import { typeLabel } from "../../components/memoryMeta";

export interface MemoryFormValues {
  title: string;
  content: string;
  type: string;
  tags: string[];
  collectionId: string | null;
}

const CUSTOM = "__custom__";
const NO_COLLECTION = "";

interface Props {
  initial?: Partial<MemoryFormValues>;
  collections: Collection[];
  /** Custom types already used in the workspace, offered as options. */
  knownTypes?: string[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: MemoryFormValues) => void;
  onCancel: () => void;
}

export function MemoryForm({ initial, collections, knownTypes = [], submitLabel, busy, onSubmit, onCancel }: Props) {
  const uid = useId();
  const initialType = initial?.type ?? "fact";
  const typeValues = useMemo(() => {
    const extra = [...new Set([...knownTypes, initialType])].filter(
      (t) => !(BUILT_IN_MEMORY_TYPES as readonly string[]).includes(t),
    );
    return [...BUILT_IN_MEMORY_TYPES, ...extra] as string[];
  }, [knownTypes, initialType]);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [typeChoice, setTypeChoice] = useState(initialType);
  const [customType, setCustomType] = useState("");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [collectionId, setCollectionId] = useState<string>(initial?.collectionId ?? NO_COLLECTION);
  const [submitted, setSubmitted] = useState(false);

  const type = (typeChoice === CUSTOM ? customType : typeChoice).trim();
  const titleInvalid = submitted && !title.trim();
  const typeInvalid = submitted && !type;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!title.trim() || !type) return;
    onSubmit({ title: title.trim(), content, type, tags, collectionId: collectionId || null });
  };

  const field = "flex flex-col gap-1";
  const labelClass = "text-xs font-medium text-fg-muted";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className={field}>
        <label htmlFor={`${uid}-title`} className={labelClass}>
          Title
        </label>
        <Input
          id={`${uid}-title`}
          size="sm"
          value={title}
          invalid={titleInvalid}
          onChange={(e) => setTitle(e.target.value)}
          aria-describedby={titleInvalid ? `${uid}-title-err` : undefined}
          autoFocus
        />
        {titleInvalid && (
          <p id={`${uid}-title-err`} role="alert" className="text-xs text-rose-400">
            Title is required.
          </p>
        )}
      </div>

      <div className={field}>
        <label htmlFor={`${uid}-content`} className={labelClass}>
          Content (Markdown)
        </label>
        <Textarea
          id={`${uid}-content`}
          rows={8}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <label htmlFor={`${uid}-type`} className={labelClass}>
            Type
          </label>
          <Select
            id={`${uid}-type`}
            size="sm"
            value={typeChoice}
            onChange={(e) => setTypeChoice(e.target.value)}
            options={[
              ...typeValues.map((t) => ({ value: t, label: typeLabel(t) })),
              { value: CUSTOM, label: "Custom type…" },
            ]}
          />
          {typeChoice === CUSTOM && (
            <Input
              size="sm"
              aria-label="Custom type"
              placeholder="e.g. recipe"
              value={customType}
              invalid={typeInvalid}
              onChange={(e) => setCustomType(e.target.value)}
            />
          )}
          {typeInvalid && (
            <p role="alert" className="text-xs text-rose-400">
              Enter a type name.
            </p>
          )}
        </div>
        <div className={field}>
          <label htmlFor={`${uid}-collection`} className={labelClass}>
            Collection
          </label>
          <Select
            id={`${uid}-collection`}
            size="sm"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            options={[
              { value: NO_COLLECTION, label: "No collection" },
              ...collections.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </div>

      <div className={field} role="group" aria-labelledby={`${uid}-tags`}>
        <span id={`${uid}-tags`} className={labelClass}>
          Tags (press Enter to add)
        </span>
        <TagInput value={tags} onChange={setTags} placeholder="Add a tag" />
      </div>

      <div className="flex justify-end gap-2 pt-1">
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
