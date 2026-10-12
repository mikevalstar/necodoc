import { hasPermission, roleSchema } from "@necodoc/shared";
import { LinkSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAccess } from "@/lib/auth";
import { type FaqEntry, type FaqExample, type FaqGuide, faq, faqGroups } from "@/lib/faq";

// Spec: docs/features/admin-faq.md
export const Route = createFileRoute("/_app/admin/faq")({
  beforeLoad: ({ context }) => requireAccess(context.me, "admin"),
  // ?entry= opens one entry: the "Help" links next to features (components/page.tsx FaqLink).
  validateSearch: z.object({ entry: z.string().optional() }),
  component: Faq,
});

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const entryId = (feature: string) => `faq-${slug(feature)}`;
const groupId = (group: string) => `group-${slug(group)}`;

const guideText = (guide: FaqGuide) =>
  [
    guide.provider,
    guide.protocol,
    ...guide.steps,
    ...guide.examples.flatMap((e) => [e.title, e.code, e.note ?? ""]),
  ].join(" ");

const searchText = (entry: FaqEntry) =>
  [
    entry.feature,
    entry.group,
    entry.what,
    entry.howTo,
    ...entry.limitations,
    ...entry.access.map((a) => a.action),
    entry.spec,
    ...(entry.guides ?? []).map(guideText),
  ]
    .join(" ")
    .toLowerCase();

