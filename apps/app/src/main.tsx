import { IconContext } from "@phosphor-icons/react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFound, RouteError, RoutePending } from "./components/route-states";
import { routeTree } from "./routeTree.gen";
import "./index.css";
import "./lib/theme"; // keeps the theme in sync with the system setting
import "./lib/density";

// Any change may have added audit entries (docs/features/audit-log.md): History panels refetch.
const queryClient: QueryClient = new QueryClient({
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
