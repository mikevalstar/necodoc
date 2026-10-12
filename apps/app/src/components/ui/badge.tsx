import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Cobalt pills (ADR 0042): fully round, on a tinted wash, never outlined. Statuses use the
// semantic variants with `dot`; plain tags (roles, kinds) leave the dot off.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs font-semibold whitespace-nowrap transition-colors has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        /** Brand: the default for neutral-positive facts ("Published v4"). */
        default: "bg-brand-wash text-brand-ink [a]:hover:bg-tint-2",
        secondary: "bg-mute-wash text-ink-2 [a]:hover:bg-tint-2",
        ok: "bg-ok-wash text-ok",
        warn: "bg-warn-wash text-warn",
        bad: "bg-bad-wash text-bad",
        destructive: "bg-bad-wash text-bad",
        run: "bg-run-wash text-run",
        /** The one "do this next" marker on a screen. */
        sun: "bg-sun text-sun-foreground",
        outline: "bg-transparent text-ink-2 shadow-[inset_0_0_0_1.5px_var(--tint-2)]",
        ghost: "text-ink-2 hover:bg-tint",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
      dot: {
        true: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      dot: false,
    },
  },
);

function Badge({
  className,
  variant = "default",
  dot = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, dot }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
