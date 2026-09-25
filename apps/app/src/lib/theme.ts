import { useSyncExternalStore } from "react";
import { z } from "zod";

// Spec: docs/features/user-preferences.md. Stored per browser, not per account.
// index.html applies the stored theme before first paint; keep its key and rule in sync.
const themeSchema = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof themeSchema>;
export const themes = themeSchema.options;

const storageKey = "necodoc-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readStoredTheme(): Theme {
  try {
    return themeSchema.catch("system").parse(localStorage.getItem(storageKey));
  } catch {
    return "system"; // storage blocked
  }
}

let current = readStoredTheme();

function applyTheme() {
  document.documentElement.classList.toggle(
    "dark",
    current === "dark" || (current === "system" && systemDark.matches),
  );
}

applyTheme();
systemDark.addEventListener("change", applyTheme);

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  applyTheme();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current);
}
