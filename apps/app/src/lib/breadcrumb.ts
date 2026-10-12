import { useEffect, useSyncExternalStore } from "react";

// The last breadcrumb, named by the page itself: a record's name on a detail page, or the page's
// own title where the nav has no item for it. The shell (_app.tsx) shows it after the nav crumbs.

let crumb: string | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Names the current page in the shell's breadcrumb; pass undefined while it loads. */
export function usePageCrumb(name: string | undefined) {
  useEffect(() => {
    crumb = name;
    emit();
    return () => {
      crumb = undefined;
      emit();
    };
  }, [name]);
}

/** The shell's side: the name the current page gave, if any. */
export function useCurrentCrumb() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => crumb,
  );
}
