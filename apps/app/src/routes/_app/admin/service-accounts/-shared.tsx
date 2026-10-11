import { type Role, roleSchema, updateServiceAccountSchema } from "@necodoc/shared";
import { queryOptions } from "@tanstack/react-query";
import { useFieldContext } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { api, ok } from "@/lib/api";

// Shared by the service-account list and detail pages (ADR 0029).

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
