import { cn } from "@/lib/utils";

// The neko mark from /brand/neko-mark.svg. Inline so it follows the app's class-based dark mode
// (the SVG file follows prefers-color-scheme instead).
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"
      />
      <path className="fill-[#2f6bff] dark:fill-[#6b93ff]" d="M36 47H40V53H36Z" />
    </svg>
  );
}
