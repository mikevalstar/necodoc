import type { FieldSection, Signer } from "@necodoc/shared";
import type { Editor, JSONContent } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BracesIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PenLineIcon,
  PuzzleIcon,
  QuoteIcon,
  RepeatIcon,
  ScissorsLineDashedIcon,
  SplitIcon,
  TableIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { newCondition } from "@/components/condition-editor";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { EditorFieldsContext, enclosingRepeat, groupFields, scalarChoices } from "./context";
import { DocImage, ImagePicker } from "./image";
import {
  MergeField,
  type MergeFieldAttrs,
  MergeFieldForm,
  suggestedFilter,
  valueChoices,
} from "./merge-field";
import { RawHtml } from "./raw-html";
import { newSignBox, SignBox } from "./sign-box";
import { type InsertItem, SlashCommand, SlashMenu } from "./slash";
import { SnippetBlock, SnippetPicker } from "./snippet";
import { ConditionalSection, PageBreak, RepeatingSection } from "./structure";
import { Toolbar } from "./toolbar";

// ADR 0016: one TipTap editor per document (body, header, footer, first-page variants). The
// node and mark set is exactly docSchema's (packages/shared/src/template-doc.ts): StarterKit
// without code marks or code blocks, plus tables, alignment, colour and necodoc's own nodes.
// Anything else is dropped on paste rather than rejected on save.

/** Colours are stored as #rrggbb; pasted named or rgb() colours are converted, others dropped. */
function hexColor(value: string) {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!value || !ctx) return null;
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : null;
}

const HexColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          color: {
            default: null,
            parseHTML: (el) => hexColor(el.style.color),
            renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {}),
          },
        },
      },
    ];
  },
});

/** A row repeated once per item of a repeating group (tableRowNodeSchema's `repeat`). */
const RepeatableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      repeat: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-repeat") || null,
        renderHTML: (attrs) => (attrs.repeat ? { "data-repeat": attrs.repeat } : {}),
      },
    };
  },
});

const NO_SIGNERS: readonly Signer[] = [];

/** Must match markSchema's link href rule. */
const LINK = /^(https?:|mailto:|tel:|#)/i;

function extensions(menu: SlashMenu, items: () => InsertItem[], placeholder: string) {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        isAllowedUri: (url) => LINK.test(url),
      },
    }),
    TextStyle,
    HexColor,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Table.configure({ resizable: false }),
    RepeatableRow,
    TableHeader,
    TableCell,
    MergeField,
    ConditionalSection,
    RepeatingSection,
    PageBreak,
    DocImage,
    RawHtml,
    SnippetBlock,
    SignBox,
    Placeholder.configure({ placeholder }),
    SlashCommand.configure({ menu, items }),
  ];
}

