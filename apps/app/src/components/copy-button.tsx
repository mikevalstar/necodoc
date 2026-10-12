import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `text` and shows "Copied" for a moment. Other Button props (size, className, aria-label) pass through. */
export function CopyButton({
  text,
  label = "Copy",
  size = "sm",
  variant = "outline",
  ...props
}: { text: string; label?: string } & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      {...props}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon weight="bold" /> : <CopyIcon />}
      {copied ? "Copied" : label}
    </Button>
  );
}
