import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The cobalt preview tray: the PDF sits in the mark's ears (docs/features/design-system.md).
 * `toolbar` is the strip above the well (status, zoom, sample picker); white text on cobalt.
 * Use it for any PDF preview, e.g. the overlay editor's canvas pages.
 */
export function PdfTray({
  toolbar,
  className,
  wellClassName,
  children,
}: {
  toolbar?: ReactNode;
  className?: string;
  wellClassName?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label="PDF preview" className={cn("pdf-tray", className)}>
      {toolbar ? (
        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3.5 pt-1.5 pb-2.5 text-[13px]">
          {toolbar}
        </div>
      ) : (
        <div className="h-2.5" />
      )}
      <div className={cn("pdf-tray-well", wellClassName)}>{children}</div>
    </section>
  );
}

/** Shows a PDF with the browser's viewer in the preview tray. Blobs get an object URL that's revoked when replaced. */
export function PdfFrame({
  pdf,
  title,
  toolbar,
  className,
}: {
  pdf: Blob | string;
  title: string;
  toolbar?: ReactNode;
  /** Sizes the viewer, e.g. its height. */
  className?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (typeof pdf === "string") return;
    const url = URL.createObjectURL(pdf);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);
  const url = typeof pdf === "string" ? pdf : blobUrl;
  // Chromium's viewer: no thumbnail sidebar, fit to width.
  const src = url && `${url}#navpanes=0&view=FitH`;
  return (
    <PdfTray toolbar={toolbar}>
      <iframe title={title} src={src} className={cn("block h-[70svh] w-full", className)} />
    </PdfTray>
  );
}

/**
 * Runs `render` once `request` has been unchanged for `delayMs`. Pass null while the input is
 * invalid; the last good preview stays up. The request is the cache key, so it should say what
 * it renders (e.g. include the template id), and `render` must not log a generation.
 */
export function usePdfPreview<T, R extends { pdf: Blob }>(
  request: T | null,
  render: (request: T) => Promise<R>,
  delayMs = 600,
) {
  const key = JSON.stringify(request);
  const [settled, setSettled] = useState({ key, request });
  useEffect(() => {
    // Callers may pass a new but equal object each render: only a changed key replaces it.
    const timer = setTimeout(
      () => setSettled((prev) => (prev.key === key ? prev : { key, request })),
      delayMs,
    );
    return () => clearTimeout(timer);
  }, [key, request, delayMs]);
  const settledRequest = settled.request;
  return useQuery({
    queryKey: ["render-preview", settled.key],
    queryFn: settledRequest ? () => render(settledRequest) : skipToken,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}
