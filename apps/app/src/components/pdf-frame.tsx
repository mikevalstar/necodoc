import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Shows a PDF with the browser's viewer. Blobs get an object URL that's revoked when replaced. */
export function PdfFrame({
  pdf,
  title,
  className,
}: {
  pdf: Blob | string;
  title: string;
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
    <iframe
      title={title}
      src={src}
      className={cn("h-[70svh] w-full rounded-lg border bg-muted", className)}
    />
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
