import { ArrowLeftIcon, type Icon as PhosphorIcon, QuestionIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createLink, Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { meQuery } from "@/lib/auth";
import { faq } from "@/lib/faq";
import { cn } from "@/lib/utils";

// The page frame every screen shares (docs/features/design-system.md): one width per kind of
// page, then a header with the display title, a line on what the page is for, and its actions.
// Pages sit left-aligned under the shell's breadcrumb.

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
      className={cn("w-full space-y-6 px-4 pt-1 pb-10 sm:px-8", widths[width], className)}
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
    <div className="space-y-3 pb-1">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="truncate font-heading text-[28px] leading-tight font-bold tracking-[-0.025em] sm:text-[34px]">
              {title}
            </h1>
            {children}
          </div>
          {description && <p className="max-w-prose text-[15px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}

function BackAnchor({ className, children, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-ink-3 hover:text-ink",
        className,
      )}
      {...props}
    >
      <ArrowLeftIcon weight="bold" className="size-4" />
      {children}
    </a>
  );
}

/** "← Parent page", typed like <Link>. */
export const BackLink = createLink(BackAnchor);

/** What to show where a list would be when it has nothing in it yet: what goes here and the next step. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: PhosphorIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-tint-2 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-2 grid size-13 place-items-center rounded-xl bg-brand-wash text-brand">
          <Icon className="size-7" />
        </div>
      )}
      <h2 className="font-heading text-[15.5px] font-bold">{title}</h2>
      {description && <p className="max-w-md text-sm text-ink-3">{description}</p>}
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
        <Skeleton key={i} className="h-12 w-full" />
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
        "inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-ink-3 hover:text-ink",
        className,
      )}
    >
      <QuestionIcon className="size-[18px]" />
      Help
    </Link>
  );
}
