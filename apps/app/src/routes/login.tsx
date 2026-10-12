import { signInSchema } from "@necodoc/shared";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AuthFrame } from "@/components/auth-frame";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { authClient, meQuery, signInOptionsQuery, unwrap, useSessionChange } from "@/lib/auth";

// Spec: docs/features/single-sign-on.md. Failed SSO sign-ins come back here with ?error=.
const searchSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const ssoErrors: Record<string, string> = {
  account_exists:
    "An account with your email already exists. Ask an admin to link it to single sign-on.",
  account_not_linked:
    "An account with your email already exists. Ask an admin to link it to single sign-on.",
  service_account: "Service accounts can't sign in.",
  email_domain: "Your email domain can't sign in here.",
  untrusted_proxy: "Header sign-in only works through your organisation's sign-on proxy.",
  no_identity: "Your sign-on proxy didn't say who you are.",
  no_email: "Your sign-on proxy didn't send a valid email address.",
  banned: "Your account has been banned. Ask an admin if you think this is a mistake.",
};

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: "/" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(signInOptionsQuery),
  component: Login,
});

function Login() {
  const options = useSuspenseQuery(signInOptionsQuery).data;
  const search = Route.useSearch();
  const ssoError = search.error
    ? (ssoErrors[search.error] ??
      search.error_description ??
      `Single sign-on failed (${search.error.replaceAll("_", " ")}).`)
    : null;
  const ssoSignIn = useMutation({
    // The client follows the IdP redirect; nothing to do on success.
    mutationFn: (providerId: string) =>
      unwrap(authClient.signIn.sso({ providerId, callbackURL: "/", errorCallbackURL: "/login" })),
  });
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
    <AuthFrame>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {options.password
              ? "Use the email and password you registered with."
              : "Sign in with your organisation's account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ssoError && (
            <Alert variant="destructive">
              <AlertDescription>{ssoError}</AlertDescription>
            </Alert>
          )}
          {options.providers.length > 0 && (
            <div className="flex flex-col gap-2">
              <ErrorAlert error={ssoSignIn.error} />
              {options.providers.map((provider) =>
                provider.type === "header" ? (
                  <Button
                    key={provider.id}
                    variant="outline"
                    nativeButton={false}
                    render={<a href={`/api/sso/header/${provider.id}`} />}
                  >
                    Sign in with {provider.label}
                  </Button>
                ) : (
                  <Button
                    key={provider.id}
                    variant="outline"
                    disabled={ssoSignIn.isPending}
                    onClick={() => ssoSignIn.mutate(provider.id)}
                  >
                    Sign in with {provider.label}
                  </Button>
                ),
              )}
            </div>
          )}
          {options.password && options.providers.length > 0 && (
            <p className="text-center text-xs text-muted-foreground uppercase">or</p>
          )}
          {options.password && (
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
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
