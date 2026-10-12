import { createShareLinkSchema, isEmptyValue } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorAlert } from "@/components/form";
import { GuidedForm } from "@/components/guided-form";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { shareLinksQuery, templatesQuery } from "@/lib/queries";

// Spec: docs/features/share-links-and-data-requests.md. One dialog creates and edits a link; the
// template can't change once the link exists.

export type ShareLinkRow = Awaited<ReturnType<NonNullable<typeof shareLinksQuery.queryFn>>>[number];

/** What's live: disabled wins, then expiry, then the submission limit. */
export function linkState(link: ShareLinkRow) {
  if (link.disabledAt) return { label: "Disabled", live: false } as const;
  if (link.expiresAt && dayjs(link.expiresAt).isBefore(dayjs())) {
    return { label: "Expired", live: false } as const;
  }
  if (link.maxSubmissions !== null && link.submissions >= link.maxSubmissions) {
    return { label: "Used up", live: false } as const;
  }
  return { label: "Active", live: true } as const;
}

export function LinkStateBadge({ link }: { link: ShareLinkRow }) {
  const state = linkState(link);
  return <Badge variant={state.live ? "secondary" : "outline"}>{state.label}</Badge>;
}

/** Disable (revoke) or re-enable a link. */
export function useToggleShareLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      ok(api["share-links"][":id"].$patch({ param: { id }, json: { disabled } })),
    onSuccess: (_, { disabled }) => {
      toast.success(disabled ? "Link disabled: it stops working at once" : "Link enabled");
      return queryClient.invalidateQueries({ queryKey: shareLinksQuery.queryKey });
    },
  });
}

export const publicLinkUrl = (token: string) => `${window.location.origin}/s/${token}`;

export async function copyLink(token: string) {
  await navigator.clipboard.writeText(publicLinkUrl(token));
  toast.success("Link copied");
}

type Prefill = Record<string, unknown>;

