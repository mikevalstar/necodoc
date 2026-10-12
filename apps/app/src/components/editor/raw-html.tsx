import { CodeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEditorFields } from "./context";

// rawHtmlNodeSchema (packages/shared/src/template-doc.ts): advanced markup in a visual template,
// output verbatim. The editor shows the code, not its rendering; the PDF preview shows that.

export const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-raw-html") ?? "",
        renderHTML: (attrs) => ({ "data-raw-html": attrs.html }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-raw-html]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawHtmlView);
  },
});

function RawHtmlView({ node, editor, selected, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const { sections } = useEditorFields();
  const html = typeof node.attrs.html === "string" ? node.attrs.html : "";
  // A freshly inserted block opens straight into the code editor.
  const [open, setOpen] = useState(html === "" && editor.isEditable);
  const [draft, setDraft] = useState(html);
  const lines = html.split("\n");
  return (
    <NodeViewWrapper className="my-3">
      <div
        contentEditable={false}
        className={cn(
          "rounded-lg border border-dashed border-sky-500/60",
          selected && "ring-2 ring-ring",
        )}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-sky-500/10 px-2 py-1.5 text-xs">
          <CodeIcon className="size-3.5 text-sky-600" />
          <span className="font-medium">Raw HTML / Liquid</span>
          <span className="text-muted-foreground">Rendered as written; see the preview.</span>
          {editor.isEditable && (
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Edit raw HTML"
                onClick={() => {
                  setDraft(html);
                  setOpen(true);
                }}
              >
                <PencilSimpleIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete raw HTML"
                onClick={deleteNode}
              >
                <TrashIcon />
              </Button>
            </div>
          )}
        </div>
        <pre className="max-h-40 overflow-hidden px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {html ? lines.slice(0, 8).join("\n") + (lines.length > 8 ? "\n…" : "") : "Empty"}
        </pre>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Raw HTML / Liquid</DialogTitle>
            <DialogDescription>
              Output exactly as written, Liquid included: {"{{ field }}"}, {"{% if %}"},{" "}
              {"{% for item in group %}"}. It isn't checked against the fields; publishing checks
              the Liquid parses. No JavaScript or remote URLs in renders.
            </DialogDescription>
          </DialogHeader>
          <CodeEditor
            label="Raw HTML / Liquid"
            language="liquid"
            sections={sections}
            value={draft}
            onChange={setDraft}
            className="[&_.cm-editor]:min-h-64"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                updateAttributes({ html: draft });
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NodeViewWrapper>
  );
}
