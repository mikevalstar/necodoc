import { IconContext } from "@phosphor-icons/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound, RouteError, RoutePending } from "./components/route-states";
import { ApiError } from "./lib/api";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import "./lib/theme"; // keeps the theme in sync with the system setting
import "./lib/density";

// Any change may have added audit entries (docs/features/audit-log.md): History panels refetch.
// A 4xx won't change on retry, so not-found and forbidden pages show at once; network errors
// and 5xx still retry.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 3,
    },
  },
  mutationCache: new MutationCache({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit"] }),
  }),
});
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
  defaultPendingComponent: RoutePending,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const iconDefaults = {
  weight: "duotone",
  size: "1em",
  color: "currentColor",
  mirrored: false,
} as const;

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    {/* Phosphor duotone is the house style (ADR 0042); pass weight="bold" etc. to differ. */}
    <IconContext.Provider value={iconDefaults}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IconContext.Provider>
  </StrictMode>,
);
