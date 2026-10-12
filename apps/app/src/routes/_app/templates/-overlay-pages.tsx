import type { OverlayRect } from "@necodoc/shared";
import { useEffect, useRef, useState } from "react";
import { openPdf, type PdfDocument, type PdfViewport } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";

// ADR 0017: pages render to canvases with pdf.js; boxes are laid over them. Boxes are stored in
// PDF user space (points, origin bottom-left); the viewport converts, rotation and crop included.

/** A box's place on screen, in CSS pixels from the page's top-left corner. */
export type ViewRect = { left: number; top: number; width: number; height: number };

export function toView(viewport: PdfViewport, r: OverlayRect): ViewRect {
  const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(r.x, r.y);
  const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(r.x + r.width, r.y + r.height);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function toPdf(viewport: PdfViewport, v: ViewRect): OverlayRect {
  const [ax = 0, ay = 0] = viewport.convertToPdfPoint(v.left, v.top);
  const [bx = 0, by = 0] = viewport.convertToPdfPoint(v.left + v.width, v.top + v.height);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    x: round(Math.min(ax, bx)),
    y: round(Math.min(ay, by)),
    width: Math.max(1, round(Math.abs(bx - ax))),
    height: Math.max(1, round(Math.abs(by - ay))),
  };
}

/** Opens the PDF once per URL and closes it when the editor goes. */
export function usePdfDocument(url: string) {
  const [state, setState] = useState<{ doc: PdfDocument | null; error: string | null }>({
    doc: null,
    error: null,
  });
  useEffect(() => {
    let doc: PdfDocument | null = null;
    let gone = false;
    setState({ doc: null, error: null });
    (async () => {
      const task = await openPdf(url);
      try {
        doc = await task.promise;
        if (gone) await task.destroy();
        else setState({ doc, error: null });
      } catch (error) {
        if (!gone)
          setState({ doc: null, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      gone = true;
      void doc?.loadingTask.destroy();
    };
  }, [url]);
  return state;
}

/** One page on a canvas at `scale` (CSS pixels per point), sharp on high-DPI screens. */
export function PageCanvas({
  doc,
  page,
  scale,
  onViewport,
  className,
}: {
  doc: PdfDocument;
  page: number;
  scale: number;
  onViewport?: (viewport: PdfViewport) => void;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reported = useRef(onViewport);
  reported.current = onViewport;
  useEffect(() => {
    let task: { cancel: () => void } | null = null;
    let gone = false;
    (async () => {
      const proxy = await doc.getPage(page);
      const node = canvas.current;
      if (gone || !node) return;
      const viewport = proxy.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      node.width = Math.floor(viewport.width * ratio);
      node.height = Math.floor(viewport.height * ratio);
      node.style.width = `${viewport.width}px`;
      node.style.height = `${viewport.height}px`;
      reported.current?.(viewport);
      const render = proxy.render({
        canvas: node,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      task = render;
      await render.promise.catch(() => {});
    })();
    return () => {
      gone = true;
      task?.cancel();
    };
  }, [doc, page, scale]);
  return <canvas ref={canvas} className={cn("block bg-white", className)} />;
}
