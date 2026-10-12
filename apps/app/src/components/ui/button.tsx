import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

// Cobalt (ADR 0042): raised white buttons instead of outlines, 40px tall. Text on the brand
// fill is 14px semibold because white on cobalt is exactly 4.5:1. `sun` is the marigold
// "do this next" button: at most one per screen. Disabled buttons drop to flat tint with ink-3
// text rather than fading, which was too subtle on cobalt in dark mode.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:text-ink-3 disabled:shadow-none data-disabled:pointer-events-none data-disabled:text-ink-3 data-disabled:shadow-none aria-invalid:ring-2 aria-invalid:ring-bad [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.15em]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_18px_-8px_color-mix(in_srgb,var(--brand)_80%,transparent)] hover:bg-[color-mix(in_srgb,var(--brand),var(--ink)_10%)] disabled:bg-tint-2 data-disabled:bg-tint-2",
        outline:
          "bg-surface text-foreground shadow-card hover:bg-tint aria-expanded:bg-tint dark:hover:bg-tint-2 disabled:bg-tint data-disabled:bg-tint",
        secondary:
          "bg-tint text-foreground hover:bg-tint-2 aria-expanded:bg-tint-2 dark:hover:bg-tint-2 disabled:opacity-70 data-disabled:opacity-70",
        ghost:
          "text-ink-2 hover:bg-tint hover:text-foreground aria-expanded:bg-tint disabled:opacity-70 data-disabled:opacity-70",
        destructive:
          "bg-surface text-bad shadow-card hover:bg-bad-wash aria-expanded:bg-bad-wash disabled:bg-tint data-disabled:bg-tint",
        sun: "bg-sun text-sun-foreground hover:bg-[color-mix(in_srgb,var(--sun),var(--sun-foreground)_10%)] disabled:bg-tint-2 data-disabled:bg-tint-2",
        link: "text-brand-ink underline-offset-4 hover:underline disabled:opacity-70 data-disabled:opacity-70",
      },
      size: {
        default:
          "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-[9px] px-3 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 gap-2 px-5 text-[15px] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-[9px] [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [{ variant: "default", size: ["xs", "sm"], className: "text-sm" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
