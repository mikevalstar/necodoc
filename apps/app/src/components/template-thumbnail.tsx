import type { TemplateSummary } from "@necodoc/shared";
import { FileTextIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { templateThumbnailUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

// Spec: docs/features/document-templates.md (templates list). Page 1 of a template on a white
// sheet with ears (the sheet-ears motif), cropped to the top of the page. Loads lazily, so a list
// of hundreds only fetches what scrolls into view.

type Props = {
  template: Pick<TemplateSummary, "id" | "kind" | "thumbnail">;
  className?: string;
};

export function TemplateThumbnail({ template, className }: Props) {
  const src = templateThumbnailUrl(template.id, template.thumbnail);
  // Keyed by URL, so a new publish shows the skeleton again rather than the old outcome.
  const [outcome, setOutcome] = useState<{ src: string; ok: boolean } | null>(null);
  const state = outcome?.src !== src ? "loading" : outcome.ok ? "loaded" : "failed";
  return (
    <div
      className={cn(
        "flex h-36 items-end justify-center overflow-hidden bg-tint pt-6",
        template.kind === "overlay" && "bg-sun-wash",
        className,
      )}
    >
      <div className="sheet-ears h-full w-[56%] max-w-48">
        <div className="relative h-full overflow-hidden">
          {state !== "failed" && (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              width={360}
              height={466}
              onLoad={() => setOutcome({ src, ok: true })}
              onError={() => setOutcome({ src, ok: false })}
              className={cn(
                "h-auto w-full transition-opacity",
                state === "loaded" ? "opacity-100" : "opacity-0",
              )}
            />
          )}
          {state === "loading" && (
            <div aria-hidden className="absolute inset-0 space-y-2 p-4">
              <div className="mx-auto h-2 w-2/3 animate-pulse rounded-full bg-tint-2" />
              <div className="h-1.5 animate-pulse rounded-full bg-tint" />
              <div className="h-1.5 animate-pulse rounded-full bg-tint" />
              <div className="h-1.5 w-4/5 animate-pulse rounded-full bg-tint" />
            </div>
          )}
          {state === "failed" && (
            <FileTextIcon
              aria-hidden
              className="absolute inset-0 m-auto size-8 text-ink-3 opacity-40"
            />
          )}
        </div>
      </div>
    </div>
  );
}