export function DocEditor({
  value,
  onChange,
  sections,
  band = false,
  editable,
  placeholder = "Write, or type / to insert a field, table or section…",
  className,
  snippetId,
  signers,
}: {
  /**
   * The content. A new value that isn't what the editor last reported (the AI assistant applying
   * a change) is loaded as one undoable step; remount (key) to start a fresh history instead.
   */
  value: JSONContent;
  onChange: (doc: JSONContent) => void;
  sections: readonly FieldSection[];
  /** Header and footer editors: page tokens on, page breaks off. */
  band?: boolean;
  editable: boolean;
  placeholder?: string;
  className?: string;
  /** Set when editing a snippet: the picker leaves it out, so it can't include itself. */
  snippetId?: string;
  /** The template's signers; set only where sign boxes can go (a template body). */
  signers?: readonly Signer[];
}) {
  const [menu] = useState(() => new SlashMenu());
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [draftField, setDraftField] = useState<MergeFieldAttrs>({ field: "", filter: null });
  const items = useRef<InsertItem[]>([]);
  const changed = useRef(onChange);
  changed.current = onChange;
  /** The last doc reported through onChange. */
  const emitted = useRef(value);

  const editor = useEditor({
    extensions: useMemo(
      () => extensions(menu, () => items.current, placeholder),
      [menu, placeholder],
    ),
    content: value,
    editable,
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON();
      emitted.current = json;
      changed.current(json);
    },
  });
  // Outside changes (an applied AI proposal). Echoes of our own updates are skipped by identity.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    if (JSON.stringify(value) === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  // false: toggling editability isn't an edit, so it mustn't report a change.
  useEffect(() => editor.setEditable(editable, false), [editor, editable]);

  const repeatAtCursor = (e: Editor) => enclosingRepeat(e.state.selection.$from);
  const fieldChoices = valueChoices(sections, repeatAtCursor(editor), band);

  const openFieldPicker = () => {
    // The cursor may have moved into or out of a repeat since the last render.
    const choices = valueChoices(sections, repeatAtCursor(editor), band);
    const first = choices.find((c) => c.path === draftField.field) ?? choices[0];
    setDraftField({ field: first?.path ?? "", filter: suggestedFilter(first?.field) });
    setFieldOpen(true);
  };

  const insertItems: InsertItem[] = [
    { title: "Merge field", icon: BracesIcon, run: openFieldPicker },
    {
      title: "Heading 1",
      icon: Heading1Icon,
      run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      title: "Heading 2",
      icon: Heading2Icon,
      run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      title: "Bullet list",
      icon: ListIcon,
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      icon: ListOrderedIcon,
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    { title: "Quote", icon: QuoteIcon, run: (e) => e.chain().focus().toggleBlockquote().run() },
    {
      title: "Table",
      icon: TableIcon,
      run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { title: "Image", icon: ImageIcon, run: () => setImageOpen(true) },
    {
      title: "Conditional section",
      icon: SplitIcon,
      run: (e) => {
        const first = scalarChoices(sections, repeatAtCursor(e))[0];
        const attrs = { condition: first ? newCondition(first) : null };
        // Wraps the current block; falls back to an empty section where wrapping isn't allowed.
        if (!e.chain().focus().wrapIn("conditionalSection", attrs).run()) {
          e.chain()
            .focus()
            .insertContent({ type: "conditionalSection", attrs, content: [{ type: "paragraph" }] })
            .run();
        }
      },
    },
    {
      title: "Repeating section",
      icon: RepeatIcon,
      run: (e) => {
        const attrs = { field: groupFields(sections)[0]?.key ?? "" };
        if (!e.chain().focus().wrapIn("repeatingSection", attrs).run()) {
          e.chain()
            .focus()
            .insertContent({ type: "repeatingSection", attrs, content: [{ type: "paragraph" }] })
            .run();
        }
      },
    },
    ...(band
      ? []
      : [
          {
            title: "Page break",
            icon: ScissorsLineDashedIcon,
            run: (e: Editor) => e.chain().focus().insertContent({ type: "pageBreak" }).run(),
          },
        ]),
    {
      title: "Raw HTML / Liquid",
      icon: CodeIcon,
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent({ type: "rawHtml", attrs: { html: "" } })
          .run(),
    },
    { title: "Snippet", icon: PuzzleIcon, run: () => setSnippetOpen(true) },
    ...(signers
      ? [
          {
            title: "Sign box",
            icon: PenLineIcon,
            run: (e: Editor) =>
              e
                .chain()
                .focus()
                .insertContent({ type: "signBox", attrs: newSignBox(signers[0]?.id ?? "") })
                .run(),
          },
        ]
      : []),
    { title: "Divider", icon: MinusIcon, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ];
  items.current = insertItems;

  const slash = useSyncExternalStore(menu.subscribe, menu.get);
  const context = useMemo(
    () => ({ sections, band, signers: signers ?? NO_SIGNERS }),
    [sections, band, signers],
  );

  return (
    <EditorFieldsContext.Provider value={context}>
      <div className={cn("rounded-lg border bg-background", className)}>
        {editable && (
          <Toolbar
            editor={editor}
            insertItems={insertItems}
            fieldButton={
              <Popover
                open={fieldOpen}
                onOpenChange={(open) => (open ? openFieldPicker() : setFieldOpen(false))}
              >
                <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
                  <BracesIcon />
                  Field
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  {fieldChoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Declare fields on the Fields tab first.
                    </p>
                  ) : (
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!draftField.field) return;
                        editor
                          .chain()
                          .focus()
                          .insertContent({ type: "mergeField", attrs: draftField })
                          .run();
                        setFieldOpen(false);
                      }}
                    >
                      <MergeFieldForm
                        value={draftField}
                        onChange={setDraftField}
                        choices={fieldChoices}
                      />
                      <Button type="submit" size="sm">
                        Insert field
                      </Button>
                    </form>
                  )}
                </PopoverContent>
              </Popover>
            }
          />
        )}
        <EditorContent editor={editor} className="necodoc-editor" />
      </div>
      {slash?.rect && (
        <div
          role="listbox"
          aria-label="Insert"
          className="fixed z-50 max-h-72 w-56 overflow-y-auto rounded-lg bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10"
          style={{ top: slash.rect.bottom + 4, left: slash.rect.left }}
        >
          {slash.items.map((item, i) => (
            <button
              key={item.title}
              type="button"
              role="option"
              aria-selected={i === slash.index}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left [&_svg]:size-4",
                i === slash.index && "bg-accent text-accent-foreground",
              )}
              // mousedown, not click: a click would blur the editor and close the menu first.
              onMouseDown={(e) => {
                e.preventDefault();
                slash.pick(item);
              }}
            >
              <item.icon />
              {item.title}
            </button>
          ))}
        </div>
      )}
      <ImagePicker
        open={imageOpen}
        onOpenChange={setImageOpen}
        fields={scalarChoices(sections, repeatAtCursor(editor)).filter(
          (c) => c.field.type === "image" || c.field.type === "signature",
        )}
        onPick={(attrs) => {
          editor.chain().focus().insertContent({ type: "image", attrs }).run();
          setImageOpen(false);
        }}
      />
      <SnippetPicker
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        exclude={snippetId}
        onPick={(id) => {
          editor
            .chain()
            .focus()
            .insertContent({ type: "snippet", attrs: { snippetId: id } })
            .run();
          setSnippetOpen(false);
        }}
      />
    </EditorFieldsContext.Provider>
  );
}
