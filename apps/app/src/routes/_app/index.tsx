import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

// Placeholder until document filling lands (docs/features/filling-out-a-document.md).
function Home() {
  const { me } = Route.useRouteContext();
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <h1 className="text-2xl font-semibold">Welcome, {me.user.name}</h1>
      <p className="text-muted-foreground">
        Documents will show up here once document filling is built.
      </p>
    </main>
  );
}
