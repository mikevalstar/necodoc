import {
  type ApiKeyStatus,
  type apiKeyListQuerySchema,
  apiScopeSchema,
  apiScopes,
  type CreateApiKeyInput,
  createApiKeySchema,
  EXPIRY_WARNING_DAYS,
  hasPermission,
  ipAllowEntrySchema,
  MAX_RATE_LIMIT_PER_MINUTE,
  type Role,
} from "@necodoc/shared";
import { CheckIcon, CopyIcon, DotsThreeIcon, KeyIcon, WarningIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState } from "@/components/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { meQuery } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Spec: docs/features/html-to-pdf-api.md (keys). Shared by Settings › API keys (your own, Developers › API keys),
// Admin › Service accounts (theirs) and Admin › API keys (everyone's). ADR 0029.

type KeyQuery = z.input<typeof apiKeyListQuerySchema>;

export const apiKeysQuery = (query: KeyQuery) =>
  queryOptions({
    queryKey: ["api-keys", query],
    queryFn: async () => (await ok(api["api-keys"].$get({ query }))).json(),
  });

export type ApiKeyRow = InferResponseType<(typeof api)["api-keys"]["$get"], 200>[number];

const statusBadge: Record<ApiKeyStatus, { label: string; variant: "ok" | "secondary" | "bad" }> = {
  active: { label: "Active", variant: "ok" },
  expired: { label: "Expired", variant: "secondary" },
  revoked: { label: "Revoked", variant: "bad" },
};

/** Scope pills shown per row before the rest collapse into "+N", so the table fits a tablet. */
const SCOPES_SHOWN = 2;

const expiresSoon = (key: ApiKeyRow) =>
  key.status === "active" &&
  key.expiresAt !== null &&
  dayjs(key.expiresAt).diff(dayjs(), "day", true) < EXPIRY_WARNING_DAYS;

type Action = { kind: "rotate" | "revoke"; key: ApiKeyRow };

/** "+N" for the scopes past the first `shown`; the rest are in its title and for screen readers. */
function MoreScopes({
  scopes,
  shown,
  className,
}: {
  scopes: readonly string[];
  shown: number;
  className?: string;
}) {
  const rest = scopes.slice(shown);
  if (!rest.length) return null;
  return (
    <Badge variant="secondary" className={cn("text-[0.7rem]", className)} title={rest.join(", ")}>
      +{rest.length}
      <span className="sr-only">: {rest.join(", ")}</span>
    </Badge>
  );
}

/**
 * The key list with rotate and revoke. `showOwner` for the admin list across owners. With no keys
 * it renders `empty` (the caller's EmptyState, usually with a create action) instead of the table.
 */
