import {
  type FieldSection,
  stringsFor,
  type Translations,
  textDirection,
  translateSections,
} from "@necodoc/shared";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  LinkBreakIcon,
  type Icon as PhosphorIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { GuidedForm } from "@/components/guided-form";
import { LanguagePicker } from "@/components/language-picker";
import { Logo } from "@/components/logo";
import { ListSkeleton } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, ok } from "@/lib/api";

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

/**
 * The language to start in: `?lang=fr`, else the browser's first language the template has
 * (exact tag, then language), else the template's own (docs/features/document-localization.md).
 */
function startLanguage(lang: string, translations: Translations, search: string) {
  const available = [lang, ...Object.keys(translations)];
  const find = (tag: string) => {
    const lower = tag.toLowerCase();
    return (
      available.find((a) => a.toLowerCase() === lower) ??
      available.find((a) => a.toLowerCase() === lower.split("-")[0])
    );
  };
  const asked = new URLSearchParams(search).get("lang");
  return (asked && find(asked)) || navigator.languages.map(find).find(Boolean) || lang;
}

/** No app chrome: the necodoc mark, one column that reads well on a phone, an optional note under it. */
function Shell({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="bg-linear-to-b from-shell to-shell-2 text-shell-fg">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2.5 px-4 font-heading text-lg font-bold tracking-tight sm:h-16 sm:px-6 sm:text-xl">
          <Logo className="size-7" accentClassName="fill-sun" />
          necodoc
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6 sm:px-6 sm:py-10"
      >
        {children}
      </main>
      {note && (
        <footer className="mx-auto w-full max-w-3xl px-4 pb-8 text-center text-xs text-ink-3 sm:px-6">
          {note}
        </footer>
      )}
    </div>
  );
}

/** One centred card for the states with nothing to fill: gone, failed to load, sent. */
function Notice({
  icon: Icon,
  tone,
  title,
  children,
  action,
}: {
  icon: PhosphorIcon;
  tone: "ok" | "bad" | "mute";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tile = {
    ok: "bg-ok-wash text-ok",
    bad: "bg-bad-wash text-bad",
    mute: "bg-tint text-ink-3",
  };
  return (
    <Card>
      <CardContent
        className="flex flex-col items-center gap-2 py-6 text-center sm:py-10"
        role="status"
      >
        <div className={`mb-2 grid size-13 place-items-center rounded-xl ${tile[tone]}`}>
          <Icon className="size-7" />
        </div>
        <h1 className="font-heading text-2xl leading-tight font-bold tracking-tight text-balance">
          {title}
        </h1>
        <p className="max-w-md text-[15px] text-ink-2">{children}</p>
        {action && <div className="mt-3">{action}</div>}
      </CardContent>
    </Card>
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
  const [picked, setPicked] = useState<string | null>(null);
  const emailValid = z.email().safeParse(email).success;
  /** Shows the email's error once it's been left, a step was taken, or submit was pressed. */
  const [emailError, setEmailError] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const submit = useMutation({
    mutationFn: async (data: Values) =>
      (
        await ok(
          api.share[":token"].$post({
            param: { token },
            json: { data, ...(email ? { email } : {}), ...(lang ? { locale: lang } : {}) },
          }),
        )
      ).json(),
    onSuccess: () => localStorage.removeItem(storageKey(token)),
  });
  const data = link.data;
  const lang = data ? (picked ?? startLanguage(data.lang, data.translations, search)) : null;
  const sections = useMemo(
    () =>
      data && lang ? translateSections(data.sections, stringsFor(data.translations, lang)) : [],
    [data, lang],
  );
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
    // 400 (mangled token), 404 (no such link) and 410 (expired, turned off, used up, template
    // archived) read the same to the filler; a network or server failure is worth retrying.
    const gone = link.error instanceof ApiError && [400, 404, 410].includes(link.error.status);
    return (
      <Shell>
        {gone ? (
          <Notice icon={LinkBreakIcon} tone="mute" title="This link is no longer available">
            It may have expired, reached its limit, or been turned off. Ask whoever sent it to you
            for a new one.
          </Notice>
        ) : (
          <Notice
            icon={WarningCircleIcon}
            tone="bad"
            title="We couldn't open this form"
            action={
              <Button variant="outline" onClick={() => link.refetch()} disabled={link.isFetching}>
                <ArrowClockwiseIcon weight="bold" />
                {link.isFetching ? "Trying…" : "Try again"}
              </Button>
            }
          >
            Check your connection and try again. Your answers so far are kept in this browser.
          </Notice>
        )}
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-2/3" />
        </div>
        <ListSkeleton rows={4} />
      </Shell>
    );
  }

  if (submit.data) {
    const { status, downloadUrl } = submit.data;
    return (
      <Shell>
        <Notice
          icon={CheckCircleIcon}
          tone={status === "error" ? "mute" : "ok"}
          title="Thanks, your answers were sent"
          action={
            downloadUrl && (
              <a href={downloadUrl} className={buttonVariants()}>
                <DownloadSimpleIcon />
                Download your PDF
              </a>
            )
          }
        >
          {status === "error"
            ? "We received your answers, but the PDF couldn't be made. The person who sent the link has them."
            : downloadUrl
              ? "Download a copy of the completed PDF. The link works for 24 hours."
              : status === "success"
                ? "The person who sent the link has your answers and the PDF. You can close this page."
                : "The PDF is still being made; the person who sent the link will have it shortly. You can close this page."}
        </Notice>
      </Shell>
    );
  }

  const shownLang = lang ?? data.lang;
  return (
    <Shell
      note={
        <>
          Your answers go to whoever sent you this link. Until you submit, they're saved only in
          this browser.
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.025em] text-balance sm:text-[34px]">
            {data.name}
          </h1>
          {data.description && (
            <p className="max-w-prose text-[15px] text-ink-2">{data.description}</p>
          )}
        </div>
        <LanguagePicker
          lang={data.lang}
          translations={data.translations}
          value={shownLang}
          onChange={setPicked}
        />
      </div>
      {data.requireEmail && (
        <Card>
          <CardContent>
            <Field data-invalid={emailError && !emailValid}>
              <FieldLabel htmlFor="share-email">
                Your email address<span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="share-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                aria-invalid={emailError && !emailValid}
                ref={emailInput}
                aria-describedby="share-email-help"
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailError(true)}
              />
              <FieldDescription id="share-email-help">
                The person who sent this link asks for it so they know who answered.
              </FieldDescription>
              {emailError && !emailValid && (
                <FieldError
                  errors={[
                    {
                      message: email.trim()
                        ? "That doesn't look like an email address"
                        : "Enter your email address",
                    },
                  ]}
                />
              )}
            </Field>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-6">
          <div dir={textDirection(shownLang)} lang={shownLang}>
            <GuidedForm
              sections={sections}
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
              onStepChange={() => setEmailError(true)}
              onSubmit={(values) => {
                if (data.requireEmail && !emailValid) {
                  setEmailError(true);
                  emailInput.current?.focus();
                  return;
                }
                submit.mutate(values);
              }}
            />
          </div>
          <ErrorAlert error={submit.error} />
        </CardContent>
      </Card>
    </Shell>
  );
}
