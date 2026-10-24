import { Badge } from "lojee-ui";
import type { MemoryStatus } from "../domain";
import { STATUS_META } from "./memoryMeta";

export function StatusBadge({ status }: { status: MemoryStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="soft" color={meta.color} size="sm">
      {meta.label}
    </Badge>
  );
}
