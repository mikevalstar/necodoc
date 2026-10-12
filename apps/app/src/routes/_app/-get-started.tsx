import { hasPermission } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  FilePlus2Icon,
  FileUpIcon,
  KeyRoundIcon,
  PenLineIcon,
  RocketIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import { apiKeysQuery } from "@/components/api-keys";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      icon: FilePlus2Icon,
      link: <Link to="/templates" search={{ new: "designed" }} />,
      action: "New template",
      done: list.some((t) => t.kind === "designed"),
      show: canCreate,
    },
    {
      title: "Upload a PDF form",
      description: "Already have the form as a PDF? Place fields on it instead.",
      icon: FileUpIcon,
      link: <Link to="/templates" search={{ new: "overlay" }} />,
      action: "Upload a PDF",
      done: list.some((t) => t.kind === "overlay"),
      show: canCreate,
    },
    {
      title: "Publish a template",
      description: "Publishing makes a version others can fill in and the API can use.",
      icon: RocketIcon,
      link: <Link to="/templates" />,
      action: "Open templates",
      done: list.some((t) => t.latestVersion !== null),
      show: canPublish,
    },
    {
      title: "Fill in your first document",
      description: "Answer a template's questions and download the finished PDF.",
      icon: PenLineIcon,
      link: <Link to="/documents/new" />,
      action: "New document",
      done: (documents.data?.length ?? 0) > 0,
      show: true,
    },
    {
      title: "Get an API key",
      description: "Generate PDFs from your own systems through /api/v1.",
      icon: KeyRoundIcon,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          {doneCount} of {steps.length} done. Each step ticks itself off once it has happened.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the get started checklist"
            onClick={() => {
              try {
                localStorage.setItem(dismissedKey(me.user.id), "1");
              } catch {
                // storage blocked: hidden until reload
              }
              setDismissed(true);
            }}
          >
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <li
              key={step.title}
              className={cn(
                "flex gap-3 rounded-lg border p-3",
                step.done && "bg-muted/40 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  step.done ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                {step.done ? <CheckIcon className="size-4" /> : <step.icon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.done ? "line-through" : "text-foreground",
                  )}
                >
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </p>
                <p className="text-xs">{step.description}</p>
                {!step.done && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    nativeButton={false}
                    render={step.link}
                  >
                    {step.action}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
