import { createFileRoute } from "@tanstack/react-router";
import { NotFound } from "@/components/route-states";

// Unknown paths for signed-in users: the not-found page inside the app shell, nav included.
export const Route = createFileRoute("/_app/$")({
  component: NotFound,
});
