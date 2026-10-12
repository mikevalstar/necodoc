import { hasPermission } from "@necodoc/shared";
import {
  CheckIcon,
  FileArrowUpIcon,
  KeyIcon,
  PencilRulerIcon,
  RocketLaunchIcon,
  SignatureIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";
import { apiKeysQuery } from "@/components/api-keys";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient, type Me, unwrap } from "@/lib/auth";
import { submissionsQuery, templatesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Spec: docs/features/filling-out-a-document.md (Get started). The home page's first-run
// checklist for people who set necodoc up: each step ticks itself off from real data, and only
// the steps the user's roles allow are listed. Dismissed per browser and account.

type Step = {
  title: string;
  description: string;
  icon: typeof CheckIcon;
  /** Where the step's button goes, e.g. the New template dialog already on the right kind. */
  link: ReactElement;
  action: string;
  done: boolean;
  /** Whether the user's roles allow the step at all. */
  show: boolean;
};

const dismissedKey = (userId: string) => `necodoc-get-started-dismissed:${userId}`;

function readDismissed(userId: string) {
  try {
    return localStorage.getItem(dismissedKey(userId)) === "1";
  } catch {
    return false; // storage blocked
  }
}

/** Who sees the checklist: people who build templates or run the deployment, not fillers. */
export function setsUpNecodoc(roles: Me["user"]["roles"]) {
  return (
    roles.includes("admin") ||
    (["create", "publish"] as const).some((action) => hasPermission(roles, { document: [action] }))
  );
}

export function GetStarted({ me }: { me: Me }) {
  const roles = me.user.roles;
  const isAdmin = roles.includes("admin");
  const canCreate = hasPermission(roles, { document: ["create"] });
  const canPublish = hasPermission(roles, { document: ["publish"] });
  const [dismissed, setDismissed] = useState(() => readDismissed(me.user.id));

  const templates = useQuery(templatesQuery);
  const documents = useQuery(submissionsQuery());
  const keys = useQuery(apiKeysQuery({}));
  const team = useQuery({
    queryKey: ["admin", "users", "get-started"],
    enabled: isAdmin,
    queryFn: () =>
      unwrap(
        authClient.admin.listUsers({
          query: { limit: 2, filterField: "serviceAccount", filterValue: false },
        }),
      ),
  });

  const list = templates.data ?? [];
  const allSteps: Step[] = [
    {
      title: "Design a template",
      description: "Lay out a certificate, quote or letter and the questions it asks.",
      icon: PencilRulerIcon,
      link: <Link to="/templates" search={{ new: "designed" }} />,
      action: "New template",
      done: list.some((t) => t.kind === "designed"),
      show: canCreate,
    },
    {
      title: "Upload a PDF form",
      description: "Already have the form as a PDF? Place fields on it instead.",
      icon: FileArrowUpIcon,
      link: <Link to="/templates" search={{ new: "overlay" }} />,
      action: "Upload a PDF",
      done: list.some((t) => t.kind === "overlay"),
      show: canCreate,
    },
    {
      title: "Publish a template",
      description: "Publishing makes a version others can fill in and the API can use.",
      icon: RocketLaunchIcon,
      link: <Link to="/templates" />,
      action: "Open templates",
      done: list.some((t) => t.latestVersion !== null),
      show: canPublish,
    },
    {
      title: "Fill in your first document",
      description: "Answer a template's questions and download the finished PDF.",
      icon: SignatureIcon,
      link: <Link to="/documents/new" />,
      action: "New document",
      done: (documents.data?.length ?? 0) > 0,
      show: true,
    },
    {
      title: "Get an API key",
      description: "Generate PDFs from your own systems through /api/v1.",
      icon: KeyIcon,
      link: <Link to="/settings/api-keys" />,
      action: "Create a key",
      done: (keys.data?.length ?? 0) > 0,
      show: true,
    },
    {
      title: "Invite your team",
      description: "Add the people who design, review and fill in documents.",
      icon: UsersIcon,
      link: <Link to="/admin/users" />,
      action: "Manage users",
      done: (team.data?.total ?? 0) > 1,
      show: isAdmin,
    },
  ];

  const steps = allSteps.filter((step) => step.show);
  const loaded = templates.isSuccess && documents.isSuccess && keys.isSuccess;
  const doneCount = steps.filter((step) => step.done).length;
  if (dismissed || !loaded || doneCount === steps.length) return null;

  // Marigold marks the one next step (docs/features/design-system.md).
  const next = steps.find((step) => !step.done);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            className="text-ink-3"
            onClick={() => {
              try {
                localStorage.setItem(dismissedKey(me.user.id), "1");
              } catch {
                // storage blocked: hidden until reload
              }
              setDismissed(true);
            }}
          >
            Hide checklist
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid items-center gap-5 sm:grid-cols-[170px_1fr]">
        <div className="grid justify-items-center gap-2 text-center">
          <div className="relative size-32">
            <svg viewBox="0 0 120 120" className="size-32 -rotate-90" aria-hidden="true">
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="14"
                stroke="var(--tint-2)"
              />
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="14"
                strokeLinecap="round"
                stroke="var(--brand)"
                strokeDasharray={`${(doneCount / steps.length) * circumference} ${circumference}`}
              />
            </svg>
            <span className="absolute inset-0 grid place-items-center font-heading text-[34px] leading-none font-extrabold">
              <span>
                {doneCount}
                <small className="text-base text-ink-3">/{steps.length}</small>
              </span>
            </span>
          </div>
          <p className="text-[13px] text-ink-2">
            {doneCount} of {steps.length} done.{next && ` Next: ${next.title.toLowerCase()}.`} Each
            step ticks itself off.
          </p>
        </div>
        <ol className={cn("grid gap-3 sm:grid-cols-2", steps.length > 4 && "xl:grid-cols-3")}>
          {steps.map((step) => {
            const isNext = step === next;
            return (
              <li
                key={step.title}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[14px] bg-tint p-3.5",
                  step.done && "bg-ok-wash",
                  isNext && "bg-brand text-on-brand",
                )}
              >
                <span
                  className={cn(
                    "grid size-9 place-items-center rounded-[10px] bg-surface text-brand",
                    step.done && "text-ok",
                    isNext && "bg-white/18 text-on-brand dark:bg-black/15",
                  )}
                >
                  <step.icon className="size-5" />
                </span>
                <p className="font-heading text-[15px] font-bold">
                  {step.title}
                  {step.done && (
                    <>
                      <CheckIcon weight="bold" className="ml-1 inline size-4 text-ok" />
                      <span className="sr-only"> (done)</span>
                    </>
                  )}
                </p>
                <p
                  className={cn(
                    "text-[13px] leading-snug text-ink-2",
                    isNext && "text-[color-mix(in_srgb,var(--on-brand)_85%,transparent)]",
                  )}
                >
                  {step.description}
                </p>
                {!step.done && (
                  <Button
                    size="sm"
                    variant={isNext ? "sun" : "link"}
                    className={cn("mt-1 self-start", !isNext && "h-auto px-0")}
                    nativeButton={false}
                    render={step.link}
                  >
                    {step.action}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
