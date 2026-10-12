import type { BatchSummary } from "@necodoc/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md

type Counts = Pick<BatchSummary, "total" | "done" | "failed" | "cancelled">;

/** Rows not yet finished: queued or rendering. */
export const remaining = (b: Counts) => Math.max(0, b.total - b.done - b.failed - b.cancelled);

/**
 * The batch's status, with failures folded in: a finished batch with failed rows isn't shown
 * as a plain green "Completed".
 */
export function BatchStatusBadge({
  batch,
}: {
  batch: Pick<BatchSummary, "status" | "done" | "failed">;
}) {
  const { status, done, failed } = batch;
  if (status === "running")
    return (
      <Badge dot variant="run">
        Running
      </Badge>
    );
  if (status === "cancelled")
    return (
      <Badge dot variant="secondary">
        Cancelled
      </Badge>
    );
  if (failed > 0 && done === 0)
    return (
      <Badge dot variant="bad">
        Failed
      </Badge>
    );
  if (failed > 0)
    return (
      <Badge dot variant="warn">
        Completed, {failed.toLocaleString()} failed
      </Badge>
    );
  return (
    <Badge dot variant="ok">
      Completed
    </Badge>
  );
}

/** Rendered, failed and cancelled as one stacked bar, with the counts under it. */
export function BatchProgress({
  batch,
  counts = true,
  className,
}: {
  batch: Counts;
  /** The counts line under the bar; off where they're shown on their own. */
  counts?: boolean;
  className?: string;
}) {
  const { total, done, failed, cancelled } = batch;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const finished = done + failed + cancelled;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="progressbar"
        aria-label="Rows finished"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={finished}
        aria-valuetext={`${finished} of ${total} rows finished`}
        className="flex h-2 overflow-hidden rounded-full bg-tint-2"
      >
        <div className="bg-brand" style={{ width: pct(done) }} />
        <div className="bg-bad" style={{ width: pct(failed) }} />
        <div className="bg-ink-3/40" style={{ width: pct(cancelled) }} />
      </div>
      {counts && (
        <div className="text-xs text-ink-3 tabular-nums">
          {done.toLocaleString()} of {total.toLocaleString()} rendered
          {failed > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-bad">{failed.toLocaleString()} failed</span>
            </>
          )}
          {cancelled > 0 && ` · ${cancelled.toLocaleString()} cancelled`}
        </div>
      )}
    </div>
  );
}
