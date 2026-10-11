import { useQuery } from "@tanstack/react-query";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { ImageIcon, PenLineIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assetFileUrl } from "@/lib/api";
import { assetsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { FieldChoice } from "./context";
import { pathLabel, useEditorFields } from "./context";

// A block image from the asset library or an image/signature field (imageNodeSchema in
// packages/shared/src/template-doc.ts). Not TipTap's Image: that stores a src URL, and rendered
// documents can't load URLs (docs/features/assets.md).

export type ImageAttrs = {
  assetId: string | null;
  field: string | null;
  alt: string;
  width: number | null;
};

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

export const DocImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: { default: null, parseHTML: (el) => el.getAttribute("data-asset-id") },
      field: { default: null, parseHTML: (el) => el.getAttribute("data-field") },
      alt: { default: "", parseHTML: (el) => el.getAttribute("alt") ?? "" },
      width: {
        default: null,
        parseHTML: (el) => {
          const width = Number(el.getAttribute("data-width"));
          return width >= 1 && width <= 100 ? width : null;
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "img[data-necodoc-image]" }];
  },
  renderHTML({ node }) {
    const { assetId, field, alt, width } = node.attrs;
    return [
      "img",
      mergeAttributes({
        "data-necodoc-image": "",
        ...(assetId ? { "data-asset-id": assetId, src: assetFileUrl(assetId) } : {}),
        ...(field ? { "data-field": field } : {}),
        ...(width ? { "data-width": String(width) } : {}),
        alt,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

const WIDTHS = [25, 33, 50, 75, 100];

function ImageView({ node, editor, selected, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const { sections } = useEditorFields();
  const assetId = str(node.attrs.assetId);
  const field = str(node.attrs.field);
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const width = typeof node.attrs.width === "number" ? node.attrs.width : null;
  return (
    <NodeViewWrapper className="my-2" data-drag-handle="">
      <div
        className={cn("max-w-full rounded", selected && "ring-2 ring-ring")}
        style={{ width: width ? `${width}%` : "fit-content" }}
      >
        {assetId ? (
          <img src={assetFileUrl(assetId)} alt={alt} className="max-w-full" draggable={false} />
        ) : (
          <div className="flex h-20 min-w-48 items-center justify-center gap-2 rounded border border-dashed bg-muted px-4 text-xs text-muted-foreground">
            <PenLineIcon className="size-4" />
            {field ? `Image from “${pathLabel(sections, field) ?? field}”` : "No image source"}
          </div>
        )}
      </div>
      {selected && editor.isEditable && (
        <div contentEditable={false} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <NativeSelect
            size="sm"
            aria-label="Image width"
            value={width ?? ""}
            onChange={(e) =>
              updateAttributes({ width: e.target.value ? Number(e.target.value) : null })
            }
          >
            <NativeSelectOption value="">Natural size</NativeSelectOption>
            {WIDTHS.map((w) => (
              <NativeSelectOption key={w} value={w}>
                {w}% of the width
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label="Alt text"
            placeholder="Alt text"
            className="h-7 w-48"
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
          <Button variant="ghost" size="icon-xs" aria-label="Delete image" onClick={deleteNode}>
            <Trash2Icon />
          </Button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** Picks an image: an uploaded asset, or an image/signature field filled in per document. */
export function ImagePicker({
  open,
  onOpenChange,
  fields,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Image and signature fields usable at the cursor. */
  fields: readonly FieldChoice[];
  onPick: (attrs: ImageAttrs) => void;
}) {
  const assets = useQuery({ ...assetsQuery({ kind: "image" }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insert image</DialogTitle>
          <DialogDescription>
            Upload logos and fixed images on the Assets page. A field image is filled in per
            document.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="asset">
          <TabsList>
            <TabsTrigger value="asset">Asset library</TabsTrigger>
            <TabsTrigger value="field">From a field</TabsTrigger>
          </TabsList>
          <TabsContent value="asset">
            {assets.data?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No image assets yet.</p>
            )}
            <div className="grid max-h-[50svh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {assets.data?.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="space-y-1 rounded-lg border p-2 text-left text-xs hover:bg-muted"
                  onClick={() =>
                    onPick({ assetId: asset.id, field: null, alt: asset.name, width: null })
                  }
                >
                  <img
                    src={assetFileUrl(asset.id)}
                    alt=""
                    className="aspect-square w-full rounded bg-muted object-contain"
                  />
                  <span className="block truncate">{asset.name}</span>
                </button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="field" className="space-y-2">
            {fields.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Add an image or signature field first.
              </p>
            )}
            {fields.map((f) => (
              <Button
                key={f.path}
                variant="outline"
                className="w-full justify-start"
                onClick={() => onPick({ assetId: null, field: f.path, alt: f.label, width: 40 })}
              >
                {f.field.type === "signature" ? <PenLineIcon /> : <ImageIcon />}
                {f.label}
              </Button>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