export function ApiKeyTable({
  keys,
  showOwner,
  canRotate,
  empty,
}: {
  keys: readonly ApiKeyRow[] | undefined;
  showOwner?: boolean;
  /** Admins can revoke anyone's key but only rotate service accounts' (and their own). */
  canRotate: (key: ApiKeyRow) => boolean;
  empty?: ReactNode;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null);
  const close = () => setAction(null);
  const isAdmin = useQuery(meQuery).data?.user.roles.includes("admin") === true;
  if (keys?.length === 0)
    return (
      empty ?? (
        <EmptyState
          icon={KeyIcon}
          title="No API keys yet"
          description={
            <>
              A key lets a script or another system call <code>/api/v1</code>.
            </>
          }
        />
      )
    );
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {showOwner && <TableHead className="hidden xl:table-cell">Owner</TableHead>}
            <TableHead>Scopes</TableHead>
            <TableHead className="hidden lg:table-cell">Created</TableHead>
            <TableHead>
              Expires<span className="lg:hidden"> · last used</span>
            </TableHead>
            <TableHead className="hidden lg:table-cell">Last used</TableHead>
            <TableHead className="hidden text-right xl:table-cell">Requests</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys?.map((key) => (
            <TableRow key={key.id}>
              {/* Capped below xl, so Status and the menu still fit a tablet. */}
              <TableCell className="max-w-40 xl:max-w-none [&>div]:truncate">
                <div className="font-medium" title={key.name ?? undefined}>
                  {key.name}
                </div>
                <div className="font-mono text-xs text-ink-3">{key.start}…</div>
                {key.ipAllowlist.length > 0 && (
                  <div className="text-xs text-ink-3" title={key.ipAllowlist.join(", ")}>
                    {key.ipAllowlist.length} allowed address{key.ipAllowlist.length > 1 && "es"}
                  </div>
                )}
                {showOwner && (
                  // The Owner column is hidden below xl so Status and the menu fit a tablet.
                  <div className="text-xs text-ink-3 xl:hidden">
                    <OwnerName apiKey={key} />
                    {key.ownerIsService && " · service"}
                  </div>
                )}
              </TableCell>
              {showOwner && (
                <TableCell className="hidden xl:table-cell">
                  <OwnerName apiKey={key} />
                  <div className="text-xs text-ink-3">
                    {key.ownerIsService ? "Service account" : "Person"}
                    {key.ownerDisabled && " · disabled"}
                  </div>
                </TableCell>
              )}
              <TableCell>
                {/* One line: one pill below lg, SCOPES_SHOWN from lg, then "+N" for the rest. */}
                <div className="flex flex-nowrap gap-1">
                  {key.scopes.slice(0, SCOPES_SHOWN).map((scope, i) => (
                    <Badge
                      key={scope}
                      variant="secondary"
                      className={cn(
                        "max-w-28 font-mono text-[0.7rem] lg:max-w-none",
                        i > 0 && "hidden lg:inline-flex",
                      )}
                      title={scope}
                    >
                      <span className="truncate">{scope}</span>
                    </Badge>
                  ))}
                  <MoreScopes scopes={key.scopes} shown={1} className="lg:hidden" />
                  <MoreScopes
                    scopes={key.scopes}
                    shown={SCOPES_SHOWN}
                    className="hidden lg:inline-flex"
                  />
                </div>
                {key.templateIds.length > 0 && (
                  <div className="text-xs text-ink-3">
                    {key.templateIds.length} template{key.templateIds.length > 1 && "s"} only
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden tabular-nums lg:table-cell">
                {dayjs(key.createdAt).format("YYYY-MM-DD")}
              </TableCell>
              <TableCell className="tabular-nums">
                {key.expiresAt ? (
                  <span
                    className="flex items-center gap-1"
                    title={dayjs(key.expiresAt).format("YYYY-MM-DD HH:mm")}
                  >
                    {expiresSoon(key) && (
                      <WarningIcon className="size-4 text-warn" aria-label="Expires soon" />
                    )}
                    {dayjs(key.expiresAt).fromNow()}
                  </span>
                ) : (
                  <span className="text-ink-3">Never</span>
                )}
                {/* Last used is its own column from lg; below that it folds in here. */}
                <div className="text-xs whitespace-nowrap text-ink-3 lg:hidden">
                  {key.lastUsedAt ? `Used ${dayjs(key.lastUsedAt).fromNow()}` : "Never used"}
                </div>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {key.lastUsedAt ? (
                  <>
                    {dayjs(key.lastUsedAt).fromNow()}
                    <div className="font-mono text-xs text-ink-3">{key.lastUsedIp}</div>
                  </>
                ) : (
                  <span className="text-ink-3">Never</span>
                )}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums xl:table-cell">
                {key.requests.toLocaleString()}
              </TableCell>
              <TableCell>
                {key.status === "active" && key.ownerDisabled ? (
                  // The key itself is fine, but its owner is disabled, so every call gets 401.
                  <Badge variant="warn" dot title="Its owner is disabled; calls get 401">
                    Owner disabled
                  </Badge>
                ) : (
                  <Badge variant={statusBadge[key.status].variant} dot>
                    {statusBadge[key.status].label}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${key.name}`}
                      />
                    }
                  >
                    <DotsThreeIcon weight="bold" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={<Link to="/generations" search={{ apiKeyId: key.id }} />}
                    >
                      Generation log
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem
                        render={
                          <Link
                            to="/admin/audit"
                            search={{ targetType: "api_key", targetId: key.id }}
                          />
                        }
                      >
                        History
                      </DropdownMenuItem>
                    )}
                    {key.status === "active" && canRotate(key) && (
                      <DropdownMenuItem onClick={() => setAction({ kind: "rotate", key })}>
                        Rotate…
                      </DropdownMenuItem>
                    )}
                    {key.status !== "revoked" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setAction({ kind: "revoke", key })}
                        >
                          Revoke…
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {action?.kind === "rotate" && (
        <RotateDialog
          apiKey={action.key}
          onClose={close}
          onRotated={(created) => {
            close();
            setSecret(created);
          }}
        />
      )}
      {action?.kind === "revoke" && <RevokeDialog apiKey={action.key} onClose={close} />}
      {secret && <KeySecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function OwnerName({ apiKey }: { apiKey: ApiKeyRow }) {
  return apiKey.ownerIsService ? (
    <Link
      to="/admin/service-accounts/$id"
      params={{ id: apiKey.ownerId }}
      className="hover:underline"
    >
      {apiKey.ownerName}
    </Link>
  ) : (
    apiKey.ownerName
  );
}

/**
 * A secret shown once (API keys, webhook signing secrets). Copy is the main action; closing before
 * copying asks first, since the secret can't be shown again.
 */
export function SecretDialog({
  title,
  description,
  secret,
  copyLabel,
  onClose,
}: {
  title: string;
  description: ReactNode;
  secret: string;
  copyLabel: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setConfirming(false);
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it yourself." });
    }
  };
  const close = () => (copied || confirming ? onClose() : setConfirming(true));
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent initialFocus={copyRef}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <pre
          className="rounded-lg bg-tint px-3 py-2.5 font-mono text-xs break-all whitespace-pre-wrap select-all"
          // A manual select-and-copy counts too.
          onCopy={() => setCopied(true)}
        >
          {secret}
        </pre>
        <p className="flex items-start gap-2 text-sm font-medium text-warn" role="alert">
          <WarningIcon className="mt-0.5 size-4 shrink-0" />
          {confirming
            ? "You haven't copied it. Close anyway? It can't be shown again."
            : "You won't see this again once you close this dialog."}
        </p>
        <DialogFooter>
          <Button variant={confirming ? "destructive" : "outline"} onClick={close}>
            {confirming ? "Close without copying" : "Done"}
          </Button>
          <Button ref={copyRef} onClick={copy}>
            {copied ? <CheckIcon weight="bold" /> : <CopyIcon />}
            {copied ? "Copied" : copyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The SecretDialog for a new or rotated key. */
function KeySecretDialog({
  secret,
  onClose,
}: {
  secret: { key: string; name: string };
  onClose: () => void;
}) {
  return (
    <SecretDialog
      title="Copy your key"
      description={
        <>
          {secret.name}: store it in your secret manager. If it's lost, rotate it or make a new one.
        </>
      }
      secret={secret.key}
      copyLabel="Copy key"
      onClose={onClose}
    />
  );
}

const useInvalidateKeys = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["api-keys"] });
};

/** When the old key stops after a rotation: the overlap end, or its own expiry if sooner (as the API does). */
function oldKeyStops(apiKey: ApiKeyRow, overlapHours: number) {
  if (overlapHours === 0) return "The old key stops working as soon as you rotate.";
  const overlapEnd = dayjs().add(overlapHours, "hour");
  const end =
    apiKey.expiresAt && dayjs(apiKey.expiresAt).isBefore(overlapEnd)
      ? dayjs(apiKey.expiresAt)
      : overlapEnd;
  return `The old key stops working ${end.format("ddd D MMM, HH:mm")} (${end.fromNow()}).`;
}

function RotateDialog({
  apiKey,
  onClose,
  onRotated,
}: {
  apiKey: ApiKeyRow;
  onClose: () => void;
  onRotated: (created: { key: string; name: string }) => void;
}) {
  const [overlapHours, setOverlapHours] = useState(24);
  const invalidate = useInvalidateKeys();
  const rotate = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api["api-keys"][":id"].rotate.$post({ param: { id: apiKey.id }, json: { overlapHours } }),
        )
      ).json(),
    onSuccess: async (created) => {
      await invalidate();
      onRotated(created);
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate {apiKey.name}?</DialogTitle>
          <DialogDescription>
            Makes a replacement with the same scopes, templates, allowlist and rate limit. The old
            key keeps working for the overlap, then expires. Deploy the new key before it ends.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="overlap">Overlap</FieldLabel>
          <NativeSelect
            id="overlap"
            value={String(overlapHours)}
            onChange={(e) => setOverlapHours(Number(e.target.value))}
          >
            <NativeSelectOption value="0">None: stop the old key now</NativeSelectOption>
            <NativeSelectOption value="1">1 hour</NativeSelectOption>
            <NativeSelectOption value="24">24 hours</NativeSelectOption>
            <NativeSelectOption value="168">7 days</NativeSelectOption>
            <NativeSelectOption value="720">30 days</NativeSelectOption>
          </NativeSelect>
          <FieldDescription>{oldKeyStops(apiKey, overlapHours)}</FieldDescription>
        </Field>
        <ErrorAlert error={rotate.error} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={rotate.isPending} onClick={() => rotate.mutate()}>
            Rotate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ apiKey, onClose }: { apiKey: ApiKeyRow; onClose: () => void }) {
  const invalidate = useInvalidateKeys();
  const revoke = useMutation({
    mutationFn: () => ok(api["api-keys"][":id"].revoke.$post({ param: { id: apiKey.id } })),
    onSuccess: async () => {
      await invalidate();
      onClose();
      toast.success(`Revoked ${apiKey.name}`);
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {apiKey.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Every call with it gets 401 from now on. It stays listed, and the generation log keeps
            its name. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={revoke.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const lines = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

/** The form's own shape; it becomes a CreateApiKey on submit. */
const keyFormSchema = z.object({
  name: createApiKeySchema.shape.name,
  /** Days, or "" for never. */
  expires: z.string(),
  scopes: z.array(apiScopeSchema).min(1, "Pick at least one scope"),
  templateIds: z.array(z.string()),
  ipAllowlist: z
    .string()
    .refine(
      (text) => lines(text).every((entry) => ipAllowEntrySchema.safeParse(entry).success),
      "One address or CIDR range per line, like 203.0.113.7 or 10.0.0.0/8",
    ),
  rateLimitPerMinute: z.number().int().min(1).max(MAX_RATE_LIMIT_PER_MINUTE),
});
type KeyForm = z.infer<typeof keyFormSchema>;

/**
 * Creates a key for you, or for a service account (`ownerId`). Scopes the owner's roles don't
 * allow are shown disabled; the API refuses them too.
 */
export function CreateKeyDialog({
  ownerId,
  ownerRoles,
  onClose,
  onCreated,
}: {
  ownerId?: string;
  ownerRoles: readonly Role[];
  onClose: () => void;
  onCreated: (created: { key: string; name: string }) => void;
}) {
  const templates = useQuery(templatesQuery);
  const invalidate = useInvalidateKeys();
  const create = useMutation({
    mutationFn: async (json: CreateApiKeyInput) =>
      (await ok(api["api-keys"].$post({ json }))).json(),
    onSuccess: async (created) => {
      await invalidate();
      onCreated(created);
    },
  });
  const defaultValues: KeyForm = {
    name: "",
    expires: "90",
    scopes: [],
    templateIds: [],
    ipAllowlist: "",
    rateLimitPerMinute: 120,
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: keyFormSchema },
    onSubmit: ({ value }) =>
      create.mutate({
        name: value.name,
        scopes: value.scopes,
        templateIds: value.templateIds,
        ipAllowlist: lines(value.ipAllowlist),
        rateLimitPerMinute: value.rateLimitPerMinute,
        expiresInDays: value.expires ? Number(value.expires) : null,
        ...(ownerId ? { ownerId } : {}),
      }),
  });
  const published = (templates.data ?? []).filter((t) => t.latestVersion !== null && !t.archivedAt);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give it only the scopes the integration needs. The key is shown once.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" placeholder="Billing system (production)" />
              )}
            </form.AppField>
            <form.Field name="scopes">
              {(field) => (
                <FieldSet>
                  <FieldLegend variant="label">Scopes</FieldLegend>
                  <div className="grid gap-2">
                    {apiScopeSchema.options.map((scope) => {
                      const allowed = hasPermission(ownerRoles, apiScopes[scope].needs);
                      return (
                        <Field key={scope} orientation="horizontal" data-disabled={!allowed}>
                          <Checkbox
                            id={`scope-${scope}`}
                            disabled={!allowed}
                            checked={field.state.value.includes(scope)}
                            onCheckedChange={(checked) =>
                              field.handleChange(
                                apiScopeSchema.options.filter((s) =>
                                  s === scope ? checked : field.state.value.includes(s),
                                ),
                              )
                            }
                          />
                          <FieldLabel htmlFor={`scope-${scope}`} className="font-normal">
                            <span className="font-mono text-xs">{scope}</span>
                            <span className="text-ink-3">{apiScopes[scope].label}</span>
                          </FieldLabel>
                        </Field>
                      );
                    })}
                  </div>
                  {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
                </FieldSet>
              )}
            </form.Field>
            <form.Field name="expires">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="expires">Expires</FieldLabel>
                  <NativeSelect
                    id="expires"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <NativeSelectOption value="30">In 30 days</NativeSelectOption>
                    <NativeSelectOption value="90">In 90 days</NativeSelectOption>
                    <NativeSelectOption value="365">In a year</NativeSelectOption>
                    <NativeSelectOption value="">Never</NativeSelectOption>
                  </NativeSelect>
                </Field>
              )}
            </form.Field>
            <form.Field name="templateIds">
              {(field) => (
                <FieldSet>
                  <FieldLegend variant="label">Templates (optional)</FieldLegend>
                  <p className="text-sm text-ink-3">None ticked: every published template.</p>
                  <div className="grid max-h-40 gap-2 overflow-y-auto">
                    {published.map((template) => (
                      <Field key={template.id} orientation="horizontal">
                        <Checkbox
                          id={`template-${template.id}`}
                          checked={field.state.value.includes(template.id)}
                          onCheckedChange={(checked) =>
                            field.handleChange(
                              checked
                                ? [...field.state.value, template.id]
                                : field.state.value.filter((id) => id !== template.id),
                            )
                          }
                        />
                        <FieldLabel htmlFor={`template-${template.id}`} className="font-normal">
                          {template.name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </FieldSet>
              )}
            </form.Field>
            <form.Field name="ipAllowlist">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="ipAllowlist">IP allowlist (optional)</FieldLabel>
                    <Textarea
                      id="ipAllowlist"
                      rows={3}
                      className="font-mono text-xs"
                      placeholder={"203.0.113.7\n10.0.0.0/8"}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.AppField name="rateLimitPerMinute">
              {(field) => <field.NumberField label="Rate limit (requests per minute)" step={1} />}
            </form.AppField>
            <ErrorAlert error={create.error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Create key" plus the secret afterwards, for pages that list one owner's keys. `requested`
 * opens the dialog from outside (the page's ?new=, from the command palette); `onDone` clears it.
 */
export function CreateKeyButton({
  requested = false,
  onDone,
  ...props
}: {
  ownerId?: string;
  ownerRoles: readonly Role[];
  requested?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null);
  const close = () => {
    setOpen(false);
    onDone?.();
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create key</Button>
      {(open || requested) && (
        <CreateKeyDialog
          {...props}
          onClose={close}
          onCreated={(created) => {
            close();
            setSecret(created);
          }}
        />
      )}
      {secret && <KeySecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

/** Keys about to expire, so nobody finds out from a 401. */
export function ExpiryWarning({ keys }: { keys: readonly ApiKeyRow[] | undefined }) {
  const soon = keys?.filter(expiresSoon) ?? [];
  if (!soon.length) return null;
  return (
    <Alert>
      <WarningIcon />
      <AlertDescription>
        {soon.map((key) => key.name).join(", ")} {soon.length > 1 ? "expire" : "expires"} within{" "}
        {EXPIRY_WARNING_DAYS} days. Rotate {soon.length > 1 ? "them" : "it"} before then.
      </AlertDescription>
    </Alert>
  );
}
