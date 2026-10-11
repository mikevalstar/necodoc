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
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { MoreHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert, useAppForm } from "@/components/form";
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { meQuery } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";

// Spec: docs/features/html-to-pdf-api.md (keys). Shared by Settings › API keys (your own),
// Admin › Service accounts (theirs) and Admin › API keys (everyone's). ADR 0029.

type KeyQuery = z.input<typeof apiKeyListQuerySchema>;

export const apiKeysQuery = (query: KeyQuery) =>
  queryOptions({
    queryKey: ["api-keys", query],
    queryFn: async () => (await ok(api["api-keys"].$get({ query }))).json(),
  });

export type ApiKeyRow = InferResponseType<(typeof api)["api-keys"]["$get"], 200>[number];

const statusBadge: Record<
  ApiKeyStatus,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  active: { label: "Active", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
  revoked: { label: "Revoked", variant: "destructive" },
};

const expiresSoon = (key: ApiKeyRow) =>
  key.status === "active" &&
  key.expiresAt !== null &&
  dayjs(key.expiresAt).diff(dayjs(), "day", true) < EXPIRY_WARNING_DAYS;

type Action = { kind: "rotate" | "revoke"; key: ApiKeyRow };

/** The key list with rotate and revoke. `showOwner` for the admin list across owners. */
export function ApiKeyTable({
  keys,
  showOwner,
  canRotate,
}: {
  keys: readonly ApiKeyRow[] | undefined;
  showOwner?: boolean;
  /** Admins can revoke anyone's key but only rotate service accounts' (and their own). */
  canRotate: (key: ApiKeyRow) => boolean;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null);
  const close = () => setAction(null);
  const isAdmin = useQuery(meQuery).data?.user.roles.includes("admin") === true;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {showOwner && <TableHead>Owner</TableHead>}
            <TableHead>Scopes</TableHead>
            <TableHead className="hidden md:table-cell">Created</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="hidden lg:table-cell">Last used</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys?.map((key) => (
            <TableRow key={key.id}>
              <TableCell>
                <div className="font-medium">{key.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{key.start}…</div>
                {key.ipAllowlist.length > 0 && (
                  <div className="text-xs text-muted-foreground" title={key.ipAllowlist.join(", ")}>
                    {key.ipAllowlist.length} allowed address{key.ipAllowlist.length > 1 && "es"}
                  </div>
                )}
              </TableCell>
              {showOwner && (
                <TableCell>
                  {key.ownerIsService ? (
                    <Link
                      to="/admin/service-accounts/$id"
                      params={{ id: key.ownerId }}
                      className="hover:underline"
                    >
                      {key.ownerName}
                    </Link>
                  ) : (
                    key.ownerName
                  )}
                  <div className="text-xs text-muted-foreground">
                    {key.ownerIsService ? "Service account" : "Person"}
                    {key.ownerDisabled && " · disabled"}
                  </div>
                </TableCell>
              )}
              <TableCell>
                <div className="flex max-w-64 flex-wrap gap-1">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} variant="outline" className="font-mono text-[0.7rem]">
                      {scope}
                    </Badge>
                  ))}
                </div>
                {key.templateIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {key.templateIds.length} template{key.templateIds.length > 1 && "s"} only
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">
                {dayjs(key.createdAt).format("YYYY-MM-DD")}
              </TableCell>
              <TableCell className="tabular-nums">
                {key.expiresAt ? (
                  <span
                    className="flex items-center gap-1"
                    title={dayjs(key.expiresAt).format("YYYY-MM-DD HH:mm")}
                  >
                    {expiresSoon(key) && (
                      <TriangleAlertIcon
                        className="size-4 text-amber-600"
                        aria-label="Expires soon"
                      />
                    )}
                    {dayjs(key.expiresAt).fromNow()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {key.lastUsedAt ? (
                  <>
                    {dayjs(key.lastUsedAt).fromNow()}
                    <div className="font-mono text-xs text-muted-foreground">{key.lastUsedIp}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {key.requests.toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge variant={statusBadge[key.status].variant}>
                  {statusBadge[key.status].label}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
                  >
                    <MoreHorizontalIcon />
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
          {keys?.length === 0 && (
            <TableRow>
              <TableCell colSpan={showOwner ? 9 : 8} className="text-center text-muted-foreground">
                No API keys.
              </TableCell>
            </TableRow>
          )}
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
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

/** The secret, once. */
export function SecretDialog({
  secret,
  onClose,
}: {
  secret: { key: string; name: string };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your key</DialogTitle>
          <DialogDescription>
            {secret.name}: this is the only time it's shown. Store it in your secret manager; if
            it's lost, rotate or make a new one.
          </DialogDescription>
        </DialogHeader>
        <Input
          readOnly
          className="font-mono text-xs"
          value={secret.key}
          onFocus={(e) => e.target.select()}
        />
        <DialogFooter>
          <CopyButton text={secret.key} label="Copy key" />
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const useInvalidateKeys = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["api-keys"] });
};

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
                            <span className="text-muted-foreground">{apiScopes[scope].label}</span>
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
                  <p className="text-sm text-muted-foreground">
                    None ticked: every published template.
                  </p>
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

/** "Create key" plus the secret afterwards, for pages that list one owner's keys. */
export function CreateKeyButton(props: { ownerId?: string; ownerRoles: readonly Role[] }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ key: string; name: string } | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create key</Button>
      {open && (
        <CreateKeyDialog
          {...props}
          onClose={() => setOpen(false)}
          onCreated={(created) => {
            setOpen(false);
            setSecret(created);
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}

/** Keys about to expire, so nobody finds out from a 401. */
export function ExpiryWarning({ keys }: { keys: readonly ApiKeyRow[] | undefined }) {
  const soon = keys?.filter(expiresSoon) ?? [];
  if (!soon.length) return null;
  return (
    <Alert>
      <TriangleAlertIcon />
      <AlertDescription>
        {soon.map((key) => key.name).join(", ")} {soon.length > 1 ? "expire" : "expires"} within{" "}
        {EXPIRY_WARNING_DAYS} days. Rotate {soon.length > 1 ? "them" : "it"} before then.
      </AlertDescription>
    </Alert>
  );
}
