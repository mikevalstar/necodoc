import { useSyncExternalStore } from "react";
import { z } from "zod";

// Spec: docs/features/design-system.md (Tables). Comfortable or compact table rows, stored per
// browser like the theme. Applied as data-density on <html>, which index.css turns into --row-h
// and the `compact:` variant. index.html applies it before first paint; keep its key in sync.
const densitySchema = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof densitySchema>;

const storageKey = "necodoc-density";
const listeners = new Set<() => void>();

function readStored(): Density {
  try {
    return densitySchema.catch("comfortable").parse(localStorage.getItem(storageKey));
  } catch {
    return "comfortable"; // storage blocked
  }
}

let current = readStored();
document.documentElement.dataset.density = current;

export function setDensity(density: Density) {
  current = density;
  try {
    localStorage.setItem(storageKey, density);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  document.documentElement.dataset.density = density;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, () => current);
}
