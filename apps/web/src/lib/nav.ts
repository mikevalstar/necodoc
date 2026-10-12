import { links } from "./links";

export type NavItem = { id: string; label: string; href: string; external?: boolean };

export const mainNav: NavItem[] = [
  { id: "insurance", label: "Insurance", href: "/insurance/" },
  { id: "architecture", label: "Architecture", href: "/architecture/" },
  { id: "security", label: "Security & governance", href: "/security/" },
  { id: "performance", label: "Performance", href: "/performance/" },
  { id: "docs", label: "Docs", href: links.docs, external: true },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
  {
    title: "For carriers",
    items: [
      { id: "surety", label: "Surety bonds", href: "/insurance/#surety" },
      { id: "coi", label: "Certificates", href: "/insurance/#coi" },
      { id: "renewals", label: "Renewal runs", href: "/insurance/#renewals" },
      { id: "bilingual", label: "Bilingual EN/FR", href: "/insurance/#bilingual" },
    ],
  },
  {
    title: "Evaluate",
    items: [
      { id: "architecture", label: "Architecture", href: "/architecture/" },
      { id: "security", label: "Security & governance", href: "/security/" },
      { id: "performance", label: "Performance", href: "/performance/" },
      { id: "pack", label: "Architecture review pack", href: links.reviewPack },
    ],
  },
  {
    title: "Project",
    items: [
      { id: "docs", label: "Developer docs", href: links.docs, external: true },
      { id: "github", label: "Source on GitHub", href: links.github, external: true },
      {
        id: "discussions",
        label: "Questions: GitHub Discussions",
        href: links.discussions,
        external: true,
      },
    ],
  },
];
