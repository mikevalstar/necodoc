import type { BatchStatus } from "@necodoc/shared";
import { Badge } from "@/components/ui/badge";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md

const labels = {
  running: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
} satisfies Record<BatchStatus, string>;

const variants = {
  running: "run",
  completed: "ok",
  cancelled: "secondary",
} as const satisfies Record<BatchStatus, string>;

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <Badge dot variant={variants[status]}>
      {labels[status]}
    </Badge>
  );
}

/** Done, failed and cancelled as one stacked bar. */
export function BatchProgress({
  total,
  done,
  failed,
  cancelled,
}: {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
}) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-tint">
        <div className="bg-brand" style={{ width: pct(done) }} />
        <div className="bg-bad" style={{ width: pct(failed) }} />
        <div className="bg-ink-3/40" style={{ width: pct(cancelled) }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {done} done · {failed} failed{cancelled > 0 && ` · ${cancelled} cancelled`} · {total} total
      </div>
    </div>
  );
}
