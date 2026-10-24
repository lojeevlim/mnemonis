import { Badge } from "lojee-ui";
import type { Origin } from "../domain";
import { ORIGIN_META } from "./memoryMeta";

/** Who a change came from: you, an agent, an import or the system. */
export function OriginBadge({ origin }: { origin: Origin }) {
  const meta = ORIGIN_META[origin];
  return (
    <Badge variant="outline" size="xs" color={meta.color}>
      {meta.label}
    </Badge>
  );
}
