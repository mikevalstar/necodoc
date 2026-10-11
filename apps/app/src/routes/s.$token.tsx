import type { FieldSection } from "@necodoc/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { CheckCircle2Icon, DownloadIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { GuidedForm } from "@/components/guided-form";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ok } from "@/lib/api";

// Spec: docs/features/share-links-and-data-requests.md. Public: no session, no app chrome. The
// answers stay in this browser until submitted; the API re-checks everything, locks included.

export const Route = createFileRoute("/s/$token")({
  component: SharedForm,
});

type Values = Record<string, unknown>;

const storageKey = (token: string) => `necodoc:share:${token}`;

function loadProgress(token: string): Values {
  try {
    return z
      .record(z.string(), z.unknown())
      .catch({})
      .parse(JSON.parse(localStorage.getItem(storageKey(token)) ?? "{}"));
  } catch {
    return {};
  }
}

/**
 * `?client_name=Acme`: query parameters named after unlocked top-level fields that take typed
 * text (text, email, date, single choice, number).
 */
function queryPrefill(sections: readonly FieldSection[], search: string, locked: Set<string>) {
  const params = new URLSearchParams(search);
  const out: Values = {};
  for (const field of sections.flatMap((s) => s.fields)) {
    const raw = params.get(field.key);
    if (raw === null || locked.has(field.key)) continue;
    if (field.type === "number") {
      const n = Number(raw);
      if (raw.trim() && Number.isFinite(n)) out[field.key] = n;
    } else if (
      ["text", "long_text", "email", "date"].includes(field.type) ||
      (field.type === "choice" && !field.multiple)
    ) {
      out[field.key] = raw;
    }
  }
  return out;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 font-semibold">
          <Logo />
          necodoc
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 p-4 py-8">{children}</main>
    </div>
  );
}

function SharedForm() {
  const { token } = Route.useParams();
  const search = useLocation({ select: (location) => location.searchStr });
  const link = useQuery({
    queryKey: ["share", token],
    queryFn: async () => (await ok(api.share[":token"].$get({ param: { token } }))).json(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [email, setEmail] = useState("");
  const emailValid = z.email().safeParse(email).success;
  const [emailError, setEmailError] = useState(false);
  const submit = useMutation({
    mutationFn: async (data: Values) =>
      (
        await ok(
          api.share[":token"].$post({
            param: { token },
            json: { data, ...(email ? { email } : {}) },
          }),
        )
      ).json(),
    onSuccess: () => localStorage.removeItem(storageKey(token)),
  });
  const data = link.data;
  const start = useMemo(() => {
    if (!data) return {};
    const locked = new Set(data.lockedKeys);
    const lockedValues = Object.fromEntries(data.lockedKeys.map((key) => [key, data.prefill[key]]));
    return {
      ...data.prefill,
      ...queryPrefill(data.sections, search, locked),
      ...loadProgress(token),
      ...lockedValues,
    };
  }, [data, search, token]);

  if (link.error) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>This link is no longer available</CardTitle>
            <CardDescription>
              It may have expired, reached its limit, or been turned off. Ask whoever sent it for a
              new one.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }
  if (!data) return <Shell>{null}</Shell>;

  if (submit.data) {
    const { status, downloadUrl } = submit.data;
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2Icon className="size-5 text-primary" />
              Thanks, your answers were sent
            </CardTitle>
            <CardDescription>
              {status === "error"
                ? "We received your answers, but the PDF couldn't be made. The person who sent the link has them."
                : downloadUrl
                  ? "Download your copy of the PDF below. The link works for 24 hours."
                  : status === "success"
                    ? "The person who sent the link has your answers and the PDF."
                    : "The PDF is still being made; the person who sent the link will have it shortly."}
            </CardDescription>
          </CardHeader>
          {downloadUrl && (
            <CardContent>
              <a href={downloadUrl} className={buttonVariants()}>
                <DownloadIcon />
                Download PDF
              </a>
            </CardContent>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <p className="text-sm text-muted-foreground">{data.label}</p>
        {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
      </div>
      <Card>
        <CardContent className="space-y-6">
          {data.requireEmail && (
            <Field data-invalid={emailError && !emailValid}>
              <FieldLabel htmlFor="share-email">
                Your email address<span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="share-email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={emailError && !emailValid}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailError && !emailValid && (
                <FieldError errors={[{ message: "Enter your email address" }]} />
              )}
            </Field>
          )}
          <GuidedForm
            sections={data.sections}
            defaultValues={start}
            lockedKeys={data.lockedKeys}
            review
            submitLabel={submit.isPending ? "Sending…" : "Submit"}
            disabled={submit.isPending}
            onChange={(values) => {
              try {
                localStorage.setItem(storageKey(token), JSON.stringify(values));
              } catch {
                // Full storage (large images): progress just isn't kept.
              }
            }}
            onSubmit={(values) => {
              if (data.requireEmail && !emailValid) return setEmailError(true);
              submit.mutate(values);
            }}
          />
          <ErrorAlert error={submit.error} />
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Your answers go to whoever sent you this link.
      </p>
    </Shell>
  );
}
