import {
  ASSET_ORIGIN,
  type AssetListItem as Asset,
  type AssetMime,
  type AssetUsage,
  assetKindSchema,
  blockingTemplates,
  hasPermission,
  MAX_FILE_BYTES,
  renameAssetSchema,
  usageCount,
} from "@necodoc/shared";
import {
  DotsThreeIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { activeFilter, DebouncedInput, FilterSelect } from "@/components/data-table";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { api, assetFileUrl, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { assetsQuery } from "@/lib/queries";
import { cn, formatBytes, plural } from "@/lib/utils";

// Spec: docs/features/assets.md
const searchSchema = z.object({
  q: z.string().optional(),
  kind: assetKindSchema.optional(),
});

export const Route = createFileRoute("/_app/assets")({
  validateSearch: searchSchema,
  component: Assets,
});

type AssetDialog = { kind: "use" | "usage" | "rename" | "delete"; asset: Asset };

const formatLabels: Record<AssetMime, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/svg+xml": "SVG",
  "image/webp": "WebP",
  "font/ttf": "TTF",
  "font/otf": "OTF",
  "font/woff2": "WOFF2",
};

const accepted = "PNG, JPEG, SVG, WebP, TTF, OTF or WOFF2, up to 20 MB each";

/** The family name a font asset previews under on this page. */
const previewFamily = (asset: Asset) => `necodoc-asset-${asset.id}`;

function Assets() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const canUpload = hasPermission(me.user.roles, { document: ["create"] });
  const canEdit = hasPermission(me.user.roles, { document: ["edit"] });
  const assets = useQuery(assetsQuery(search));
  const upload = useUpload();
  const [dialog, setDialog] = useState<AssetDialog | null>(null);
  const close = () => setDialog(null);
  const filtered = Boolean(search.q || search.kind);
  const setFilter = (next: z.infer<typeof searchSchema>) =>
    navigate({ search: { ...search, ...next }, replace: true });
  const fonts = assets.data?.filter((asset) => asset.kind === "font") ?? [];

  return (
    <Page>
      <PageHeader
        title="Assets"
        description="Images and fonts for themes and documents. Rendered pages can't load anything from the internet, so logos and fonts live here."
        actions={
          <>
            <FaqLink feature="Assets" />
            {canUpload && (
              <Button onClick={upload.pick} disabled={upload.isPending} title={accepted}>
                <UploadSimpleIcon weight="bold" />
                {upload.isPending ? "Uploading…" : "Upload"}
              </Button>
            )}
          </>
        }
      />

      {canUpload && upload.input}
      <ErrorAlert error={assets.error ?? upload.error} />

      {assets.isPending ? (
        <ListSkeleton />
      ) : assets.data?.length === 0 && !filtered ? (
        <div {...(canUpload ? upload.dropProps : {})}>
          <EmptyState
            icon={ImageIcon}
            title="No assets yet"
            className={cn(upload.dragging && "border-brand bg-brand-wash")}
            description={
              canUpload
                ? `Upload a logo or a font, or drop files here (${accepted}). Then copy its reference into a template, theme or API render.`
                : "Logos and fonts appear here once an editor uploads them."
            }
            action={
              canUpload && (
                <Button onClick={upload.pick} disabled={upload.isPending}>
                  <UploadSimpleIcon weight="bold" />
                  Upload files
                </Button>
              )
            }
          />
        </div>
      ) : (
        <Card
          className={cn(
            "gap-0 py-0 transition-shadow",
            upload.dragging && "ring-2 ring-brand ring-offset-2 ring-offset-background",
          )}
          {...(canUpload ? upload.dropProps : {})}
        >
          {/* Fonts preview in their own face; the browser fetches each only once it's drawn. */}
          {fonts.length > 0 && (
            <style>
              {fonts
                .map(
                  (font) =>
                    `@font-face { font-family: "${previewFamily(font)}"; src: url(${assetFileUrl(font.id)}); }`,
                )
                .join("\n")}
            </style>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-3">
            <div className="relative">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <DebouncedInput
                type="search"
                aria-label="Search assets"
                className={cn("w-56 pl-9", search.q && activeFilter)}
                placeholder="Search by name"
                value={search.q ?? ""}
                onCommit={(q) => setFilter({ q: q.trim() || undefined })}
              />
            </div>
            <FilterSelect
              label="Type"
              any="Images and fonts"
              value={search.kind}
              options={[
                { value: "image", label: "Images" },
                { value: "font", label: "Fonts" },
              ]}
              onChange={(value) => setFilter({ kind: assetKindSchema.safeParse(value).data })}
            />
            <p className="ml-auto text-sm text-ink-3" aria-live="polite">
              {plural(assets.data?.length ?? 0, "asset")}
              {canUpload && <span className="hidden md:inline"> · drop files here to upload</span>}
            </p>
          </div>

          {assets.data?.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-ink-3">
              No assets match.
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilter({ q: undefined, kind: undefined })}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ul
              aria-label="Assets"
              className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              {assets.data?.map((asset) => (
                <AssetTile
                  key={asset.id}
                  asset={asset}
                  canEdit={canEdit}
                  onAction={(kind) => setDialog({ kind, asset })}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {dialog?.kind === "use" && <UseAssetDialog asset={dialog.asset} onClose={close} />}
      {dialog?.kind === "usage" && <UsageDialog asset={dialog.asset} onClose={close} />}
      {dialog?.kind === "rename" && <RenameAssetDialog asset={dialog.asset} onClose={close} />}
      {dialog?.kind === "delete" && <DeleteAssetDialog asset={dialog.asset} onClose={close} />}
    </Page>
  );
}

function AssetTile({
  asset,
  canEdit,
  onAction,
}: {
  asset: Asset;
  canEdit: boolean;
  onAction: (kind: AssetDialog["kind"]) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2.5">
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-tint">
        {asset.kind === "image" ? (
          <img
            src={assetFileUrl(asset.id)}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full bg-[repeating-conic-gradient(var(--tint-2)_0_25%,transparent_0_50%)] bg-size-[14px_14px] object-contain p-5"
          />
        ) : (
          <div
            aria-hidden
            className="flex flex-col items-center gap-1 px-3 text-center text-ink"
            style={{ fontFamily: `"${previewFamily(asset)}", var(--font-sans)` }}
          >
            <span className="text-5xl leading-none">Aa</span>
            <span className="text-sm text-ink-2">The quick brown fox</span>
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-semibold" title={asset.name}>
          {asset.name}
        </p>
        <p className="truncate text-xs text-ink-3">
          {formatLabels[asset.mimeType]} · {formatBytes(asset.size)} ·{" "}
          <time dateTime={asset.createdAt} title={asset.uploaderName ?? undefined}>
            {dayjs(asset.createdAt).format("MMM D, YYYY")}
          </time>
          {asset.uploaderName && ` · ${asset.uploaderName}`}
        </p>
        <button
          type="button"
          className="text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          onClick={() => onAction("usage")}
        >
          {usageCount(asset.usage)
            ? `Used in ${plural(usageCount(asset.usage), "place")}`
            : "Not used"}
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1"
          aria-label={`Copy reference for ${asset.name}`}
          onClick={() => onAction("use")}
        >
          Copy reference
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${asset.name}`} />
            }
          >
            <DotsThreeIcon weight="bold" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              render={<a href={assetFileUrl(asset.id)} target="_blank" rel="noreferrer" />}
            >
              Open file
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuItem onClick={() => onAction("rename")}>Rename</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onAction("delete")}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/**
 * Upload from the header button's picker or by dropping files on the library. Files upload one
 * at a time; `input` is the hidden picker to render once.
 */
function useUpload() {
  const queryClient = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);
      if (tooBig) throw new Error(`${tooBig.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      for (const file of files) await ok(api.assets.$post({ form: { file } }));
      return files.length;
    },
    onSuccess: (count) => toast.success(`Uploaded ${plural(count, "file")}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
  const send = (files: FileList | null) => {
    if (files?.length && !upload.isPending) upload.mutate([...files]);
  };
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return {
    isPending: upload.isPending,
    error: upload.error,
    dragging,
    pick: () => ref.current?.click(),
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        // Moving between children fires dragleave too; only clear when leaving the target.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDragging(false);
        send(e.dataTransfer.files);
      },
    },
    input: (
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        accept=".png,.jpg,.jpeg,.svg,.webp,.ttf,.otf,.woff2"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = "";
        }}
      />
    ),
  };
}

function UseAssetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const url = `${ASSET_ORIGIN}/${asset.id}`;
  const snippets = [
    { label: "Asset id (API renders)", code: asset.id },
    ...(asset.kind === "image"
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
        ]),
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
              <pre className="rounded-lg bg-tint p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Where an asset is used, with links (src/usage.ts in the API finds it). */
function UsageList({ usage }: { usage: AssetUsage }) {
  const link = "font-medium text-brand-ink underline-offset-4 hover:underline";
  return (
    <ul
      aria-label="Where it's used"
      className="divide-y divide-hair rounded-lg border border-hair text-sm"
    >
      {usage.templates.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Link to="/templates/$id" params={{ id: t.id }} className={link}>
            {t.name}
          </Link>
          <span className="text-ink-3">Template</span>
          <span className="ml-auto flex flex-wrap gap-1">
            {t.draft && <Badge variant="secondary">Draft</Badge>}
            {t.versions.length > 0 && (
              <Badge
                variant={t.archived ? "secondary" : "default"}
                title={t.versions.map((v) => `v${v}`).join(", ")}
              >
                {plural(t.versions.length, "published version")}
              </Badge>
            )}
            {t.archived && <Badge variant="secondary">Archived</Badge>}
          </span>
        </li>
      ))}
      {usage.themes.map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-3 py-2">
          <Link to="/themes/$id" params={{ id: t.id }} className={link}>
            {t.name}
          </Link>
          <span className="text-ink-3">Theme</span>
        </li>
      ))}
      {usage.snippets.map((s) => (
        <li key={s.id} className="flex items-center gap-2 px-3 py-2">
          <Link to="/snippets/$id" params={{ id: s.id }} className={link}>
            {s.name}
          </Link>
          <span className="text-ink-3">Snippet</span>
        </li>
      ))}
    </ul>
  );
}

function UsageDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Where {asset.name} is used</DialogTitle>
          <DialogDescription>
            Templates, themes and snippets whose content or CSS names this asset. Published versions
            count through the theme copy they froze too.
          </DialogDescription>
        </DialogHeader>
        {usageCount(asset.usage) ? (
          <UsageList usage={asset.usage} />
        ) : (
          <p className="text-sm text-ink-3">Nothing references it.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useAssetMutation<T>(
  mutationFn: (value: T) => Promise<unknown>,
  onDone: () => void,
  done: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast.success(done);
      onDone();
    },
  });
}

function RenameAssetDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const rename = useAssetMutation(
    (json: z.infer<typeof renameAssetSchema>) =>
      ok(api.assets[":id"].$patch({ param: { id: asset.id }, json })),
    onClose,
    "Renamed",
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
    `Deleted ${asset.name}`,
  );
  const blocked = blockingTemplates(asset.usage).length > 0;
  const used = usageCount(asset.usage) > 0;
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `${asset.name} can't be deleted` : `Delete ${asset.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? "Published versions of these templates use it, and any published version can still be rendered. Archive the templates first."
              : used
                ? "These drafts, themes or snippets reference it and will render without it until they're edited."
                : "Nothing references it."}
            {!blocked && asset.kind === "font" && " Themes using this font fall back to Noto Sans."}
            {!blocked && " It can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {used && <UsageList usage={asset.usage} />}
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete asset
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
