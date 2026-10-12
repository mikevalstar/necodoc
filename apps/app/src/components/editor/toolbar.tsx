import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  BracketsCurlyIcon,
  DotsThreeIcon,
  EraserIcon,
  LinkIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  PlusIcon,
  QuotesIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@phosphor-icons/react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { groupFields, useEditorFields } from "./context";
import type { InsertItem } from "./slash";

const ALIGNS = [
  { value: "left", icon: TextAlignLeftIcon },
  { value: "center", icon: TextAlignCenterIcon },
  { value: "right", icon: TextAlignRightIcon },
  { value: "justify", icon: TextAlignJustifyIcon },
] as const;

/** Must match markSchema's link href rule (packages/shared/src/template-doc.ts). */
const LINK = /^(https?:|mailto:|tel:|#)/i;

export function Toolbar({
  editor,
  insertItems,
  fieldButton,
}: {
  editor: Editor;
  insertItems: readonly InsertItem[];
  /** The merge field picker, owned by the editor so "/" can open it too. */
  fieldButton: ReactNode;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : e.isActive("heading", { level: 4 })
              ? "h4"
              : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      align: ALIGNS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? "left",
      color:
        typeof e.getAttributes("textStyle").color === "string"
          ? e.getAttributes("textStyle").color
          : "",
      inTable: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const mark = (name: "bold" | "italic" | "underline", label: string, icon: ReactNode) => (
    <Toggle
      size="sm"
      aria-label={label}
      title={label}
      pressed={state[name]}
      onPressedChange={() => chain().toggleMark(name).run()}
    >
      {icon}
    </Toggle>
  );

  const alignIcon = ALIGNS.find((a) => a.value === state.align) ?? ALIGNS[0];

  // One row at the editor column's width (cobalt/editor.html): alignment and the less-used marks
  // sit in menus; Field and Insert are grouped on the right.
  return (
    <div className="sticky top-0 z-10 rounded-t-xl border-b border-hair bg-card/95 px-1.5 py-1.5 backdrop-blur">
      <div className="flex flex-wrap items-center [&_[data-slot=toggle]]:px-0">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Undo"
          title="Undo"
          disabled={!state.canUndo}
          onClick={() => chain().undo().run()}
        >
          <ArrowUUpLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Redo"
          title="Redo"
          disabled={!state.canRedo}
          onClick={() => chain().redo().run()}
        >
          <ArrowUUpRightIcon />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <NativeSelect
          size="sm"
          aria-label="Text style"
          value={state.block}
          onChange={(e) => {
            const level = Number(e.target.value.slice(1));
            if (level === 1 || level === 2 || level === 3 || level === 4) {
              chain().setHeading({ level }).run();
            } else chain().setParagraph().run();
          }}
        >
          <NativeSelectOption value="p">Paragraph</NativeSelectOption>
          <NativeSelectOption value="h1">Heading 1</NativeSelectOption>
          <NativeSelectOption value="h2">Heading 2</NativeSelectOption>
          <NativeSelectOption value="h3">Heading 3</NativeSelectOption>
          <NativeSelectOption value="h4">Heading 4</NativeSelectOption>
        </NativeSelect>
        <Separator orientation="vertical" className="mx-1 h-5" />
        {mark("bold", "Bold", <TextBIcon />)}
        {mark("italic", "Italic", <TextItalicIcon />)}
        {mark("underline", "Underline", <TextUnderlineIcon />)}
        <label
          title="Text colour"
          className="relative flex size-8 cursor-pointer items-center justify-center rounded-[9px] text-ink-2 hover:bg-tint"
        >
          <span className="text-sm font-semibold" style={{ color: state.color || undefined }}>
            A
          </span>
          <span
            className="absolute inset-x-2 bottom-1.5 h-0.5 rounded"
            style={{ background: state.color || "currentColor" }}
          />
          <input
            type="color"
            aria-label="Text colour"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={state.color || "#000000"}
            onChange={(e) => chain().setColor(e.target.value).run()}
          />
        </label>
        <LinkButton editor={editor} active={state.link} />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Alignment: ${state.align}`}
                title="Alignment"
              />
            }
          >
            <alignIcon.icon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={state.align}
              onValueChange={(value) => {
                const align = ALIGNS.find((a) => a.value === value);
                if (align) chain().setTextAlign(align.value).run();
              }}
            >
              {ALIGNS.map(({ value, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon />
                  Align {value}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Toggle
          size="sm"
          aria-label="Bullet list"
          title="Bullet list"
          pressed={state.bulletList}
          onPressedChange={() => chain().toggleBulletList().run()}
        >
          <ListBulletsIcon />
        </Toggle>
        <Toggle
          size="sm"
          aria-label="Numbered list"
          title="Numbered list"
          pressed={state.orderedList}
          onPressedChange={() => chain().toggleOrderedList().run()}
        >
          <ListNumbersIcon />
        </Toggle>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="More formatting" title="More" />
            }
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuCheckboxItem
              checked={state.strike}
              onCheckedChange={() => chain().toggleStrike().run()}
            >
              <TextStrikethroughIcon />
              Strikethrough
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={state.blockquote}
              onCheckedChange={() => chain().toggleBlockquote().run()}
            >
              <QuotesIcon />
              Quote
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!state.color} onClick={() => chain().unsetColor().run()}>
              <EraserIcon />
              Clear text colour
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1 [&_[data-slot=button]]:px-2.5">
          {fieldButton}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="sm" />}>
              <PlusIcon weight="bold" />
              Insert
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {insertItems.map((item) => (
                <DropdownMenuItem key={item.title} onClick={() => item.run(editor)}>
                  <item.icon />
                  {item.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {state.inTable && <TableBar editor={editor} />}
    </div>
  );
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const valid = LINK.test(href);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const current = editor.getAttributes("link").href;
          setHref(typeof current === "string" ? current : "https://");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger render={<Toggle size="sm" aria-label="Link" title="Link" pressed={active} />}>
        <LinkIcon />
      </PopoverTrigger>
      <PopoverContent align="start">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            setOpen(false);
          }}
        >
          <Input
            aria-label="Link address"
            value={href}
            aria-invalid={!valid}
            onChange={(e) => setHref(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">http(s), mailto:, tel: or #anchor.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!valid}>
              Apply
            </Button>
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Shown while the cursor is in a table: structure, header rows, and the row repeat. */
function TableBar({ editor }: { editor: Editor }) {
  const { sections } = useEditorFields();
  const groups = groupFields(sections);
  const repeat = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const value = e.getAttributes("tableRow").repeat;
      return typeof value === "string" ? value : "";
    },
  });
  const chain = () => editor.chain().focus();
  const action = (label: string, run: () => boolean) => (
    <Button variant="ghost" size="xs" onClick={run}>
      {label}
    </Button>
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-0.5 border-t border-hair pt-1.5 text-xs">
      <span className="px-1 font-semibold text-ink-3">Table</span>
      {action("Row above", () => chain().addRowBefore().run())}
      {action("Row below", () => chain().addRowAfter().run())}
      {action("Column left", () => chain().addColumnBefore().run())}
      {action("Column right", () => chain().addColumnAfter().run())}
      {action("Delete row", () => chain().deleteRow().run())}
      {action("Delete column", () => chain().deleteColumn().run())}
      {action("Header row", () => chain().toggleHeaderRow().run())}
      {action("Merge/split cells", () => chain().mergeOrSplit().run())}
      {action("Delete table", () => chain().deleteTable().run())}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <BracketsCurlyIcon className="size-3.5 text-brand-ink" />
      <NativeSelect
        size="sm"
        aria-label="Repeat this row"
        value={repeat}
        onChange={(e) =>
          chain()
            .updateAttributes("tableRow", { repeat: e.target.value || null })
            .run()
        }
      >
        <NativeSelectOption value="">Row doesn't repeat</NativeSelectOption>
        {repeat && !groups.some((g) => g.key === repeat) && (
          <NativeSelectOption value={repeat}>Missing group "{repeat}"</NativeSelectOption>
        )}
        {groups.map((g) => (
          <NativeSelectOption key={g.key} value={g.key}>
            Repeat row for each {g.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
