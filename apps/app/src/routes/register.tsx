import { signUpSchema } from "@necodoc/shared";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import type { z } from "zod";
import { AuthFrame } from "@/components/auth-frame";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { authClient, meQuery, signInOptionsQuery, unwrap, useSessionChange } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: "/" });
    // SSO-only installs (docs/features/single-sign-on.md) have no self-registration.
    const options = await context.queryClient.ensureQueryData(signInOptionsQuery);
    if (!options.password) throw redirect({ to: "/login" });
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
    <AuthFrame
      title="Create an account"
      description="The first account becomes the admin. Everyone after that waits for an admin to grant access."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <FieldGroup className="gap-5">
          <ErrorAlert error={signUp.error} />
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" autoComplete="name" />}
          </form.AppField>
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
              />
            )}
          </form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                label="Password"
                description="At least 8 characters."
                autoComplete="new-password"
              />
            )}
          </form.AppField>
          <Button type="submit" disabled={signUp.isPending}>
            {signUp.isPending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-center text-sm text-ink-2">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-brand-ink underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </FieldGroup>
      </form>
    </AuthFrame>
  );
}
