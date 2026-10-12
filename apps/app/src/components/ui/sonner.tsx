import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

// Cobalt toasts are inverted (ink on canvas), like the editor's assistant toast in the mockups,
// so they read as transient and never as page content.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <CheckCircleIcon weight="fill" className="size-5 text-[#4fd8a0] dark:text-[#0b7a52]" />
        ),
        info: <InfoIcon weight="fill" className="size-5" />,
        warning: <WarningIcon weight="fill" className="size-5 text-sun dark:text-[#8a5600]" />,
        error: (
          <WarningOctagonIcon weight="fill" className="size-5 text-[#ff8a8f] dark:text-[#c92a32]" />
        ),
        loading: <SpinnerGapIcon className="size-5 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--ink)",
          "--normal-text": "var(--canvas)",
          "--normal-border": "transparent",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-float !font-sans",
          description: "!text-[color-mix(in_srgb,var(--canvas)_78%,transparent)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
