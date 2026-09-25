import type { Role } from "@necodoc/shared";
import { Badge } from "@/components/ui/badge";

export function RoleBadges({ roles }: { roles: readonly Role[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge
          key={role}
          variant={role === "admin" ? "default" : "secondary"}
          className="capitalize"
        >
          {role}
        </Badge>
      ))}
    </div>
  );
}
