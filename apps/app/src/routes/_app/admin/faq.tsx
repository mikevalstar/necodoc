import { hasPermission, roleSchema } from "@necodoc/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useState } from "react";
import { z } from "zod";
import { Page, PageHeader } from "@/components/page";
import { RoleBadges } from "@/components/role-badges";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { type FaqEntry, faq, faqGroups } from "@/lib/faq";

// Spec: docs/features/admin-faq.md
export const Route = createFileRoute("/_app/admin/faq")({
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  // ?entry= opens one entry: the "Help" links next to features (components/page.tsx FaqLink).
  validateSearch: z.object({ entry: z.string().optional() }),
  component: Faq,
});

const entryId = (feature: string) => `faq-${feature.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const searchText = (entry: FaqEntry) =>
  [
    entry.feature,
    entry.what,
    entry.howTo,
    ...entry.limitations,
    ...entry.access.map((a) => a.action),
  ]
    .join(" ")
    .toLowerCase();

function Faq() {
  const { entry: linked } = Route.useSearch();
  const [query, setQuery] = useState("");
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = faq.filter((entry) => {
    const text = searchText(entry);
    return words.every((word) => text.includes(word));
  });

  // After the router's own scroll-to-top on navigation.
  useEffect(() => {
    if (!linked) return;
    const timer = setTimeout(
      () => document.getElementById(entryId(linked))?.scrollIntoView({ block: "start" }),
      50,
    );
    return () => clearTimeout(timer);
  }, [linked]);

  return (
    <Page width="narrow">
      <PageHeader
        title="FAQ"
        description="What necodoc does today, how to use it, and where it stops."
      />
      <Input
        type="search"
        aria-label="Search the FAQ"
        placeholder="Search, e.g. footer, font, 20 MB"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {faqGroups.map((group) => {
        const entries = matches.filter((entry) => entry.group === group);
        if (!entries.length) return null;
        return (
          <section key={group} className="space-y-1">
            <h2 className="text-sm font-medium text-muted-foreground">{group}</h2>
            <Accordion
              multiple
              // A search opens every match, so the matching text is visible.
              key={`${words.join(" ")}|${linked}`}
              defaultValue={
                words.length
                  ? entries.map((entry) => entry.feature)
                  : entries.filter((entry) => entry.feature === linked).map((e) => e.feature)
              }
              className="rounded-lg border px-3"
            >
              {entries.map((entry) => (
                <AccordionItem
                  key={entry.feature}
                  value={entry.feature}
                  id={entryId(entry.feature)}
                  className="scroll-mt-28"
                >
                  <AccordionTrigger>{entry.feature}</AccordionTrigger>
                  <AccordionContent>
                    <FaqBody entry={entry} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        );
      })}
      {!matches.length && <p className="text-muted-foreground">Nothing matches "{query}".</p>}
    </Page>
  );
}

function FaqBody({ entry }: { entry: FaqEntry }) {
  return (
    <div className="space-y-3">
      <p>{entry.what}</p>
      <div>
        <h3 className="font-medium">How to use it</h3>
        <p>{entry.howTo}</p>
      </div>
      <div>
        <h3 className="font-medium">Limitations</h3>
        <ul className="list-disc space-y-1 pl-5">
          {entry.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">Who can use it</h3>
        <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
          {entry.access.map(({ action, needs }) => (
            <div key={action} className="contents">
              <dt className="text-muted-foreground">{action}</dt>
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
      </div>
      <p className="text-xs text-muted-foreground">
        Spec: <code>{entry.spec}</code>
      </p>
    </div>
  );
}
