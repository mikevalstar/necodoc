import { FunnelSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A typed filter box: `key:value` tokens plus free text, with completions (the ARIA combobox
// pattern: the list follows the caret's token, arrows move, Enter or Tab takes one). The page owns
// the grammar: it serializes the URL into `value`, suggests, and parses on Enter.

export type TokenSuggestion = { insert: string; label: string; hint?: string };
export type TokenSuggestions = { start: number; end: number; items: TokenSuggestion[] };

export function TokenBar({
  label,
  value,
  placeholder,
  suggest,
  onApply,
  className,
}: {
  label: string;
  /** The applied filters as text; the draft follows it when the URL changes. */
  value: string;
  placeholder?: string;
  suggest: (text: string, caret: number) => TokenSuggestions;
  /** Applies the text, or returns why it can't (the draft stays for fixing). */
  onApply: (text: string) => string[];
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [errors, setErrors] = useState<string[]>([]);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-errors`;

  useEffect(() => {
    setDraft(value);
    setErrors([]);
  }, [value]);

  const suggestions = open ? suggest(draft, caret) : { start: 0, end: 0, items: [] };
  const shown = suggestions.items;
  const expanded = shown.length > 0;

  const track = () => setCaret(input.current?.selectionStart ?? draft.length);

  const accept = (suggestion: TokenSuggestion) => {
    const before = draft.slice(0, suggestions.start);
    const after = draft.slice(suggestions.end).replace(/^\s*/, "");
    // A key waits for its value; a value ends the token.
    const insert = suggestion.insert.endsWith(":") ? suggestion.insert : `${suggestion.insert} `;
    const next = `${before}${insert}${after}`;
    const at = before.length + insert.length;
    setDraft(next);
    setActive(-1);
    setCaret(at);
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
  };

  const apply = () => {
    const problems = onApply(draft.trim());
    setErrors(problems);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        setOpen(true);
        return;
      }
      if (!expanded) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      // -1 is the input itself: past either end, the caret goes back to the text.
      setActive((current) => {
        const next = current + step;
        return next >= shown.length ? -1 : next < -1 ? shown.length - 1 : next;
      });
      return;
    }
    const chosen = shown[active];
    if ((e.key === "Enter" || e.key === "Tab") && chosen) {
      e.preventDefault();
      accept(chosen);
    } else if (e.key === "Enter") {
      e.preventDefault();
      apply();
    } else if (e.key === "Escape") {
      if (expanded) setOpen(false);
      else {
        setDraft(value);
        setErrors([]);
      }
    }
  };

  return (
    <div className={cn("relative min-w-64 flex-1", className)}>
      <FunnelSimpleIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
      />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-input bg-surface py-1 pr-24 pl-9 font-mono text-[13px] outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-bad",
          value && "border-transparent bg-sun-wash text-sun-ink",
        )}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "Home" ||
            e.key === "End"
          )
            track();
        }}
        onClick={() => {
          track();
          setOpen(true);
        }}
        onFocus={() => {
          track();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3"
      >
        {draft.trim() !== value ? "↵ apply" : ""}
      </span>
      <div
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!expanded}
        className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-auto rounded-lg bg-popover p-1 text-sm shadow-lg ring-1 ring-foreground/10"
      >
        {shown.map((suggestion, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys (combobox pattern)
          <div
            key={suggestion.insert}
            id={`${id}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            className={cn(
              "flex cursor-default items-baseline justify-between gap-4 rounded-md px-2.5 py-1.5",
              i === active ? "bg-tint text-ink" : "text-ink-2",
            )}
            // Keep focus in the input.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => accept(suggestion)}
          >
            <span className="font-mono text-[13px]">{suggestion.label}</span>
            {suggestion.hint && (
              <span className="truncate text-xs text-ink-3">{suggestion.hint}</span>
            )}
          </div>
        ))}
      </div>
      <div id={errorId} aria-live="polite" className="empty:hidden">
        {errors.map((error) => (
          <p key={error} className="mt-1.5 flex items-center gap-1 text-xs text-bad">
            <WarningCircleIcon weight="bold" className="size-3.5 shrink-0" />
            {error}
          </p>
        ))}
      </div>
    </div>
  );
}
