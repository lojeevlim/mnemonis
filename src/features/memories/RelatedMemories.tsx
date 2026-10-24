import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Input, Select } from "lojee-ui";
import { listRelations, type Memory, type WorkspaceState } from "../../domain";
import { useAction } from "../../components/hooks";
import { useWorkspace } from "../../stores/workspaceStore";

const DEFAULT_LABEL = "related to";

interface Props {
  state: WorkspaceState;
  memory: Memory;
  memories: Memory[];
  onOpenMemory: (id: string) => void;
}

export function RelatedMemories({ state, memory, memories, onOpenMemory }: Props) {
  const addRelation = useWorkspace((s) => s.addRelation);
  const removeRelation = useWorkspace((s) => s.removeRelation);
  const act = useAction();
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState(DEFAULT_LABEL);

  const titles = useMemo(() => new Map(memories.map((m) => [m.id, m.title])), [memories]);
  const relations = useMemo(() => listRelations(state, memory.id), [state, memory.id]);
  const candidates = memories.filter((m) => m.id !== memory.id && !m.archived);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || !label.trim()) return;
    const { ok } = await act(() => addRelation(memory.id, target, label.trim()), "Relation added");
    if (ok) {
      setTarget("");
      setLabel(DEFAULT_LABEL);
    }
  };

  return (
    <div className="space-y-2">
      {relations.length === 0 ? (
        <p className="text-sm text-fg-muted">No related memories yet.</p>
      ) : (
        <ul className="space-y-1" aria-label="Related memories">
          {relations.map((r) => {
            const outgoing = r.fromId === memory.id;
            const otherId = outgoing ? r.toId : r.fromId;
            const otherTitle = titles.get(otherId) ?? otherId;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-subtle" aria-hidden="true">
                  {outgoing ? "→" : "←"}
                </span>
                <span className="text-xs text-fg-muted">{r.label}</span>
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-fg hover:underline"
                  onClick={() => onOpenMemory(otherId)}
                >
                  {otherTitle}
                </button>
                <Badge variant="outline" size="xs">
                  {r.provenance.origin}
                </Badge>
                {r.provenance.demo && (
                  <Badge variant="outline" size="xs" color="violet">
                    Demo
                  </Badge>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  icon="x"
                  iconOnly
                  label={`Remove relation to ${otherTitle}`}
                  onClick={() => void act(() => removeRelation(r.id), "Relation removed")}
                />
              </li>
            );
          })}
        </ul>
      )}
      {candidates.length > 0 && (
        <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <Select
              size="sm"
              aria-label="Memory to relate"
              placeholder="Relate to a memory…"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              options={candidates.map((m) => ({ value: m.id, label: m.title }))}
            />
          </div>
          <div className="w-36">
            <Input size="sm" aria-label="Relation label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="outline" icon="link" disabled={!target || !label.trim()}>
            Add relation
          </Button>
        </form>
      )}
    </div>
  );
}
