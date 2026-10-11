import { compileSnippet, type SnippetContent, TemplateCompileError } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { ExternalLinkIcon, PuzzleIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { snippetsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// snippetNodeSchema (packages/shared/src/template-doc.ts): a library snippet by id
// (docs/features/snippet-library.md). The block shows the snippet's name and its text; the PDF
// preview shows it rendered.

/**
 * A snippet's text without markup, Liquid kept, for previews. DOMParser documents are inert:
 * nothing in them runs or loads.
 */
export function snippetText(content: SnippetContent) {
  let html: string;
  try {
    html = compileSnippet(content);
  } catch (error) {
    if (!(error instanceof TemplateCompileError)) throw error;
    return "";
  }
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const block of body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, tr, br")) {
    block.append("\n");
  }
  return (body.textContent ?? "").replace(/\n{2,}/g, "\n").trim();
}

export const SnippetBlock = Node.create({
  name: "snippet",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      snippetId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-snippet-id") ?? "",
        renderHTML: (attrs) => ({ "data-snippet-id": attrs.snippetId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-snippet-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SnippetView);
  },
});

function SnippetView({ node, editor, selected, deleteNode }: ReactNodeViewProps) {
  const id = typeof node.attrs.snippetId === "string" ? node.attrs.snippetId : "";
  const snippets = useQuery(snippetsQuery);
  const found = snippets.data?.find((s) => s.id === id);
  return (
    <NodeViewWrapper className="my-3" data-drag-handle="">
      <div
        contentEditable={false}
        className={cn(
          "rounded-lg border border-dashed border-violet-500/60",
          selected && "ring-2 ring-ring",
        )}
      >
        <div className="flex items-center gap-2 rounded-t-lg bg-violet-500/10 px-2 py-1.5 text-xs">
          <PuzzleIcon className="size-3.5 text-violet-600" />
          <span className="font-medium">
            Snippet: {found?.name ?? (snippets.isPending ? "…" : "not found")}
          </span>
          {found && <code className="text-muted-foreground">{found.key}</code>}
          {found?.archivedAt && <Badge variant="secondary">Archived</Badge>}
          <div className="ml-auto flex gap-1">
            {found && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Open the snippet"
                nativeButton={false}
                // A new tab, so unsaved template edits survive.
                render={<a href={`/snippets/${found.id}`} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
              </Button>
            )}
            {editor.isEditable && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove snippet"
                onClick={deleteNode}
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
        <p className="line-clamp-4 px-3 py-2 text-sm whitespace-pre-line text-muted-foreground">
          {found ? snippetText(found.content) || "Empty" : "This snippet was deleted."}
        </p>
      </div>
    </NodeViewWrapper>
  );
}

/** Picks a snippet to insert: live, non-archived ones, searchable by name, key and tag. */
export function SnippetPicker({
  open,
  onOpenChange,
  exclude,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The snippet being edited: it can't include itself. */
  exclude?: string;
  onPick: (snippetId: string) => void;
}) {
  const snippets = useQuery({ ...snippetsQuery, enabled: open });
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = (snippets.data ?? []).filter(
    (s) =>
      !s.archivedAt &&
      s.id !== exclude &&
      [s.name, s.key, ...s.tags].some((text) => text.toLowerCase().includes(query)),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insert snippet</DialogTitle>
          <DialogDescription>
            Reusable content from the snippet library. Edits to the snippet show up in drafts;
            published versions keep the copy they were published with.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search snippets"
          placeholder="Search by name, key or tag"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-[50svh] space-y-2 overflow-y-auto">
          {snippets.data && shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {snippets.data.length === 0
                ? "No snippets yet; add them on the Snippets page."
                : "No match."}
            </p>
          )}
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              className="block w-full space-y-1 rounded-lg border p-3 text-left text-sm hover:bg-muted"
              onClick={() => onPick(s.id)}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <code className="text-xs text-muted-foreground">{s.key}</code>
                {s.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">
                {snippetText(s.content)}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
