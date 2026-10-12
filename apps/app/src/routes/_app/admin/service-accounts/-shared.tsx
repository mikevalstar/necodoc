import { type Role, roleSchema, updateServiceAccountSchema } from "@necodoc/shared";
import { queryOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFieldContext } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { api, ok } from "@/lib/api";

// Shared by the service-account list and detail pages and Admin › API keys (ADR 0029).

/** Create and edit forms: every field present, no defaults (form values are inputs). */
export const serviceAccountFormSchema = updateServiceAccountSchema.required({
  name: true,
  description: true,
  contact: true,
  roles: true,
});

export const serviceAccountsQuery = queryOptions({
  queryKey: ["service-accounts"],
  queryFn: async () => (await ok(api["service-accounts"].$get())).json(),
});

/** Roles a service account may hold: every role but admin (ADR 0029). */
const serviceRoles = roleSchema.options.filter((role) => role !== "admin");

export function ServiceRolesField() {
  const field = useFieldContext<Role[]>();
  return (
    <FieldSet>
      <FieldLegend variant="label">Roles</FieldLegend>
      <div className="grid grid-cols-2 gap-3">
        {serviceRoles.map((role) => (
          <Field key={role} orientation="horizontal">
            <Checkbox
              id={`role-${role}`}
              checked={field.state.value.includes(role)}
              onCheckedChange={(checked) =>
                field.handleChange(
                  serviceRoles.filter((r) =>
                    r === role ? checked : field.state.value.includes(r),
                  ),
                )
              }
            />
            <FieldLabel htmlFor={`role-${role}`} className="font-normal capitalize">
              {role}
            </FieldLabel>
          </Field>
        ))}
      </div>
      {field.state.meta.isTouched && <FieldError errors={field.state.meta.errors} />}
    </FieldSet>
  );
}

export function AccountStatusBadge({ disabled }: { disabled: boolean }) {
  return disabled ? (
    <Badge variant="bad" dot>
      Disabled
    </Badge>
  ) : (
    <Badge variant="ok" dot>
      Active
    </Badge>
  );
}

/** A card's title row: the heading on the left, counts and controls on the right. */
export function CardBar({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
      <div>
        <h2 className="font-heading text-[17px] font-bold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
