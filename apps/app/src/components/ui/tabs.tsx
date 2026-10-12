import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center gap-0.5 rounded-xl p-1 text-ink-2 group-data-horizontal/tabs:h-10 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-tint",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  scrollable = false,
  ...props
}: Omit<TabsPrimitive.List.Props, "ref"> &
  VariantProps<typeof tabsListVariants> & {
    /** One row that scrolls sideways when it's too narrow, fading at the edge with more to see. */
    scrollable?: boolean;
  }) {
  const scrollRef = useScrollableTabs(scrollable);
  return (
    <TabsPrimitive.List
      ref={scrollRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        tabsListVariants({ variant }),
        scrollable &&
          "max-w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none] *:data-[slot=tabs-trigger]:flex-none data-more:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * For a scrollable list: sets `data-more` while tabs are hidden past the right edge, and keeps
 * the active tab scrolled into view.
 */
function useScrollableTabs(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const list = ref.current;
    if (!enabled || !list) return;
    const update = () => {
      list.toggleAttribute("data-more", list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
    };
    const reveal = () => {
      const tab = list.querySelector<HTMLElement>("[data-slot=tabs-trigger][data-active]");
      if (!tab) return;
      // By hand, not scrollIntoView, so the page itself doesn't scroll.
      const fade = 40;
      if (tab.offsetLeft < list.scrollLeft) list.scrollLeft = tab.offsetLeft;
      else if (tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth - fade) {
        list.scrollLeft = tab.offsetLeft + tab.offsetWidth - list.clientWidth + fade;
      }
      update();
    };
    reveal();
    const resize = new ResizeObserver(update);
    resize.observe(list);
    const active = new MutationObserver(reveal);
    active.observe(list, { subtree: true, attributeFilter: ["data-active"] });
    list.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      active.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return ref;
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-0.5 text-[13px] font-semibold whitespace-nowrap text-ink-2 transition-all group-data-vertical/tabs:h-9 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[variant=default]/tabs-list:data-active:shadow-card group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-surface data-active:text-foreground",
        "after:absolute after:rounded-full after:bg-brand after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
