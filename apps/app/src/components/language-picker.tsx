import type { Translations } from "@necodoc/shared";
import { LanguagesIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

// Spec: docs/features/document-localization.md. The fill page's and share links' language: the
// template's own, or one it has translations for. Hidden when there's only one.

/** Language names in their own language where the browser knows them (`fr` → "français"). */
function languageName(tag: string) {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function LanguagePicker({
  lang,
  translations,
  value,
  onChange,
}: {
  /** The template's own language. */
  lang: string;
  translations: Translations;
  value: string;
  onChange: (lang: string) => void;
}) {
  const languages = [lang, ...Object.keys(translations)];
  if (languages.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <LanguagesIcon className="size-4 text-muted-foreground" />
      <NativeSelect
        size="sm"
        aria-label="Language"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {languages.map((tag) => (
          <NativeSelectOption key={tag} value={tag}>
            {languageName(tag)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </span>
  );
}
