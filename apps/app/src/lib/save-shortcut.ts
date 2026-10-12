import { useEffect } from "react";

/** ⌘/Ctrl+S runs `save` instead of the browser's "Save page", while `enabled`. */
export function useSaveShortcut(enabled: boolean, save: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "s" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (enabled) save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, save]);
}