export function ShareLinkDialog({
  link,
  onClose,
}: {
  /** Edit this link; without it, create one. */
  link?: ShareLinkRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const templates = useQuery(templatesQuery);
  const published = (templates.data ?? []).filter((t) => t.latestVersion !== null && !t.archivedAt);
  const [templateId, setTemplateId] = useState(link?.templateId ?? "");
  const [version, setVersion] = useState<number | null>(link?.version ?? null);
  const [label, setLabel] = useState(link?.label ?? "");
  const [expiresOn, setExpiresOn] = useState(
    link?.expiresAt ? dayjs(link.expiresAt).format("YYYY-MM-DD") : "",
  );
  const [maxSubmissions, setMaxSubmissions] = useState(link?.maxSubmissions?.toString() ?? "");
  const [requireEmail, setRequireEmail] = useState(link?.requireEmail ?? false);
  const [allowDownload, setAllowDownload] = useState(link?.allowDownload ?? true);
  const [prefill, setPrefill] = useState<Prefill>(link?.prefill ?? {});
  const [lockedKeys, setLockedKeys] = useState<readonly string[]>(link?.lockedKeys ?? []);

  const versions = useQuery({
    queryKey: ["templates", templateId, "versions"],
    queryFn: async () =>
      (await ok(api.templates[":id"].versions.$get({ param: { id: templateId } }))).json(),
    enabled: !!templateId,
  });
  const fields = useQuery({
    queryKey: ["templates", templateId, "versions", version ?? "latest"],
    queryFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].$get({
            param: { id: templateId, version: String(version ?? "latest") },
          }),
        )
      ).json(),
    enabled: !!templateId,
  });
  const sections = fields.data?.sections ?? [];
  const prefillable = sections
    .flatMap((s) => s.fields)
    .filter((field) => !isEmptyValue(prefill[field.key]));

  const save = useMutation({
    mutationFn: async () => {
      const options = createShareLinkSchema.parse({
        templateId,
        label,
        version,
        expiresAt: expiresOn ? dayjs(expiresOn).endOf("day").toISOString() : null,
        maxSubmissions: maxSubmissions ? Number(maxSubmissions) : null,
        requireEmail,
        allowDownload,
        prefill,
        lockedKeys: lockedKeys.filter((key) => prefillable.some((f) => f.key === key)),
      });
      if (!link) return (await ok(api["share-links"].$post({ json: options }))).json();
      const { templateId: _t, ...changes } = options;
      await ok(api["share-links"][":id"].$patch({ param: { id: link.id }, json: changes }));
      return null;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: shareLinksQuery.queryKey });
      // The create answer has only the id; the refetched list has the token.
      const token = created
        ? queryClient.getQueryData(shareLinksQuery.queryKey)?.find((l) => l.id === created.id)
            ?.token
        : undefined;
      if (created) {
        toast.success("Share link created", {
          action: token ? { label: "Copy link", onClick: () => void copyLink(token) } : undefined,
        });
      } else {
        toast.success("Share link saved");
      }
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {/* Not a <form>: the prefill GuidedForm is one, and forms don't nest. */}
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle>{link ? "Edit share link" : "New share link"}</DialogTitle>
            <DialogDescription>
              Anyone with the link can fill this template without an account. Their answers and PDF
              come to you.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="link-template">Template</FieldLabel>
              <NativeSelect
                id="link-template"
                className="w-full"
                value={templateId}
                disabled={!!link}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setVersion(null);
                  setPrefill({});
                  setLockedKeys([]);
                }}
              >
                <NativeSelectOption value="">Choose…</NativeSelectOption>
                {published.map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="link-version">Version</FieldLabel>
              <NativeSelect
                id="link-version"
                className="w-full"
                value={version ?? ""}
                disabled={!templateId}
                onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : null)}
              >
                <NativeSelectOption value="">Latest (follows new versions)</NativeSelectOption>
                {versions.data?.map((v) => (
                  <NativeSelectOption key={v.id} value={v.version}>
                    Version {v.version}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="link-label">Label</FieldLabel>
              <Input
                id="link-label"
                placeholder="Acme onboarding"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <FieldDescription>For you; the filler sees it under the title.</FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="link-expires">Expires after (optional)</FieldLabel>
                <Input
                  id="link-expires"
                  type="date"
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="link-max">Maximum submissions (optional)</FieldLabel>
                <Input
                  id="link-max"
                  type="number"
                  min={1}
                  placeholder="No limit"
                  value={maxSubmissions}
                  onChange={(e) => setMaxSubmissions(e.target.value)}
                />
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch id="link-email" checked={requireEmail} onCheckedChange={setRequireEmail} />
              <FieldLabel htmlFor="link-email" className="font-normal">
                Ask for the filler's email address
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="link-download"
                checked={allowDownload}
                onCheckedChange={setAllowDownload}
              />
              <FieldLabel htmlFor="link-download" className="font-normal">
                Let the filler download their PDF
              </FieldLabel>
            </Field>
            {sections.length > 0 && (
              <FieldSet>
                <FieldLegend>Prefilled answers (optional)</FieldLegend>
                <FieldDescription>
                  The filler starts with these. Lock one to stop it being changed.
                </FieldDescription>
                <div className="rounded-lg border p-3">
                  <GuidedForm
                    key={`${templateId}:${version}`}
                    sections={sections}
                    defaultValues={prefill}
                    layout="all"
                    onChange={setPrefill}
                  />
                </div>
                {prefillable.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Locked</div>
                    {prefillable.map((field) => (
                      <Field key={field.key} orientation="horizontal">
                        <Checkbox
                          id={`lock-${field.key}`}
                          checked={lockedKeys.includes(field.key)}
                          onCheckedChange={(checked) =>
                            setLockedKeys((keys) =>
                              checked ? [...keys, field.key] : keys.filter((k) => k !== field.key),
                            )
                          }
                        />
                        <FieldLabel htmlFor={`lock-${field.key}`} className="font-normal">
                          {field.label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                )}
              </FieldSet>
            )}
          </FieldGroup>
          <ErrorAlert error={save.error ?? templates.error ?? fields.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={save.isPending || !templateId || !label.trim()}
              onClick={() => save.mutate()}
            >
              {link ? "Save" : "Create link"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
