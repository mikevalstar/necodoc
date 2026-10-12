import {
  acceptSuggestions,
  type DetectedField,
  detectionStatusSchema,
  type FieldSection,
  importAcroFields,
  MAX_FILE_BYTES,
  newBoxId,
  type OverlayBox,
  type OverlayBoxType,
  type OverlayContent,
  overlayBoxSchema,
  overlayBoxTypes,
  type PdfSource,
  pdfSourceSchema,
  signingKindLabels,
} from "@necodoc/shared";
import {
  CheckIcon,
  FileArrowDownIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SuggestButton, useAiEnabled } from "@/components/ai";
import { ErrorAlert } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ok, pdfSourceUrl } from "@/lib/api";
import type { PdfViewport } from "@/lib/pdfjs";
import { cn, plural } from "@/lib/utils";
import { BoxInspector, boxTypeLabels } from "./-box-inspector";
import { PageCanvas, toPdf, toView, usePdfDocument, type ViewRect } from "./-overlay-pages";

// Spec: docs/features/pdf-overlay-templates.md. The placement editor for overlay templates: page
// thumbnails, the page with its boxes, and the inspector; AcroForm import and AI suggestions.

export const pdfSourceQuery = (id: string) =>
  queryOptions({
    queryKey: ["pdf-sources", id],
    queryFn: async () =>
      pdfSourceSchema.parse(
        await (await ok(api["pdf-sources"][":id"].$get({ param: { id } }))).json(),
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** Uploads a PDF to fill (checked and read by the API, ADR 0028). */
export async function uploadPdfSource(file: File): Promise<PdfSource> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 20 MB`);
  return pdfSourceSchema.parse(
    await (await ok(api["pdf-sources"].$post({ form: { file } }))).json(),
  );
}

type Point = { x: number; y: number };
/** A resize handle: a corner or the middle of an edge. */
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Drag =
  | { kind: "draw"; start: Point; now: Point }
  | { kind: "move"; id: string; start: Point; now: Point; from: ViewRect }
  | { kind: "resize"; id: string; corner: Handle; start: Point; now: Point; from: ViewRect };

/** The rectangle a drag describes so far, in view pixels. */
function dragRect(drag: Drag): ViewRect {
  const dx = drag.now.x - drag.start.x;
  const dy = drag.now.y - drag.start.y;
  if (drag.kind === "draw") {
    return {
      left: Math.min(drag.start.x, drag.now.x),
      top: Math.min(drag.start.y, drag.now.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
  }
  const f = drag.from;
  if (drag.kind === "move") return { ...f, left: f.left + dx, top: f.top + dy };
  const left = drag.corner.endsWith("w") ? f.left + dx : f.left;
  const right = drag.corner.endsWith("e") ? f.left + f.width + dx : f.left + f.width;
  const top = drag.corner.startsWith("n") ? f.top + dy : f.top;
  const bottom = drag.corner.startsWith("s") ? f.top + f.height + dy : f.top + f.height;
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.max(2, Math.abs(right - left)),
    height: Math.max(2, Math.abs(bottom - top)),
  };
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Overlap over union of two PDF rects. */
function iou(a: OverlayBox["rect"], b: OverlayBox["rect"]) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
}

type Tone = "brand" | "ok" | "warn";
/**
 * Box colours by what the box does. Labels on the page use shell navy, dark in both themes, so
 * they read on the white paper; the selected box's tag is solid.
 */
const tones: Record<Tone, { box: string; tag: string; legend: string }> = {
  brand: {
    box: "border-brand bg-brand/12 hover:bg-brand/25 ring-brand/35",
    tag: "bg-brand text-on-brand",
    legend: "Drawn on the page",
  },
  ok: {
    box: "border-ok bg-ok/12 hover:bg-ok/25 ring-ok/35",
    tag: "bg-ok text-card",
    legend: "Fills a PDF form field",
  },
  warn: {
    box: "border-warn bg-warn/15 hover:bg-warn/30 ring-warn/35",
    tag: "bg-warn text-card",
    legend: "Left blank for a signer",
  },
};
const toneOf = (box: OverlayBox): Tone =>
  box.type === "signature" && box.signerId ? "warn" : box.acroField ? "ok" : "brand";

const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const satisfies readonly Handle[];
const handleClasses: Record<Handle, string> = {
  nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
  n: "-top-1.5 left-1/2 -ml-1.5 cursor-ns-resize",
  ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
  e: "top-1/2 -right-1.5 -mt-1.5 cursor-ew-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
  s: "-bottom-1.5 left-1/2 -ml-1.5 cursor-ns-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  w: "top-1/2 -left-1.5 -mt-1.5 cursor-ew-resize",
};

const shortcuts = [
  ["Arrows", "Nudge 1 pt (Shift: 10 pt)"],
  ["⌘D", "Duplicate"],
  ["Delete", "Remove"],
  ["Esc", "Deselect"],
  ["Tab", "Next box on the page"],
] as const;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md bg-tint px-1 py-px font-mono text-[11px] text-ink-2">{children}</kbd>
  );
}

const boxName = (box: OverlayBox) =>
  box.type === "signature" && box.signerId
    ? `${signingKindLabels[box.signingKind ?? "signature"]} · ${box.signerId}`
    : box.value.replace(/[{}]|\|.*$/g, "").trim() || box.acroField || boxTypeLabels[box.type];

const boxLabel = (box: OverlayBox) =>
  box.type === "signature" && box.signerId
    ? `${boxTypeLabels[box.type]}: ${boxName(box)}`
    : `${boxTypeLabels[box.type]}: ${box.value || "(no value)"}${box.acroField ? ` → form field ${box.acroField}` : ""}`;

type Suggestion = DetectedField & { sid: string };

/** AI detection (ADR 0028): queue a job, poll it, keep its suggestions until reviewed. */
function useDetection(sourceId: string, sections: readonly FieldSection[]) {
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      const fields = sections.flatMap((s) => s.fields.map((f) => ({ key: f.key, label: f.label })));
      const res = await ok(
        api["pdf-sources"][":id"].detect.$post({ param: { id: sourceId }, json: { fields } }),
      );
      return (await res.json()).jobId;
    },
    onSuccess: setJobId,
  });
  const job = useQuery({
    queryKey: ["detect", jobId],
    queryFn: async () =>
      detectionStatusSchema.parse(
        await (
          await ok(
            api["pdf-sources"][":id"].detect[":jobId"].$get({
              param: { id: sourceId, jobId: jobId ?? "" },
            }),
          )
        ).json(),
      ),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" || !query.state.data ? 1500 : false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const running =
    start.isPending || (jobId !== null && (!job.data || job.data.status === "pending"));
  return { start, job: job.data, error: start.error ?? job.error, running, jobId };
}

export function OverlayEditor({
  content,
  sections,
  editable,
  onChange,
}: {
  content: OverlayContent;
  sections: FieldSection[];
  editable: boolean;
  onChange: (changes: { content?: OverlayContent; sections?: FieldSection[] }) => void;
}) {
  const source = useQuery(pdfSourceQuery(content.sourceId));
  const { doc, error: pdfError } = usePdfDocument(pdfSourceUrl(content.sourceId));
  const aiEnabled = useAiEnabled();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(600);
  const [viewport, setViewport] = useState<PdfViewport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [newType, setNewType] = useState<OverlayBoxType>("text");
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const detection = useDetection(content.sourceId, sections);

  const pages = source.data?.pages ?? [];
  const pageInfo = pages[page - 1];
  const pageWidth = pageInfo
    ? pageInfo.rotate % 180 === 0
      ? pageInfo.view[2] - pageInfo.view[0]
      : pageInfo.view[3] - pageInfo.view[1]
    : 612;
  const scale = zoom === "fit" ? Math.max(0.3, width / pageWidth) : zoom * (4 / 3);

  useEffect(() => {
    const node = area.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A finished detection hands its suggestions over once.
  const done = detection.job?.status === "done" ? detection.job.result : null;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!done || handled.current === detection.jobId) return;
    handled.current = detection.jobId;
    setSuggestions(done.fields.map((f, i) => ({ ...f, sid: `s${i}` })));
    setNotice(
      `${plural(done.fields.length, "suggestion")} from ${plural(done.pagesSent, "page")} in ${(done.ms / 1000).toFixed(0)} s` +
        (done.pagesSkipped ? `; ${plural(done.pagesSkipped, "page")} had no lines or boxes` : "") +
        (done.pagesNotChecked
          ? `; ${plural(done.pagesNotChecked, "page")} past the limit weren't checked`
          : ""),
    );
  }, [done, detection.jobId]);

  const setBoxes = (boxes: OverlayBox[]) => onChange({ content: { ...content, boxes } });
  const updateBox = (box: OverlayBox) =>
    setBoxes(content.boxes.map((b) => (b.id === box.id ? box : b)));
  const selectedBox = content.boxes.find((b) => b.id === selected) ?? null;

  // Suggestions that land on a box the template already has are noise; hide them.
  const fresh = useMemo(
    () =>
      suggestions.filter(
        (s) => !content.boxes.some((b) => b.page === s.page && iou(b.rect, s.rect) > 0.5),
      ),
    [suggestions, content.boxes],
  );
  const accept = (accepted: Suggestion[]) => {
    const result = acceptSuggestions(accepted, sections, content.boxes);
    onChange({ content: { ...content, boxes: result.boxes }, sections: result.sections });
    const ids = new Set(accepted.map((s) => s.sid));
    setSuggestions((all) => all.filter((s) => !ids.has(s.sid)));
  };
  const reject = (sids: string[]) =>
    setSuggestions((all) => all.filter((s) => !sids.includes(s.sid)));

  const unmapped = (source.data?.fields ?? []).filter(
    (f) => f.type !== "button" && !f.readOnly && !content.boxes.some((b) => b.acroField === f.name),
  );
  const importFields = () => {
    if (!source.data) return;
    const result = importAcroFields(source.data.fields, sections, content.boxes);
    onChange({ content: { ...content, boxes: result.boxes }, sections: result.sections });
    setNotice(`Imported ${result.added} form fields as boxes and fields.`);
  };

  const pointAt = (e: React.PointerEvent): Point => {
    const r = layer.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const startDrag = (e: React.PointerEvent, next: Drag) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    layer.current?.setPointerCapture(e.pointerId);
    setDrag(next);
  };
  const endDrag = () => {
    if (!drag || !viewport) return setDrag(null);
    const view = dragRect(drag);
    if (drag.kind === "draw") {
      if (view.width >= 6 && view.height >= 6) {
        const box = overlayBoxSchema.parse({
          type: newType,
          id: newBoxId(),
          page,
          rect: toPdf(viewport, view),
          value: "",
        });
        setBoxes([...content.boxes, box]);
        setSelected(box.id);
      } else setSelected(null);
    } else {
      const box = content.boxes.find((b) => b.id === drag.id);
      const moved = drag.now.x !== drag.start.x || drag.now.y !== drag.start.y;
      if (box && moved) updateBox({ ...box, rect: toPdf(viewport, view) });
    }
    setDrag(null);
  };

  /** Moves or copies in screen directions, so arrows match what you see on rotated pages. */
  const shifted = (box: OverlayBox, dx: number, dy: number) => {
    if (!viewport) return box.rect;
    const view = toView(viewport, box.rect);
    return toPdf(viewport, { ...view, left: view.left + dx * scale, top: view.top + dy * scale });
  };
  const duplicate = (box: OverlayBox) => {
    const copy = { ...box, id: newBoxId(), rect: shifted(box, 10, 10) };
    setBoxes([...content.boxes, copy]);
    setSelected(copy.id);
  };
  const remove = (id: string) => {
    setBoxes(content.boxes.filter((b) => b.id !== id));
    setSelected(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys come from the page itself or a focused box, never from the inspector.
    const fromBox = e.target instanceof HTMLElement && e.target.dataset.box !== undefined;
    if ((e.target !== e.currentTarget && !fromBox) || !selectedBox || !editable) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      updateBox({ ...selectedBox, rect: shifted(selectedBox, move[0], move[1]) });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(selectedBox.id);
    } else if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      duplicate(selectedBox);
    } else if (e.key === "Escape") setSelected(null);
  };

  if (source.error || pdfError) {
    return (
      <ErrorAlert error={source.error ?? new Error(`The PDF couldn't be shown: ${pdfError}`)} />
    );
  }

  const onPage = content.boxes.filter((b) => b.page === page);
  const suggested = fresh.filter((s) => s.page === page);
  const approximate = fresh.filter((s) => !s.anchored).length;
  // While a drag changes something, show where it lands in points.
  const dragging =
    drag && (drag.kind === "draw" || drag.now.x !== drag.start.x || drag.now.y !== drag.start.y);
  const readout =
    dragging && viewport ? { view: dragRect(drag), pdf: toPdf(viewport, dragRect(drag)) } : null;

  return (
    <div className="space-y-3">
      {detection.running && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-3">
          <Badge variant="run" dot>
            Detecting
          </Badge>
          Reading the pages with Claude: about 5 to 10 seconds a page.
        </p>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert
        error={
          detection.error ??
          (detection.job?.status === "failed" ? new Error(detection.job.error) : null)
        }
      />

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_15rem] lg:grid-cols-[5.5rem_minmax(0,1fr)_17rem]">
        <nav
          aria-label="Pages"
          className="flex gap-2 overflow-auto p-1 md:col-span-2 lg:col-span-1 lg:max-h-[78svh] lg:flex-col"
        >
          {doc
            ? pages.map((_, i) => {
                const n = i + 1;
                const count = content.boxes.filter((b) => b.page === n).length;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-current={n === page ? "page" : undefined}
                    aria-label={`Page ${n}, ${plural(count, "box", "boxes")}`}
                    onClick={() => setPage(n)}
                    className={cn(
                      "shrink-0 rounded-lg bg-card p-1.5 text-xs text-ink-3 shadow-card transition-colors hover:bg-tint",
                      n === page &&
                        "bg-brand-wash text-brand-ink ring-2 ring-brand hover:bg-brand-wash",
                    )}
                  >
                    <PageCanvas doc={doc} page={n} scale={0.12} className="mx-auto shadow-xs" />
                    <span className="mt-1 flex items-center justify-center gap-1 font-medium tabular-nums">
                      {n}
                      {count > 0 && (
                        <span className="rounded-full bg-tint-2 px-1.5 text-[10px] text-ink-2">
                          {count}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            : [0, 1].map((i) => <Skeleton key={i} className="h-28 w-20 shrink-0 lg:w-full" />)}
        </nav>

        <Card className="min-w-0 gap-0 py-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-hair px-3 py-2.5">
            {editable && (
              <NativeSelect
                size="sm"
                aria-label="New box type"
                title="Drag on the page to draw a box of this type"
                value={newType}
                onChange={(e) => {
                  const type = overlayBoxTypes.find((t) => t === e.target.value);
                  if (type) setNewType(type);
                }}
              >
                {overlayBoxTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    Draw: {boxTypeLabels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            {editable && unmapped.length > 0 && (
              <Button variant="secondary" size="sm" onClick={importFields}>
                <FileArrowDownIcon />
                Import form fields ({unmapped.length})
              </Button>
            )}
            {editable && aiEnabled && (
              <Button
                variant="secondary"
                size="sm"
                disabled={detection.running}
                title="Sends the page images to Anthropic (Claude). Suggestions only; review each one."
                onClick={() => {
                  setNotice(null);
                  detection.start.mutate();
                }}
              >
                <SparkleIcon />
                {detection.running ? "Detecting…" : "Detect with AI"}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-3 tabular-nums">
                Page {page} of {pages.length || 1}
              </span>
              <div className="flex items-center rounded-lg bg-tint p-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom out"
                  onClick={() =>
                    setZoom(
                      ZOOMS.filter((z) => z * (4 / 3) < scale - 0.01).at(-1) ?? ZOOMS[0] ?? 0.5,
                    )
                  }
                >
                  <MagnifyingGlassMinusIcon weight="bold" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="min-w-12 tabular-nums"
                  title="Fit to width"
                  aria-label={`Zoom ${zoom === "fit" ? "fits the width" : `${Math.round(zoom * 100)}%`}; fit to width`}
                  onClick={() => setZoom("fit")}
                >
                  {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom in"
                  onClick={() => setZoom(ZOOMS.find((z) => z * (4 / 3) > scale + 0.01) ?? 3)}
                >
                  <MagnifyingGlassPlusIcon weight="bold" />
                </Button>
              </div>
            </div>
          </div>

          <div ref={area} className="min-w-0 overflow-auto bg-tint p-4 lg:max-h-[72svh]">
            {doc ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: the page and its boxes take arrow keys, Delete and ⌘D for the selected box
              <div
                // .paper: boxes keep their light-mode colours on the white page in dark mode.
                className="paper relative mx-auto w-fit shadow-card"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
                tabIndex={0}
                onKeyDown={onKeyDown}
              >
                <PageCanvas doc={doc} page={page} scale={scale} onViewport={setViewport} />
                {viewport && (
                  <div
                    ref={layer}
                    className={cn("absolute inset-0", editable && "cursor-crosshair")}
                    onPointerDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      const at = pointAt(e);
                      startDrag(e, { kind: "draw", start: at, now: at });
                      if (!editable) setSelected(null);
                    }}
                    onPointerMove={(e) => drag && setDrag({ ...drag, now: pointAt(e) })}
                    onPointerUp={endDrag}
                  >
                    {onPage.map((box) => {
                      const moving = drag && drag.kind !== "draw" && drag.id === box.id;
                      const r = moving ? dragRect(drag) : toView(viewport, box.rect);
                      const isSelected = box.id === selected;
                      const look = tones[toneOf(box)];
                      return (
                        <button
                          key={box.id}
                          type="button"
                          data-box={box.id}
                          aria-pressed={isSelected}
                          aria-label={boxLabel(box)}
                          title={boxLabel(box)}
                          className={cn(
                            "absolute rounded-[2px] border-[1.5px] p-0 text-left",
                            editable ? "cursor-move" : "cursor-pointer",
                            look.box,
                            isSelected && "z-10 border-2 ring-3",
                          )}
                          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                          onFocus={() => setSelected(box.id)}
                          onPointerDown={(e) => {
                            setSelected(box.id);
                            const at = pointAt(e);
                            startDrag(e, { kind: "move", id: box.id, start: at, now: at, from: r });
                          }}
                        >
                          <span className="pointer-events-none block max-h-full truncate px-0.5 text-[10px] leading-[12px] font-medium text-shell">
                            {boxName(box)}
                          </span>
                          {isSelected && (
                            <span
                              className={cn(
                                "pointer-events-none absolute bottom-full left-[-1.5px] mb-1 max-w-64 truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap shadow-card",
                                look.tag,
                              )}
                            >
                              {boxTypeLabels[box.type]} · {boxName(box)}
                            </span>
                          )}
                          {isSelected &&
                            editable &&
                            handles
                              .filter(
                                (h) =>
                                  h.length === 2 ||
                                  ((h === "n" || h === "s") && r.width >= 40) ||
                                  ((h === "e" || h === "w") && r.height >= 40),
                              )
                              .map((handle) => (
                                <span
                                  key={handle}
                                  aria-hidden="true"
                                  className={cn(
                                    "absolute size-3 rounded-[3px] border-[1.5px] border-brand bg-white shadow-xs",
                                    handleClasses[handle],
                                  )}
                                  onPointerDown={(e) => {
                                    const at = pointAt(e);
                                    startDrag(e, {
                                      kind: "resize",
                                      id: box.id,
                                      corner: handle,
                                      start: at,
                                      now: at,
                                      from: r,
                                    });
                                  }}
                                />
                              ))}
                        </button>
                      );
                    })}
                    {suggested.map((s) => {
                      const r = toView(viewport, s.rect);
                      return (
                        <button
                          key={s.sid}
                          type="button"
                          aria-pressed={picked === s.sid}
                          title={`Suggested ${s.type}: ${s.label} (${s.key})${s.anchored ? "" : ", approximate"}`}
                          className={cn(
                            "absolute rounded-[2px] border-2 border-dashed p-0 text-left",
                            s.anchored ? "border-sun bg-sun/20" : "border-bad bg-bad/10",
                            picked === s.sid && "z-10 border-solid ring-3 ring-sun/50",
                          )}
                          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => setPicked(s.sid)}
                        >
                          <span className="block max-h-full truncate px-0.5 text-[10px] leading-[12px] font-medium text-shell">
                            {s.anchored ? "" : "≈ "}
                            {s.key}
                          </span>
                        </button>
                      );
                    })}
                    {drag?.kind === "draw" && (
                      <div
                        className="pointer-events-none absolute rounded-[2px] border-[1.5px] border-dashed border-brand bg-brand/10"
                        style={dragRect(drag)}
                      />
                    )}
                    {readout && (
                      <div
                        className="pointer-events-none absolute z-20 rounded-md bg-ink px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-card shadow-float"
                        style={{
                          left: readout.view.left,
                          top: readout.view.top + readout.view.height + 6,
                        }}
                      >
                        x {Math.round(readout.pdf.x)} · y {Math.round(readout.pdf.y)} ·{" "}
                        {Math.round(readout.pdf.width)} × {Math.round(readout.pdf.height)} pt
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Skeleton className="mx-auto aspect-[17/22] w-full max-w-xl bg-tint-2">
                <span className="sr-only">Loading the PDF…</span>
              </Skeleton>
            )}
          </div>
        </Card>

        <aside className="space-y-3 lg:max-h-[78svh] lg:overflow-auto lg:p-1">
          {fresh.length > 0 && (
            <Card size="sm" className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <SparkleIcon className="text-sun-ink" />
                  AI suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{fresh.length} to review</Badge>
                  {approximate > 0 && <Badge variant="bad">{approximate} approximate</Badge>}
                </div>
                <p className="text-xs text-ink-3">
                  Check each one. Approximate (≈) boxes didn't line up with a printed line or box.
                  Keys and labels are guesses.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="sun"
                    disabled={!editable || fresh.every((s) => !s.anchored)}
                    onClick={() => accept(fresh.filter((s) => s.anchored))}
                  >
                    Accept all{approximate > 0 ? " but approximate" : ""}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => reject(fresh.map((s) => s.sid))}>
                    Reject all
                  </Button>
                </div>
                <ul className="-mx-1 space-y-0.5">
                  {fresh.map((s) => (
                    <li
                      key={s.sid}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-1 text-xs",
                        picked === s.sid && "bg-sun-wash",
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate py-1 text-left"
                        onClick={() => {
                          setPage(s.page);
                          setPicked(s.sid);
                        }}
                      >
                        <span className="font-mono text-ink-3">p{s.page}</span> {s.label}{" "}
                        <span className="font-mono text-ink-3">{s.key}</span>
                      </button>
                      {!s.anchored && (
                        <Badge variant="bad" title="Approximate">
                          ≈
                        </Badge>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Accept ${s.key}`}
                        disabled={!editable}
                        onClick={() => accept([s])}
                      >
                        <CheckIcon weight="bold" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Reject ${s.key}`}
                        onClick={() => reject([s.sid])}
                      >
                        <XIcon weight="bold" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {suggestions.length > fresh.length && (
            <p className="text-xs text-ink-3">
              {plural(suggestions.length - fresh.length, "suggestion")} hidden: they overlap boxes
              you already have.
            </p>
          )}
          <Card size="sm">
            {selectedBox ? (
              <CardContent>
                <BoxInspector
                  key={selectedBox.id}
                  box={selectedBox}
                  pages={pages.length || 1}
                  sections={sections}
                  signers={content.signers}
                  acroFields={source.data?.fields ?? []}
                  editable={editable}
                  onChange={updateBox}
                  onSections={(box, next) =>
                    onChange({
                      content: {
                        ...content,
                        boxes: content.boxes.map((b) => (b.id === box.id ? box : b)),
                      },
                      sections: next,
                    })
                  }
                  onDelete={() => remove(selectedBox.id)}
                  onDuplicate={() => duplicate(selectedBox)}
                />
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>No box selected</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-ink-2">
                  {editable ? (
                    <>
                      <p>Drag on the page to draw a box, or click one to edit it.</p>
                      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1.5 text-xs text-ink-3">
                        {shortcuts.map(([keys, does]) => (
                          <Fragment key={does}>
                            <dt>
                              <Kbd>{keys}</Kbd>
                            </dt>
                            <dd>{does}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <p>Click a box to see its settings.</p>
                  )}
                </CardContent>
              </>
            )}
          </Card>
          <div className="space-y-1.5 px-1 text-xs text-ink-3">
            <p className="font-medium text-ink-2">
              {plural(content.boxes.length, "box", "boxes")} · {onPage.length} on this page
            </p>
            <ul className="space-y-1">
              {(Object.keys(tones) as Tone[]).map((tone) => (
                <li key={tone} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-3 rounded-[3px] border-[1.5px]", tones[tone].box)}
                  />
                  {tones[tone].legend}
                </li>
              ))}
              {fresh.length > 0 && (
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-[3px] border-[1.5px] border-dashed border-sun bg-sun/20"
                  />
                  AI suggestion, not added yet
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The PDF tab: description, flatten, what the upload contained, and replacing it. */
export function OverlayPdfPanel({
  description,
  content,
  editable,
  onDescription,
  onContent,
  suggestDescription,
}: {
  description: string;
  content: OverlayContent;
  editable: boolean;
  onDescription: (description: string) => void;
  onContent: (content: OverlayContent) => void;
  /** Set when AI is on and the user can edit. */
  suggestDescription?: () => Promise<string>;
}) {
  const source = useQuery(pdfSourceQuery(content.sourceId));
  const input = useRef<HTMLInputElement>(null);
  const replace = useMutation({
    mutationFn: uploadPdfSource,
    onSuccess: (uploaded) => {
      onContent({ ...content, sourceId: uploaded.id });
      toast.success("New PDF uploaded. Check the boxes still line up, then save.");
    },
  });
  const s = source.data;
  return (
    <fieldset disabled={!editable} className="space-y-6">
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="template-description">Description</FieldLabel>
          {suggestDescription && (
            <SuggestButton suggest={suggestDescription} onSuggested={onDescription} />
          )}
        </div>
        <Textarea
          id="template-description"
          rows={2}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
        />
      </Field>
      <Field orientation="horizontal">
        <Switch
          id="overlay-flatten"
          checked={content.flatten}
          onCheckedChange={(flatten) => onContent({ ...content, flatten })}
        />
        <FieldLabel htmlFor="overlay-flatten">
          Flatten: outputs have no editable form fields
        </FieldLabel>
      </Field>
      {s && (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{s.filename}</span> · {s.pages.length}{" "}
            {s.pages.length === 1 ? "page" : "pages"} · {(s.size / 1024).toFixed(0)} KB ·{" "}
            {s.fields.filter((f) => f.type !== "button").length} form fields
          </p>
          {s.encrypted && (
            <p className="text-muted-foreground">
              This PDF was encrypted with an empty password. Outputs are saved unencrypted, without
              its print and edit restrictions.
            </p>
          )}
          {s.xfa && (
            <p className="text-muted-foreground">
              This is a hybrid XFA form. Outputs drop the XFA part so every viewer shows the filled
              fields.
            </p>
          )}
        </div>
      )}
      <Field>
        <FieldLabel>Replace the PDF</FieldLabel>
        <FieldDescription>
          Upload a new revision of the same form. Boxes stay where they are; check them afterwards.
        </FieldDescription>
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) replace.mutate(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          className="w-fit"
          disabled={replace.isPending}
          onClick={() => input.current?.click()}
        >
          {replace.isPending ? "Uploading…" : "Upload a new PDF"}
        </Button>
        <ErrorAlert error={replace.error ?? source.error} />
      </Field>
    </fieldset>
  );
}
