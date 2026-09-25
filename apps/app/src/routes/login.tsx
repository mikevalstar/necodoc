import { signInSchema } from "@necodoc/shared";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { authClient, meQuery, unwrap, useSessionChange } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const sessionChanged = useSessionChange();
  const signIn = useMutation({
    mutationFn: (value: z.infer<typeof signInSchema>) => unwrap(authClient.signIn.email(value)),
    onSuccess: () => sessionChanged("/"),
  });
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onChange: signInSchema },
    onSubmit: ({ value }) => signIn.mutate(value),
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to necodoc</CardTitle>
          <CardDescription>Use the email and password you registered with.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <ErrorAlert error={signIn.error} />
              <form.AppField name="email">
                {(field) => <field.TextField label="Email" type="email" autoComplete="email" />}
              </form.AppField>
              <form.AppField name="password">
                {(field) => (
                  <field.TextField
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                  />
                )}
              </form.AppField>
              <Button type="submit" disabled={signIn.isPending}>
                Sign in
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link to="/register" className="underline underline-offset-4">
                  Register
                </Link>
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
