import {
  type FieldSection,
  stringsFor,
  type Translations,
  textDirection,
  translate,
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
import { uiStrings } from "@/lib/ui-strings";

// Spec: docs/features/share-links-and-data-requests.md. Public: no session, no app chrome. The
// answers stay in this browser until submitted; the API re-checks everything, locks included.
// Everything the filler reads follows the language (docs/features/document-localization.md):
// template text through its translations, the page's own through lib/ui-strings.ts.

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
function Shell({
  children,
  note,
  lang,
}: {
  children: ReactNode;
  note?: ReactNode;
  /** The language the page reads in; sets text direction too. */
  lang?: string;
}) {
  return (
    <div
      className="flex min-h-svh flex-col bg-background"
      lang={lang}
      dir={lang ? textDirection(lang) : undefined}
    >
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
  const strings = useMemo(
    () => (data && lang ? stringsFor(data.translations, lang) : {}),
    [data, lang],
  );
  const sections = useMemo(
    () => (data ? translateSections(data.sections, strings) : []),
    [data, strings],
  );
  // Before the link loads (or when it can't), `?lang=` or the browser's language.
  const t = uiStrings(
    lang ?? new URLSearchParams(search).get("lang") ?? navigator.languages[0] ?? "en",
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
          <Notice icon={LinkBreakIcon} tone="mute" title={t.share.goneTitle}>
            {t.share.gone}
          </Notice>
        ) : (
          <Notice
            icon={WarningCircleIcon}
            tone="bad"
            title={t.share.failedTitle}
            action={
              <Button variant="outline" onClick={() => link.refetch()} disabled={link.isFetching}>
                <ArrowClockwiseIcon weight="bold" />
                {link.isFetching ? t.share.trying : t.share.tryAgain}
              </Button>
            }
          >
            {t.share.failed}
          </Notice>
        )}
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="space-y-2" role="status" aria-busy="true" aria-label={t.share.loading}>
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
      <Shell lang={lang ?? undefined}>
        <Notice
          icon={CheckCircleIcon}
          tone={status === "error" ? "mute" : "ok"}
          title={t.share.sentTitle}
          action={
            downloadUrl && (
              <a href={downloadUrl} className={buttonVariants()}>
                <DownloadSimpleIcon />
                {t.share.download}
              </a>
            )
          }
        >
          {status === "error"
            ? t.share.sentError
            : downloadUrl
              ? t.share.sentDownload
              : status === "success"
                ? t.share.sentDone
                : t.share.sentPending}
        </Notice>
      </Shell>
    );
  }

  const shownLang = lang ?? data.lang;
  return (
    <Shell note={t.share.note} lang={shownLang}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.025em] text-balance sm:text-[34px]">
            {translate(strings, data.name)}
          </h1>
          {data.description && (
            <p className="max-w-prose text-[15px] text-ink-2">
              {translate(strings, data.description)}
            </p>
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
                {t.share.emailLabel}
                <span className="text-destructive">*</span>
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
              <FieldDescription id="share-email-help">{t.share.emailHelp}</FieldDescription>
              {emailError && !emailValid && (
                <FieldError
                  errors={[
                    {
                      message: email.trim() ? t.share.emailInvalid : t.share.emailMissing,
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
          <GuidedForm
            sections={sections}
            lang={shownLang}
            defaultValues={start}
            lockedKeys={data.lockedKeys}
            review
            submitLabel={submit.isPending ? t.sending : t.submit}
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
          <ErrorAlert error={submit.error} />
        </CardContent>
      </Card>
    </Shell>
  );
}
