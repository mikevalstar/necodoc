import { useQuery } from "@tanstack/react-query";
import { createLink, Link } from "@tanstack/react-router";
import { ChevronLeftIcon, CircleHelpIcon, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { meQuery } from "@/lib/auth";
import { faq } from "@/lib/faq";
import { cn } from "@/lib/utils";

// The page frame every screen shares: one width per kind of page, then a header with the
// title, a line on what the page is for, and its primary action.

const widths = {
  /** Forms and single records: settings, filling in a document. */
  narrow: "max-w-3xl",
  /** Lists, tables and dashboards. */
  default: "max-w-7xl",
  /** Editors with a live preview beside them. */
  wide: "max-w-[96rem]",
} as const;

export function Page({
  width = "default",
  className,
  ...props
}: { width?: keyof typeof widths } & ComponentProps<"main">) {
  return (
    <main
      id="main"
      className={cn("mx-auto w-full space-y-6 px-4 py-8 sm:px-6", widths[width], className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  back,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A <BackLink> to the page this one sits under. */
  back?: ReactNode;
  /** Buttons on the right; the primary action goes last. */
  actions?: ReactNode;
  /** Badges and the like next to the title. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
            {children}
          </div>
          {description && (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function BackAnchor({ className, children, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      <ChevronLeftIcon className="size-4" />
      {children}
    </a>
  );
}

/** "‹ Parent page", typed like <Link>. */
export const BackLink = createLink(BackAnchor);

/** What to show where a list would be when it has nothing in it yet: what goes here and the next step. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 rounded-full bg-muted p-3 text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <h2 className="font-medium">{title}</h2>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Placeholder rows while a table or list loads. */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/**
 * "Help" linking to a feature's FAQ entry. The FAQ is admin-only (docs/features/admin-faq.md),
 * so others see nothing; an unknown feature name renders nothing rather than a dead link.
 */
export function FaqLink({ feature, className }: { feature: string; className?: string }) {
  const isAdmin = useQuery(meQuery).data?.user.roles.includes("admin") ?? false;
  if (!isAdmin || !faq.some((entry) => entry.feature === feature)) return null;
  return (
    <Link
      to="/admin/faq"
      search={{ entry: feature }}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <CircleHelpIcon className="size-4" />
      Help
    </Link>
  );
}
