import {
  ASSET_ORIGIN,
  type Asset,
  assetKindSchema,
  hasPermission,
  MAX_FILE_BYTES,
  renameAssetSchema,
} from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, TypeIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert, useAppForm } from "@/components/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, assetFileUrl, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { assetsQuery } from "@/lib/queries";
import { cn, formatBytes } from "@/lib/utils";

// Spec: docs/features/assets.md
const searchSchema = z.object({
  q: z.string().optional(),
  kind: assetKindSchema.optional(),
});

export const Route = createFileRoute("/_app/assets")({
  validateSearch: searchSchema,
  component: Assets,
});

type AssetDialog = { kind: "use" | "rename" | "delete"; asset: Asset };

function Assets() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const canUpload = hasPermission(me.user.roles, { document: ["create"] });
  const canEdit = hasPermission(me.user.roles, { document: ["edit"] });
  const assets = useQuery(assetsQuery(search));
  const [query, setQuery] = useState(search.q ?? "");
  const [dialog, setDialog] = useState<AssetDialog | null>(null);
  const close = () => setDialog(null);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Assets</h1>
        <p className="text-sm text-muted-foreground">
          Images and fonts for themes and documents. Rendered pages can't load anything from the
          internet, so logos and fonts live here.
        </p>
      </div>

      {canUpload && <UploadZone />}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: { ...search, q: query || undefined } });
        }}
      >
        <Input
          className="max-w-xs"
          type="search"
          aria-label="Search assets"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect
          aria-label="Type"
          value={search.kind ?? ""}
          onChange={(e) =>
            navigate({
              search: { ...search, kind: assetKindSchema.safeParse(e.target.value).data },
            })
          }
        >
          <NativeSelectOption value="">Images and fonts</NativeSelectOption>
          <NativeSelectOption value="image">Images</NativeSelectOption>
          <NativeSelectOption value="font">Fonts</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <ErrorAlert error={assets.error} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">
              <span className="sr-only">Preview</span>
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            <TableHead className="hidden sm:table-cell">Size</TableHead>
            <TableHead className="hidden md:table-cell">Uploaded</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.data?.map((asset) => (
            <TableRow key={asset.id}>
              <TableCell>
                {asset.kind === "image" ? (
                  <img
                    src={assetFileUrl(asset.id)}
                    alt=""
                    loading="lazy"
                    className="size-12 rounded border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-size-[12px_12px] object-contain"
                  />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded border text-muted-foreground">
                    <TypeIcon />
                  </div>
                )}
              </TableCell>
              <TableCell className="font-medium">
                <span className="break-all">{asset.name}</span>
                <div className="text-xs font-normal text-muted-foreground sm:hidden">
                  {asset.mimeType} · {formatBytes(asset.size)}
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">{asset.mimeType}</TableCell>
              <TableCell className="hidden sm:table-cell">{formatBytes(asset.size)}</TableCell>
              <TableCell className="hidden md:table-cell">
                {dayjs(asset.createdAt).format("YYYY-MM-DD")}
                <div className="text-xs text-muted-foreground">{asset.uploaderName ?? "—"}</div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: "use", asset })}
                  >
                    Copy reference
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        render={
                          <a href={assetFileUrl(asset.id)} target="_blank" rel="noreferrer" />
                        }
                      >
                        Open file
                      </DropdownMenuItem>
                      {canEdit && (
                        <>
                          <DropdownMenuItem onClick={() => setDialog({ kind: "rename", asset })}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDialog({ kind: "delete", asset })}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {assets.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No assets found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {dialog?.kind === "use" && <UseAssetDialog asset={dialog.asset} onClose={close} />}
      {dialog?.kind === "rename" && <RenameAssetDialog asset={dialog.asset} onClose={close} />}
      {dialog?.kind === "delete" && <DeleteAssetDialog asset={dialog.asset} onClose={close} />}
    </main>
  );
}

/** Drop files anywhere on it, or click to pick. Files upload one at a time. */
function UploadZone() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);
      if (tooBig) throw new Error(`${tooBig.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      for (const file of files) await ok(api.assets.$post({ form: { file } }));
      return files.length;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
  const send = (files: FileList | null) => {
    if (files?.length) upload.mutate([...files]);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50",
          dragging && "border-primary bg-muted",
        )}
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
      >
        <UploadIcon className="size-5" />
        <span className="font-medium text-foreground">
          {upload.isPending ? "Uploading…" : "Drop files here or click to upload"}
        </span>
        <span>PNG, JPEG, SVG, WebP, TTF, OTF or WOFF2, up to 20 MB each</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".png,.jpg,.jpeg,.svg,.webp,.ttf,.otf,.woff2"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = "";
        }}
      />
      <ErrorAlert error={upload.error} />
      {upload.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          Uploaded {upload.data} {upload.data === 1 ? "file" : "files"}.
        </p>
      )}
    </div>
  );
}

function UseAssetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const url = `${ASSET_ORIGIN}/${asset.id}`;
  const snippets =
    asset.kind === "image"
      ? [
          {
            label: "HTML (Liquid)",
            code: `<img src="{{ '${asset.id}' | asset_url }}" alt="${asset.name.replace(/"/g, "&quot;")}">`,
          },
          { label: "CSS", code: `background-image: url(${url});` },
        ]
      : [
          {
            label: "CSS",
            code: `@font-face { font-family: "${asset.name.replace(/"/g, "")}"; src: url(${url}); }`,
          },
        ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Use {asset.name}</DialogTitle>
          <DialogDescription>
            References use the asset's id, so renaming it later doesn't break them.
            {asset.kind === "font" && " Themes can also pick this font directly."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {snippets.map(({ label, code }) => (
            <div key={label} className="min-w-0 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <CopyButton text={code} />
              </div>
              <pre className="rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useAssetMutation<T>(mutationFn: (value: T) => Promise<unknown>, onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      onDone();
    },
  });
}

function RenameAssetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const rename = useAssetMutation(
    (json: z.infer<typeof renameAssetSchema>) =>
      ok(api.assets[":id"].$patch({ param: { id: asset.id }, json })),
    onClose,
  );
  const form = useAppForm({
    defaultValues: { name: asset.name },
    validators: { onChange: renameAssetSchema },
    onSubmit: ({ value }) => rename.mutate(value),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename asset</DialogTitle>
            <DialogDescription>
              Documents refer to it by id, so they keep working.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
            <ErrorAlert error={rename.error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={rename.isPending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAssetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const remove = useAssetMutation<void>(
    () => ok(api.assets[":id"].$delete({ param: { id: asset.id } })),
    onClose,
  );
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {asset.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Renders that still reference it, including re-runs of old generations, will fail.
            {asset.kind === "font" && " Themes using this font fall back to Noto Sans."} It can't be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete asset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
