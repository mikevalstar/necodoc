import { signUpSchema } from "@necodoc/shared";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { authClient, meQuery, unwrap, useSessionChange } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: "/" });
  },
  component: Register,
});

function Register() {
  const sessionChanged = useSessionChange();
  const signUp = useMutation({
    mutationFn: (value: z.infer<typeof signUpSchema>) => unwrap(authClient.signUp.email(value)),
    onSuccess: () => sessionChanged("/"),
  });
  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: { onChange: signUpSchema },
    onSubmit: ({ value }) => signUp.mutate(value),
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            The first account becomes the admin. Everyone after that waits for an admin to grant
            access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <ErrorAlert error={signUp.error} />
              <form.AppField name="name">
                {(field) => <field.TextField label="Name" autoComplete="name" />}
              </form.AppField>
              <form.AppField name="email">
                {(field) => <field.TextField label="Email" type="email" autoComplete="email" />}
              </form.AppField>
              <form.AppField name="password">
                {(field) => (
                  <field.TextField label="Password" type="password" autoComplete="new-password" />
                )}
              </form.AppField>
              <Button type="submit" disabled={signUp.isPending}>
                Register
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already registered?{" "}
                <Link to="/login" className="underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
