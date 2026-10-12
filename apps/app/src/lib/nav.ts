import {
  BracketsCurlyIcon,
  FilesIcon,
  type Icon,
  LayoutIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import type { LinkProps } from "@tanstack/react-router";
import { type Access, canAccess, type Me } from "./auth";

// Spec: docs/features/app-shell-and-navigation.md. The sidebar's sections and pages, shared by the
// shell (_app.tsx) and the command palette, so both apply the same access rules.

export type Roles = Me["user"]["roles"];
export type NavItem = {
  to: LinkProps["to"];
  label: string | ((roles: Roles) => string);
  /** Shows the count of unseen share-link responses. */
  unseen?: true;
  /** Who sees it; the page's own guard (`requireAccess`) uses the same rule. */
  access?: Access;
};
export type NavSection = {
  label: string;
  icon: Icon;
  /** Path prefixes that belong to the section, so detail pages keep it highlighted. */
  paths: readonly string[];
  items: readonly NavItem[];
  /** Who sees the section. */
  access?: Access;
};

// Grouped by who uses it: people filling documents, template designers, developers, admins.
const sections: readonly NavSection[] = [
  {
    label: "Documents",
    icon: FilesIcon,
    paths: ["/", "/documents", "/share-links"],
    items: [
      { to: "/", label: "My documents" },
      { to: "/share-links", label: "Share links", unseen: true, access: ["publish"] },
    ],
  },
  {
    label: "Templates",
    icon: LayoutIcon,
    paths: ["/templates", "/snippets", "/themes", "/assets"],
    items: [
      { to: "/templates", label: "Templates" },
      {
        to: "/templates/reviews",
        label: "Reviews",
        access: ["edit", "review", "publish"],
      },
      {
        to: "/snippets",
        label: "Snippets",
        access: ["create", "edit", "review", "publish"],
      },
      { to: "/themes", label: "Themes" },
      { to: "/assets", label: "Assets" },
    ],
  },
  {
    label: "Developers",
    icon: BracketsCurlyIcon,
    paths: ["/developers", "/render", "/generations", "/batches", "/settings/api-keys"],
    items: [
      { to: "/developers", label: "API reference" },
      { to: "/settings/api-keys", label: "API keys" },
      { to: "/render", label: "Render playground" },
      {
        to: "/generations",
        label: (r) => (r.includes("admin") ? "Generations" : "My generations"),
      },
      { to: "/batches", label: "Batches" },
    ],
  },
  {
    label: "Admin",
    icon: ShieldCheckIcon,
    paths: ["/admin"],
    access: "admin",
    items: [
      { to: "/admin/users", label: "Users" },
      { to: "/admin/service-accounts", label: "Service accounts" },
      { to: "/admin/api-keys", label: "API keys" },
      { to: "/admin/system", label: "System" },
      { to: "/admin/queue", label: "Queue" },
      { to: "/admin/analytics", label: "Analytics" },
      { to: "/admin/audit", label: "Audit log" },
      { to: "/admin/privacy", label: "Data subjects" },
      { to: "/admin/faq", label: "FAQ" },
    ],
  },
];

export const inPath = (path: string, pathname: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);

export const inSection = (section: NavSection, pathname: string) =>
  section.paths.some((path) => inPath(path, pathname));

/** Pages outside the four sections, for the breadcrumb. */
export const otherPages: Readonly<Record<string, string>> = {
  "/settings": "Settings",
  "/usage": "My usage",
};

/** The sections a user sees, each with only the pages their roles may open. */
export function visibleSections(roles: Roles) {
  if (!roles.length) return [];
  return sections
    .filter((section) => !section.access || canAccess(roles, section.access))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.access || canAccess(roles, item.access)),
    }));
}

export const labelOf = (item: NavItem, roles: Roles) =>
  typeof item.label === "string" ? item.label : item.label(roles);
