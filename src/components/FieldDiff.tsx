import { FIELD_LABEL, type FieldChange, type MemoryFieldValue } from "../domain";

export function showValue(v: MemoryFieldValue | undefined): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** A collectionId as the user should read it: the collection name, "No collection" for null, never a raw id. */
export function collectionLabel(
  collections: Record<string, { name: string }>,
  v: MemoryFieldValue | undefined,
): string {
  if (v === undefined) return "—";
  if (v === null) return "No collection";
  return typeof v === "string" && Object.hasOwn(collections, v) ? collections[v].name : "Unknown collection";
}

/** A projectId as the user should read it: the project name, "No project" for null, never a raw id. */
export function projectLabel(projects: Record<string, { name: string }>, v: MemoryFieldValue | undefined): string {
  if (v === undefined) return "—";
  if (v === null) return "No project";
  return typeof v === "string" && Object.hasOwn(projects, v) ? projects[v].name : "Unknown project";
}

interface FieldDiffProps {
  changes: FieldChange[];
  /** When given, collectionId values are shown as the collection name instead of the raw id. */
  collections?: Record<string, { name: string }>;
  /** When given, projectId values are shown as the project name instead of the raw id. */
  projects?: Record<string, { name: string }>;
}

export function FieldDiff({ changes, collections, projects }: FieldDiffProps) {
  const show = (field: string, v: MemoryFieldValue | undefined) =>
    field === "collectionId" && collections
      ? collectionLabel(collections, v)
      : field === "projectId" && projects
        ? projectLabel(projects, v)
        : showValue(v);
  if (changes.length === 0) return <p className="text-xs text-fg-muted">No differences.</p>;
  return (
    <div className="space-y-2">
      {changes.map((c) => (
        <div key={c.field} className="rounded-md border border-border">
          <div className="border-b border-border px-2 py-1 text-xs font-medium text-fg-muted">{FIELD_LABEL[c.field]}</div>
          {c.lines ? (
            <pre className="overflow-x-auto p-2 font-mono text-xs leading-relaxed" aria-label="Content diff">
              {c.lines.map((l, i) => (
                <div
                  key={i}
                  data-diff={l.type}
                  className={
                    l.type === "add"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : l.type === "remove"
                        ? "bg-rose-500/15 text-rose-300"
                        : "text-fg-muted"
                  }
                >
                  <span aria-hidden="true" className="select-none pr-2">
                    {l.type === "add" ? "+" : l.type === "remove" ? "-" : " "}
                  </span>
                  <span className="sr-only">{l.type === "add" ? "Added: " : l.type === "remove" ? "Removed: " : ""}</span>
                  {l.text || " "}
                </div>
              ))}
            </pre>
          ) : (
            <div className="space-y-0.5 p-2 text-xs">
              <div className="bg-rose-500/15 px-1 text-rose-300">
                <span aria-hidden="true">- </span>
                {show(c.field, c.before)}
              </div>
              <div className="bg-emerald-500/15 px-1 text-emerald-300">
                <span aria-hidden="true">+ </span>
                {show(c.field, c.after)}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
