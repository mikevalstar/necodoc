import {
  type CreateWebhookInput,
  createWebhookSchema,
  type WebhookDeliveryStatus,
  webhookEventSchema,
} from "@necodoc/shared";
import { DotsThreeIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { type ApiKeyRow, SecretDialog } from "@/components/api-keys";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert, useAppForm } from "@/components/form";
import { CardBar, EmptyState, ListSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";

// Spec: docs/features/webhooks.md. One owner's webhooks: yours in Developers › API keys, a service
// account's on its admin page.

const webhooksQuery = (ownerId: string | undefined) =>
  queryOptions({
    queryKey: ["webhooks", ownerId ?? "me"],
    queryFn: async () =>
      (await ok(api.webhooks.$get({ query: ownerId ? { ownerId } : {} }))).json(),
  });

type Webhook = InferResponseType<typeof api.webhooks.$get, 200>[number];

const eventLabels: Record<z.infer<typeof webhookEventSchema>, string> = {
  "generation.succeeded": "Generation succeeded",
  "generation.failed": "Generation failed",
  "batch.completed": "Batch completed",
};

const deliveryBadge: Record<WebhookDeliveryStatus, "ok" | "run" | "bad"> = {
  success: "ok",
  pending: "run",
  failed: "bad",
};

function scopeLabel(hook: Webhook) {
  const parts = [
    hook.apiKeyId && `Key: ${hook.apiKeyName ?? "deleted"}`,
    hook.templateId && `Template: ${hook.templateName ?? "deleted"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Every API call by this account";
}

export function WebhookSection({
  ownerId,
  keys,
  canTemplateWebhooks,
}: {
  /** A service account's id; omitted for your own. */
  ownerId?: string;
  keys: readonly ApiKeyRow[] | undefined;
  /** Template-wide webhooks need document: edit. */
  canTemplateWebhooks: boolean;
}) {
  const hooks = useQuery(webhooksQuery(ownerId));
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [log, setLog] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["webhooks"] });
  const toggle = useMutation({
    mutationFn: (hook: Webhook) =>
      ok(api.webhooks[":id"].$patch({ param: { id: hook.id }, json: { enabled: !hook.enabled } })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (hook: Webhook) => ok(api.webhooks[":id"].$delete({ param: { id: hook.id } })),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
      toast.success("Webhook deleted");
    },
  });
  const test = useMutation({
    mutationFn: (hook: Webhook) => ok(api.webhooks[":id"].test.$post({ param: { id: hook.id } })),
    onSuccess: () =>
      toast.success("Test event queued", { description: "Open Deliveries to see how it went." }),
  });
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title="Webhooks"
        description="Signed HTTPS POSTs when generations and batches finish."
      >
        {hooks.data && hooks.data.length > 0 && (
          <Button variant="outline" onClick={() => setCreating(true)}>
            Add webhook
          </Button>
        )}
      </CardBar>
      {(hooks.error ?? toggle.error ?? test.error) && (
        <div className="px-4 pt-4">
          <ErrorAlert error={hooks.error ?? toggle.error ?? test.error} />
        </div>
      )}
      {hooks.isPending ? (
        <ListSkeleton className="p-4" rows={2} />
      ) : hooks.data?.length === 0 ? (
        <EmptyState
          className="m-4"
          icon={WebhooksLogoIcon}
          title="No webhooks yet"
          description="Add one to be told when generations and batches finish, instead of polling."
          action={<Button onClick={() => setCreating(true)}>Add webhook</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead className="hidden lg:table-cell">Fires for</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hooks.data?.map((hook) => (
              <TableRow key={hook.id}>
                <TableCell className="max-w-72">
                  <div className="truncate font-mono text-xs" title={hook.url}>
                    {hook.url}
                  </div>
                  {hook.description && <div className="text-xs text-ink-3">{hook.description}</div>}
                  <div className="text-xs text-ink-3 lg:hidden">{scopeLabel(hook)}</div>
                </TableCell>
                <TableCell className="hidden text-sm lg:table-cell">{scopeLabel(hook)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {hook.events.map((event) => (
                      <Badge key={event} variant="secondary" className="font-mono text-[0.7rem]">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    aria-label={`Enabled: ${hook.url}`}
                    checked={hook.enabled}
                    disabled={toggle.isPending}
                    onCheckedChange={() => toggle.mutate(hook)}
                  />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${hook.url}`}
                        />
                      }
                    >
                      <DotsThreeIcon weight="bold" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setLog(hook)}>Deliveries</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => test.mutate(hook)}>
                        Send test
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(hook)}>
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {creating && (
        <CreateWebhookDialog
          ownerId={ownerId}
          keys={keys?.filter((key) => key.status === "active") ?? []}
          canTemplateWebhooks={canTemplateWebhooks}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setSecret(created);
            refresh();
          }}
        />
      )}
      {secret && (
        <SecretDialog
          title="Copy the signing secret"
          description="Your endpoint uses it to check the Necodoc-Signature header. To get a new one, delete the webhook and add it again."
          secret={secret}
          copyLabel="Copy secret"
          onClose={() => setSecret(null)}
        />
      )}
      {log && <DeliveriesDialog hook={log} onClose={() => setLog(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this webhook?"
          description={`${deleting.url} stops receiving events at once, and its delivery history goes with it.`}
          confirmLabel="Delete"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}

const webhookFormSchema = z.object({
  url: createWebhookSchema.shape.url,
  description: z.string().max(200),
  events: createWebhookSchema.shape.events,
  apiKeyId: z.string(),
  templateId: z.string(),
});
type WebhookForm = z.infer<typeof webhookFormSchema>;

function CreateWebhookDialog({
  ownerId,
  keys,
  canTemplateWebhooks,
  onClose,
  onCreated,
}: {
  ownerId?: string;
  keys: readonly ApiKeyRow[];
  canTemplateWebhooks: boolean;
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const templates = useQuery(templatesQuery);
  const create = useMutation({
    mutationFn: async (json: CreateWebhookInput) => (await ok(api.webhooks.$post({ json }))).json(),
    onSuccess: (created) => onCreated(created.secret),
  });
  const defaultValues: WebhookForm = {
    url: "",
    description: "",
    events: ["generation.succeeded", "generation.failed", "batch.completed"],
    apiKeyId: "",
    templateId: "",
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: webhookFormSchema },
    onSubmit: ({ value }) =>
      create.mutate({
        url: value.url,
        description: value.description,
        events: value.events,
        ...(value.apiKeyId ? { apiKeyId: value.apiKeyId } : {}),
        ...(value.templateId ? { templateId: value.templateId } : {}),
        ...(ownerId ? { ownerId } : {}),
      }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>
              HTTPS only, to a public address. Without a key or template it fires for every API call
              this account makes.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="url">
              {(field) => <field.TextField label="URL" placeholder="https://example.com/necodoc" />}
            </form.AppField>
            <form.AppField name="description">
              {(field) => <field.TextField label="Description (optional)" />}
            </form.AppField>
            <form.Field name="events">
              {(field) => (
                <FieldSet>
                  <FieldLegend variant="label">Events</FieldLegend>
                  {webhookEventSchema.options.map((event) => (
                    <Field key={event} orientation="horizontal">
                      <Checkbox
                        id={`event-${event}`}
                        checked={field.state.value.includes(event)}
                        onCheckedChange={(checked) =>
                          field.handleChange(
                            webhookEventSchema.options.filter((e) =>
                              e === event ? checked : field.state.value.includes(e),
                            ),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`event-${event}`} className="font-normal">
                        {eventLabels[event]}
                      </FieldLabel>
                    </Field>
                  ))}
                  {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
                </FieldSet>
              )}
            </form.Field>
            <form.Field name="apiKeyId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="apiKeyId">Only calls with this key</FieldLabel>
                  <NativeSelect
                    id="apiKeyId"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <NativeSelectOption value="">Any key</NativeSelectOption>
                    {keys.map((key) => (
                      <NativeSelectOption key={key.id} value={key.id}>
                        {key.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </form.Field>
            <form.Field name="templateId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="templateId">Only this template</FieldLabel>
                  <NativeSelect
                    id="templateId"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  >
                    <NativeSelectOption value="">Any template</NativeSelectOption>
                    {(templates.data ?? []).map((template) => (
                      <NativeSelectOption key={template.id} value={template.id}>
                        {template.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {!canTemplateWebhooks && (
                    <p className="text-xs text-ink-3">
                      A template alone (any key, any source) needs the editor role.
                    </p>
                  )}
                </Field>
              )}
            </form.Field>
            <ErrorAlert error={create.error} />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Add webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesDialog({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const deliveries = useQuery({
    queryKey: ["webhooks", hook.id, "deliveries"],
    queryFn: async () =>
      (await ok(api.webhooks[":id"].deliveries.$get({ param: { id: hook.id } }))).json(),
    // Retries land over a few minutes; keep the log live while it's open.
    refetchInterval: 5000,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Deliveries</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{hook.url}</DialogDescription>
        </DialogHeader>
        <ErrorAlert error={deliveries.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.data?.map((delivery) => (
              <TableRow key={delivery.id} className="align-top">
                <TableCell className="tabular-nums">
                  {dayjs(delivery.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                </TableCell>
                <TableCell className="font-mono text-xs">{delivery.event}</TableCell>
                <TableCell>
                  <Badge variant={deliveryBadge[delivery.status]} dot className="capitalize">
                    {delivery.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ol className="space-y-1 text-xs">
                    {delivery.attempts.map((attempt) => (
                      <li key={attempt.at} className="tabular-nums">
                        {dayjs(attempt.at).format("HH:mm:ss")} ·{" "}
                        {attempt.status === null ? "no response" : `HTTP ${attempt.status}`} ·{" "}
                        {attempt.ms} ms
                        {attempt.error && <span className="text-ink-3"> · {attempt.error}</span>}
                      </li>
                    ))}
                  </ol>
                </TableCell>
              </TableRow>
            ))}
            {deliveries.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-ink-3">
                  Nothing sent yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
