import {
  contentTexts,
  type FieldSection,
  languageTagSchema,
  type TranslatableContent,
  type Translations,
  textDirection,
  translatableStrings,
} from "@necodoc/shared";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Spec: docs/features/document-localization.md (ADR 0040). Per-language tables keyed by the
// template's own text: field labels and help, visual text runs, and `"..." | t` in code mode and
// overlay boxes. A missing translation prints the source text.

export function TranslationsPanel({
  translations,
  lang,
  sections,
  content,
  editable,
  onChange,
}: {
  translations: Translations;
  /** The template's own language: what the source text is written in. */
  lang: string;
  sections: readonly FieldSection[];
  content: TranslatableContent;
  editable: boolean;
  onChange: (translations: Translations) => void;
}) {
  const languages = Object.keys(translations);
  const [selected, setSelected] = useState(languages[0] ?? null);
  const [adding, setAdding] = useState("");
  const current = selected && Object.hasOwn(translations, selected) ? selected : languages[0];
  const table = current ? (translations[current] ?? {}) : {};
  const strings = translatableStrings(sections, contentTexts(content));
  const unused = Object.keys(table).filter((source) => !strings.includes(source));
  const done = strings.filter((source) => table[source]).length;

  const newTag = adding.trim();
  const canAdd =
    languageTagSchema.safeParse(newTag).success &&
    newTag.toLowerCase() !== lang.toLowerCase() &&
    !languages.some((l) => l.toLowerCase() === newTag.toLowerCase());

  const setTable = (language: string, next: Record<string, string>) =>
    onChange({ ...translations, [language]: next });
  const setString = (source: string, text: string) => {
    if (!current) return;
    const { [source]: _old, ...rest } = table;
    setTable(current, text ? { ...rest, [source]: text } : rest);
  };

  return (
    <fieldset disabled={!editable} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Write the template in its own language ({lang}, set on the Output tab) and translate it
        here. The person filling picks a language, or an API call sets{" "}
        <code className="font-mono">output.lang</code>; anything untranslated prints as written.{" "}
        {"boxes" in content || content.mode === "code" ? (
          <>
            Wrap text to translate in <code className="font-mono">{'{{ "Thank you" | t }}'}</code>;{" "}
            <code className="font-mono">{"{{ status | t }}"}</code> translates a value.
          </>
        ) : (
          "Visual text is translated run by run: bold words and merge fields split a sentence."
        )}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {languages.map((language) => (
          <Button
            key={language}
            size="sm"
            variant={language === current ? "default" : "outline"}
            onClick={() => setSelected(language)}
          >
            {language}
          </Button>
        ))}
        <Field className="w-auto">
          <FieldLabel htmlFor="translation-add" className="sr-only">
            Add a language
          </FieldLabel>
          <Input
            id="translation-add"
            className="h-8 w-28 font-mono"
            placeholder="fr-CA"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={!canAdd}
          onClick={() => {
            onChange({ ...translations, [newTag]: {} });
            setSelected(newTag);
            setAdding("");
          }}
        >
          <PlusIcon weight="bold" />
          Add language
        </Button>
      </div>
      {current ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {done} of {strings.length} translated
              {textDirection(current) === "rtl" && " · right to left"}
            </span>
            <span className="flex gap-2">
              {unused.length > 0 && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setTable(
                      current,
                      Object.fromEntries(
                        Object.entries(table).filter(([source]) => strings.includes(source)),
                      ),
                    )
                  }
                >
                  Remove {unused.length} unused
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                className="text-destructive"
                onClick={() => {
                  const { [current]: _removed, ...rest } = translations;
                  onChange(rest);
                }}
              >
                <TrashIcon />
                Remove {current}
              </Button>
            </span>
          </div>
          {strings.length === 0 && (
            <FieldDescription>Nothing to translate yet: add fields or text.</FieldDescription>
          )}
          <div className="space-y-2">
            {strings.map((source) => (
              <div key={source} className="grid gap-2 sm:grid-cols-2">
                <span className="text-sm break-words">{source}</span>
                <Input
                  aria-label={`${source} in ${current}`}
                  dir={textDirection(current)}
                  lang={current}
                  value={table[source] ?? ""}
                  onChange={(e) => setString(source, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <FieldDescription>No translations yet. Add a language to start.</FieldDescription>
      )}
    </fieldset>
  );
}
