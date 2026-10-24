import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "lojee-ui";
import { pendingCount } from "../../domain";
import { pendingIds, useBulkReview } from "../../components/useBulkReview";
import { useWorkspace } from "../../stores/workspaceStore";

/** Shown whenever changes are waiting for review: links to the Inbox and approves everything at once. */
export function InboxBar() {
  const state = useWorkspace((s) => s.state);
  const review = useBulkReview();
  const [notice, setNotice] = useState<string | null>(null);
  const count = state ? pendingCount(state) : 0;
  const [busy, setBusy] = useState(false);

  if (count === 0) return null;

  const onApproveAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      // Only the proposals visible at this render; later arrivals stay pending.
      const r = await review("approve", pendingIds(state));
      setNotice(r.notice ?? r.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Short Term Memory"
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="soft" color="amber" size="sm">
          {count} {count === 1 ? "change" : "changes"} waiting for review
        </Badge>
        <Link to="/inbox" className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg">
          Open Inbox
        </Link>
        <Button className="ml-auto" size="sm" icon="check" loading={busy} onClick={() => void onApproveAll()}>
          Approve all
        </Button>
      </div>
      {notice && (
        <p role="status" className="mt-2 text-xs text-fg-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
