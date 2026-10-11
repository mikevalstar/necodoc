import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";

// Spec: docs/features/review-and-approval.md (notifications). Polled; opening one marks it read.

const notificationsKey = ["notifications"];

const kindLabels = {
  review_requested: "Review requested",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
} as const;

export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const notifications = useQuery({
    queryKey: notificationsKey,
    queryFn: async () => (await ok(api.notifications.$get())).json(),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => ok(api.notifications.read.$post({ json: { ids } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
  const unread = notifications.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative"
          />
        }
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-[0.65rem] leading-4 text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!unread || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {notifications.data?.items.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">Nothing yet.</li>
          )}
          {notifications.data?.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn(
                  "block w-full space-y-0.5 border-b px-3 py-2 text-left text-sm hover:bg-muted",
                  !n.readAt && "bg-primary/5",
                )}
                onClick={async () => {
                  if (!n.readAt) markRead.mutate([n.id]);
                  setOpen(false);
                  if (n.reviewId) {
                    await navigate({
                      to: "/templates/reviews/$reviewId",
                      params: { reviewId: n.reviewId },
                    });
                  } else if (n.templateId) {
                    await navigate({ to: "/templates/$id", params: { id: n.templateId } });
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  {!n.readAt && (
                    <span className="size-2 rounded-full bg-primary">
                      <span className="sr-only">Unread</span>
                    </span>
                  )}
                  <span className="font-medium whitespace-nowrap">{kindLabels[n.kind]}</span>
                  <span className="truncate text-muted-foreground">{n.templateName}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {dayjs(n.createdAt).fromNow()}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