/** The `/` key focuses search unless you're typing somewhere already. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function Faq() {
  const { entry: linked } = Route.useSearch();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = faq.filter((entry) => {
    const text = searchText(entry);
    return words.every((word) => text.includes(word));
  });
  const groups = faqGroups
    .map((group) => ({ group, entries: matches.filter((entry) => entry.group === group) }))
    .filter(({ entries }) => entries.length);

  // After the router's own scroll-to-top on navigation.
  useEffect(() => {
    if (!linked) return;
    const timer = setTimeout(
      () => document.getElementById(entryId(linked))?.scrollIntoView({ block: "start" }),
      50,
    );
    return () => clearTimeout(timer);
  }, [linked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Page>
      <PageHeader
        title="FAQ"
        description="What necodoc does today, how to use it, and where it stops."
      />
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[14rem_minmax(0,52rem)]">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="relative">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <Input
              ref={searchRef}
              type="search"
              aria-label="Search the FAQ"
              aria-keyshortcuts="/"
              placeholder="Search the FAQ"
              className="peer pr-9 pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md bg-tint px-1.5 font-mono text-xs text-ink-3 peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden"
            >
              /
            </kbd>
          </div>
          <p className="text-xs text-ink-3" aria-live="polite">
            {words.length
              ? `${matches.length} of ${faq.length} entries match`
              : `${faq.length} entries`}
          </p>
          {groups.length > 0 && (
            <nav aria-label="FAQ categories">
              <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
                {groups.map(({ group, entries }) => (
                  <li key={group}>
                    <a
                      href={`#${groupId(group)}`}
                      className="flex items-center justify-between gap-3 rounded-full bg-tint px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-tint-2 hover:text-ink lg:rounded-lg lg:bg-transparent lg:py-1.5"
                    >
                      {group}
                      <span className="font-mono text-xs text-ink-3 tabular-nums">
                        {entries.length}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>

        <div className="min-w-0 space-y-8">
          {groups.map(({ group, entries }) => (
            <section key={group} id={groupId(group)} className="scroll-mt-6 space-y-3">
              <h2 className="font-heading text-xl font-bold tracking-tight">{group}</h2>
              <Card className="px-5 py-0">
                <Accordion
                  multiple
                  // A search opens every match, so the matching text is visible.
                  key={`${words.join(" ")}|${linked}`}
                  defaultValue={
                    words.length
                      ? entries.map((entry) => entry.feature)
                      : entries.filter((entry) => entry.feature === linked).map((e) => e.feature)
                  }
                >
                  {entries.map((entry) => (
                    <AccordionItem
                      key={entry.feature}
                      value={entry.feature}
                      id={entryId(entry.feature)}
                      className="scroll-mt-6"
                    >
                      <div className="flex items-start gap-2 [&>h3]:flex-1">
                        <AccordionTrigger className="py-4 font-heading text-[15.5px] font-bold text-ink">
                          <Marked text={entry.feature} words={words} />
                        </AccordionTrigger>
                        <CopyEntryLink feature={entry.feature} />
                      </div>
                      <AccordionContent>
                        <FaqBody entry={entry} words={words} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </Card>
            </section>
          ))}
          {!groups.length && (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="No entries match"
              description={`Nothing matches "${query}". Try fewer or shorter words.`}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  Clear search
                </Button>
              }
            />
          )}
        </div>
      </div>
    </Page>
  );
}

function CopyEntryLink({ feature }: { feature: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mt-3 shrink-0 text-ink-3"
      aria-label={`Copy link to ${feature}`}
      title="Copy link to this entry"
      onClick={async () => {
        const url = new URL("/admin/faq", window.location.origin);
        url.searchParams.set("entry", feature);
        await navigator.clipboard.writeText(url.toString());
        toast.success("Link copied");
      }}
    >
      <LinkSimpleIcon weight="bold" />
    </Button>
  );
}

function FaqBody({ entry, words }: { entry: FaqEntry; words: string[] }) {
  return (
    <div className="space-y-5 pb-3 text-[15px] leading-relaxed text-ink-2 *:max-w-prose">
      <p className="text-ink">
        <RichText text={entry.what} words={words} />
      </p>
      <BodySection title="How to use it">
        <p>
          <RichText text={entry.howTo} words={words} />
        </p>
      </BodySection>
      {entry.guides && <Guides guides={entry.guides} words={words} />}
      <BodySection title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">
          {entry.limitations.map((limitation) => (
            <li key={limitation}>
              <RichText text={limitation} words={words} />
            </li>
          ))}
        </ul>
      </BodySection>
      <BodySection title="Who can use it">
        <dl className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
          {entry.access.map(({ action, needs }) => (
            <div key={action} className="contents">
              <dt>
                <Marked text={action} words={words} />
              </dt>
              <dd>
                <RoleBadges
                  roles={
                    needs === "admin"
                      ? ["admin"]
                      : roleSchema.options.filter((role) => hasPermission([role], needs))
                  }
                />
              </dd>
            </div>
          ))}
        </dl>
      </BodySection>
      <p className="text-xs text-ink-3">
        Spec: <code className="font-mono">{entry.spec}</code>
      </p>
    </div>
  );
}

/** One tab per provider, each protocol a sub-section. A search opens the tab that matches best. */
function Guides({ guides, words }: { guides: readonly FaqGuide[]; words: string[] }) {
  const providers = [...new Set(guides.map((g) => g.provider))];
  // The guide matching the most search words; the first one wins a tie.
  let best: { provider: string; hits: number } = { provider: providers[0] ?? "", hits: 0 };
  for (const guide of guides) {
    const text = guideText(guide).toLowerCase();
    const hits = words.filter((word) => text.includes(word)).length;
    if (hits > best.hits) best = { provider: guide.provider, hits };
  }
  return (
    <section className="max-w-none! space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Setup guides</h3>
      <Tabs key={words.join(" ")} defaultValue={best.provider}>
        {providers.length > 1 && (
          <TabsList scrollable aria-label="Identity provider">
            {providers.map((provider) => (
              <TabsTrigger key={provider} value={provider}>
                {provider}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {providers.map((provider) => (
          <TabsContent key={provider} value={provider} className="space-y-6 pt-2">
            {guides
              .filter((guide) => guide.provider === provider)
              .map((guide) => (
                <GuideSection key={guide.protocol} guide={guide} words={words} />
              ))}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function GuideSection({ guide, words }: { guide: FaqGuide; words: string[] }) {
  return (
    <div className="space-y-3">
      <h4 className="font-heading text-[15px] font-bold text-ink">
        <Marked text={`${guide.provider} · ${guide.protocol}`} words={words} />
      </h4>
      <ol className="max-w-prose list-decimal space-y-1.5 pl-5 marker:text-ink-3">
        {guide.steps.map((step) => (
          <li key={step}>
            <RichText text={step} words={words} />
          </li>
        ))}
      </ol>
      {guide.examples.map((example) => (
        <CodeExample key={example.title} example={example} words={words} />
      ))}
    </div>
  );
}

function CodeExample({ example, words }: { example: FaqExample; words: string[] }) {
  return (
    <figure className="min-w-0 space-y-1.5">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2 text-sm font-medium text-ink">
          <span>
            <Marked text={example.title} words={words} />
          </span>
          <span className="font-mono text-xs text-ink-3 uppercase">{example.lang}</span>
        </span>
        <CopyButton text={example.code} aria-label={`Copy ${example.title}`} />
      </figcaption>
      <pre className="overflow-x-auto rounded-lg bg-tint p-3 font-mono text-xs leading-relaxed text-ink [font-variant-ligatures:none]">
        <code>
          <Marked text={example.code} words={words} />
        </code>
      </pre>
      {example.note && (
        <p className="max-w-prose text-sm text-ink-3">
          <RichText text={example.note} words={words} />
        </p>
      )}
    </figure>
  );
}

function BodySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      {children}
    </div>
  );
}

// Entries are plain strings. Set the code-like bits in mono so they read as things to type:
// Liquid tags, URLs, env var names, URL paths and repo paths.
const codePattern =
  /(https?:\/\/[^\s,]*[\w/>]|\{\{.*?\}\}|\{%.*?%\}|\b[A-Z][A-Z0-9]*_[A-Z0-9_<>*]*|(?:apps|docs|packages)\/[\w./-]*[\w/]|\/(?:api|self-hosting)\/[\w/<>:.#-]*[\w/>])/;

function RichText({ text, words }: { text: string; words: string[] }) {
  return text.split(codePattern).map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: split parts have no identity
    <Fragment key={i}>
      {i % 2 ? (
        <code className="rounded box-decoration-clone bg-tint px-1 py-px font-mono text-[0.85em] text-ink">
          <Marked text={part} words={words} />
        </code>
      ) : (
        <Marked text={part} words={words} />
      )}
    </Fragment>
  ));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Highlights the search words in `text`. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.map(escapeRegExp).join("|")})`, "i"));
  return parts.map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: split parts have no identity
    <Fragment key={i}>
      {i % 2 ? <mark className="rounded-sm bg-brand-wash text-ink">{part}</mark> : part}
    </Fragment>
  ));
}
