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
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  FileInputIcon,
  SparklesIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SuggestButton, useAiEnabled } from "@/components/ai";
import { ErrorAlert } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ok, pdfSourceUrl } from "@/lib/api";
import type { PdfViewport } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";
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
type Corner = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "draw"; start: Point; now: Point }
  | { kind: "move"; id: string; start: Point; now: Point; from: ViewRect }
  | { kind: "resize"; id: string; corner: Corner; start: Point; now: Point; from: ViewRect };

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

const boxName = (box: OverlayBox) =>
  box.type === "signature" && box.signerId
    ? `${signingKindLabels[box.signingKind ?? "signature"]} · ${box.signerId}`
    : box.value.replace(/[{}]|\|.*$/g, "").trim() || box.acroField || boxTypeLabels[box.type];

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
  const scale = zoom === "fit" ? Math.max(0.3, (width - 8) / pageWidth) : zoom * (4 / 3);

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
      `${done.fields.length} suggestions from ${done.pagesSent} pages in ${(done.ms / 1000).toFixed(0)} s` +
        (done.pagesSkipped ? `; ${done.pagesSkipped} pages had no lines or boxes` : "") +
        (done.pagesNotChecked
          ? `; ${done.pagesNotChecked} pages past the limit weren't checked`
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
    if (e.target !== e.currentTarget || !selectedBox || !editable) return;
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <NativeSelect
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
          <Button variant="outline" size="sm" onClick={importFields}>
            <FileInputIcon />
            Import form fields ({unmapped.length})
          </Button>
        )}
        {editable && aiEnabled && (
          <Button
            variant="outline"
            size="sm"
            disabled={detection.running}
            title="Sends the page images to Anthropic (Claude). Suggestions only; review each one."
            onClick={() => {
              setNotice(null);
              detection.start.mutate();
            }}
          >
            <SparklesIcon />
            {detection.running ? "Detecting…" : "Detect with AI"}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() =>
              setZoom(ZOOMS.filter((z) => z * (4 / 3) < scale - 0.01).at(-1) ?? ZOOMS[0] ?? 0.5)
            }
          >
            <ZoomOutIcon />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setZoom("fit")}>
            {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setZoom(ZOOMS.find((z) => z * (4 / 3) > scale + 0.01) ?? 3)}
          >
            <ZoomInIcon />
          </Button>
        </div>
      </div>
      {detection.running && (
        <p className="text-sm text-muted-foreground">
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

      <div className="grid gap-3 lg:grid-cols-[5.5rem_minmax(0,1fr)_17rem]">
        <nav aria-label="Pages" className="flex gap-2 overflow-auto lg:max-h-[78svh] lg:flex-col">
          {doc &&
            pages.map((_, i) => {
              const n = i + 1;
              const count = content.boxes.filter((b) => b.page === n).length;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "shrink-0 rounded border p-1 text-xs text-muted-foreground hover:bg-muted",
                    n === page && "border-primary ring-1 ring-primary",
                  )}
                >
                  <PageCanvas doc={doc} page={n} scale={0.12} className="mx-auto" />
                  {n}
                  {count > 0 && ` · ${count}`}
                </button>
              );
            })}
        </nav>

        <div
          ref={area}
          className="min-w-0 overflow-auto rounded-lg border bg-muted p-1 lg:max-h-[78svh]"
        >
          {doc ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: the canvas takes arrow keys, Delete and ⌘D for the selected box
            <div
              className="relative mx-auto w-fit outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    const dragging = drag && drag.kind !== "draw" && drag.id === box.id;
                    const r = dragging ? dragRect(drag) : toView(viewport, box.rect);
                    const isSelected = box.id === selected;
                    return (
                      <div
                        key={box.id}
                        title={`${boxTypeLabels[box.type]}: ${box.value || "(no value)"}${box.acroField ? ` → form field ${box.acroField}` : ""}`}
                        className={cn(
                          "absolute cursor-move overflow-hidden border text-[10px] leading-tight",
                          box.type === "signature" && box.signerId
                            ? "border-amber-600 bg-amber-500/15 text-amber-900"
                            : box.acroField
                              ? "border-emerald-600 bg-emerald-500/15 text-emerald-900"
                              : "border-sky-600 bg-sky-500/15 text-sky-900",
                          isSelected && "z-10 ring-2 ring-primary",
                        )}
                        style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                        onPointerDown={(e) => {
                          setSelected(box.id);
                          const at = pointAt(e);
                          startDrag(e, { kind: "move", id: box.id, start: at, now: at, from: r });
                        }}
                      >
                        <span className="pointer-events-none block truncate px-0.5">
                          {boxName(box)}
                        </span>
                        {isSelected &&
                          editable &&
                          (["nw", "ne", "sw", "se"] as const).map((corner) => (
                            <span
                              key={corner}
                              className={cn(
                                "absolute size-2 border border-primary bg-background",
                                corner.startsWith("n") ? "-top-1" : "-bottom-1",
                                corner.endsWith("w") ? "-left-1" : "-right-1",
                                corner === "nw" || corner === "se"
                                  ? "cursor-nwse-resize"
                                  : "cursor-nesw-resize",
                              )}
                              onPointerDown={(e) => {
                                const at = pointAt(e);
                                startDrag(e, {
                                  kind: "resize",
                                  id: box.id,
                                  corner,
                                  start: at,
                                  now: at,
                                  from: r,
                                });
                              }}
                            />
                          ))}
                      </div>
                    );
                  })}
                  {suggested.map((s) => {
                    const r = toView(viewport, s.rect);
                    return (
                      <button
                        key={s.sid}
                        type="button"
                        title={`Suggested ${s.type}: ${s.label} (${s.key})${s.anchored ? "" : ", approximate"}`}
                        className={cn(
                          "absolute overflow-hidden border-2 border-dashed text-left text-[10px] leading-tight",
                          s.anchored
                            ? "border-violet-600 bg-violet-500/15 text-violet-900"
                            : "border-amber-500 bg-amber-400/20 text-amber-900",
                          picked === s.sid && "z-10 ring-2 ring-violet-700",
                        )}
                        style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setPicked(s.sid)}
                      >
                        <span className="block truncate px-0.5">
                          {s.anchored ? "" : "≈ "}
                          {s.key}
                        </span>
                      </button>
                    );
                  })}
                  {drag?.kind === "draw" && (
                    <div
                      className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
                      style={dragRect(drag)}
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">Loading the PDF…</p>
          )}
        </div>

        <aside className="space-y-4 lg:max-h-[78svh] lg:overflow-auto">
          {fresh.length > 0 && (
            <section className="space-y-2 rounded-lg border border-violet-300 p-3">
              <h3 className="text-sm font-medium">
                {fresh.length} AI suggestions
                {approximate > 0 && (
                  <span className="text-amber-700"> · {approximate} approximate</span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                Check each one. Approximate (≈) boxes didn't line up with a printed line or box.
                Keys and labels are guesses.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  disabled={!editable || fresh.every((s) => !s.anchored)}
                  onClick={() => accept(fresh.filter((s) => s.anchored))}
                >
                  Accept all{approximate > 0 ? " but approximate" : ""}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => reject(fresh.map((s) => s.sid))}>
                  Reject all
                </Button>
              </div>
              <ul className="space-y-1">
                {fresh.map((s) => (
                  <li
                    key={s.sid}
                    className={cn(
                      "flex items-center gap-1 rounded px-1 text-xs",
                      picked === s.sid && "bg-violet-100 dark:bg-violet-950",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => {
                        setPage(s.page);
                        setPicked(s.sid);
                      }}
                    >
                      <span className="text-muted-foreground">p{s.page}</span> {s.label}{" "}
                      <span className="font-mono text-muted-foreground">{s.key}</span>
                    </button>
                    {!s.anchored && <Badge variant="outline">≈</Badge>}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Accept ${s.key}`}
                      disabled={!editable}
                      onClick={() => accept([s])}
                    >
                      <CheckIcon />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Reject ${s.key}`}
                      onClick={() => reject([s.sid])}
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {suggestions.length > fresh.length && (
            <p className="text-xs text-muted-foreground">
              {suggestions.length - fresh.length} suggestions hidden: they overlap boxes you already
              have.
            </p>
          )}
          {selectedBox ? (
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
          ) : (
            <p className="text-sm text-muted-foreground">
              {editable
                ? "Drag on the page to draw a box; click one to edit it. Arrow keys nudge (Shift: 10 pt), Delete removes, ⌘D duplicates."
                : "Click a box to see its settings."}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {content.boxes.length} boxes · blue draws on the page, green fills a form field, amber
            is for a signer
          </p>
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
    onSuccess: (uploaded) => onContent({ ...content, sourceId: uploaded.id }),
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
