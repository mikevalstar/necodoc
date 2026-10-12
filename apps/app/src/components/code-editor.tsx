import type { Completion } from "@codemirror/autocomplete";
import { css } from "@codemirror/lang-css";
import { liquid } from "@codemirror/lang-liquid";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, placeholder as placeholderExt } from "@codemirror/view";
import { type FieldSection, RESERVED_FIELD_KEYS } from "@necodoc/shared";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Code mode, raw HTML blocks and template CSS (docs/features/document-templates.md). CodeMirror 6
// with its Liquid mode (HTML inside), so authors get highlighting, line numbers, bracket
// matching, search (⌘F) and completion of field paths and necodoc's filters.

/** necodoc's own Liquid filters (ADR 0015, apps/api/src/render/liquid.ts). */
const filters: Completion[] = [
  {
    label: "date",
    type: "function",
    detail: 'dayjs format, e.g. date: "LL" (document language) or "MMM D, YYYY"',
  },
  { label: "t", type: "function", detail: 'translate, e.g. "Thank you" | t (Translations tab)' },
  { label: "number", type: "function", detail: "number: decimals" },
  { label: "currency", type: "function", detail: 'currency: "USD"' },
  { label: "qrcode", type: "function", detail: "QR code data: URL for <img src>" },
  { label: "barcode", type: "function", detail: 'barcode: "code128"' },
  { label: "asset_url", type: "function", detail: "asset id → URL the renderer serves" },
];

const reservedInfo: Record<(typeof RESERVED_FIELD_KEYS)[number], string> = {
  page: "page number (header and footer only)",
  pages: "page count (header and footer only)",
  item: "the current item inside a {% for item in group %}",
  forloop: "loop state: index, first, last…",
};

function liquidCompletions(sections: readonly FieldSection[]) {
  const fields = sections.flatMap((s) => s.fields);
  const groups = fields.filter((f) => f.type === "group");
  const variables: Completion[] = [
    ...fields.map((f) => ({
      label: f.key,
      type: "variable",
      detail: f.type === "group" ? `${f.label} (list)` : f.label,
    })),
    ...RESERVED_FIELD_KEYS.map((key) => ({
      label: key,
      type: "keyword",
      detail: reservedInfo[key],
    })),
  ];
  return liquid({
    filters,
    variables,
    // `item.` offers every group's children: the editor can't tell which loop it's in.
    properties: (path) => {
      const [head] = path;
      const owners = head === "item" ? groups : groups.filter((g) => g.key === head);
      return owners.flatMap((g) =>
        g.fields.map((c) => ({
          label: c.key,
          type: "property",
          detail: `${g.label} › ${c.label}`,
        })),
      );
    },
  });
}

const surface = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
  "&.cm-focused": { outline: "none" },
});

export function CodeEditor({
  value,
  onChange,
  language,
  sections = [],
  readOnly = false,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  language: "liquid" | "css";
  /** Field paths offered inside {{ }} and {% %}. */
  sections?: readonly FieldSection[];
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const [lang] = useState(() => new Compartment());
  const [editable] = useState(() => new Compartment());

  // Created once; later props reach it through compartments and transactions below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!host.current) return;
    const dark = document.documentElement.classList.contains("dark");
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          surface,
          ...(dark ? [oneDark] : []),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          placeholder ? placeholderExt(placeholder) : [],
          lang.of(language === "css" ? css() : liquidCompletions(sections)),
          editable.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    // Escape that CodeMirror used (closing completions, search) mustn't also close a dialog.
    const keepEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && e.defaultPrevented) e.stopPropagation();
    };
    const node = host.current;
    node.addEventListener("keydown", keepEscape);
    return () => {
      node.removeEventListener("keydown", keepEscape);
      view.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (language === "liquid")
      view.current?.dispatch({ effects: lang.reconfigure(liquidCompletions(sections)) });
  }, [sections, language, lang]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly, editable]);

  // A value from outside (reload, conversion) replaces the text; our own edits already match.
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={host}
      className={cn(
        "overflow-hidden rounded-lg border bg-background [&_.cm-editor]:max-h-[70svh] [&_.cm-editor]:min-h-24",
        className,
      )}
    />
  );
}
