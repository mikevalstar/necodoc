import type { Field, FieldSection, GroupField, ScalarField, Signer } from "@necodoc/shared";
import type { ResolvedPos } from "@tiptap/pm/model";
import { createContext, useContext } from "react";

// What the custom nodes pick from: the template's declared fields (docs/features/
// template-fields-and-guided-form.md). Node views read it through context, so renaming a field
// in the designer updates every chip and picker at once.

export type EditorFields = {
  sections: readonly FieldSection[];
  /** Header and footer editors also offer the page tokens. */
  band: boolean;
  /** The template's signers, for sign boxes (docs/features/signing-packages.md). */
  signers: readonly Signer[];
};

export const EditorFieldsContext = createContext<EditorFields>({
  sections: [],
  band: false,
  signers: [],
});

export const useEditorFields = () => useContext(EditorFieldsContext);

/** A field a picker offers: `key`, or `group.key` inside a repeat over `group`. */
export type FieldChoice = { path: string; label: string; field: ScalarField };

/** Page tokens aren't fields; merge fields in bands can still print them. */
export const pageTokens = [
  { path: "page", label: "Page number" },
  { path: "pages", label: "Total pages" },
] as const;

export const topLevelFields = (sections: readonly FieldSection[]): Field[] =>
  sections.flatMap((section) => section.fields);

export const groupFields = (sections: readonly FieldSection[]) =>
  topLevelFields(sections).filter((field): field is GroupField => field.type === "group");

/**
 * Scalar fields usable at a point in the document: top-level ones, plus the children of the
 * group the point repeats over.
 */
export function scalarChoices(sections: readonly FieldSection[], repeat: string | null) {
  const choices: FieldChoice[] = [];
  for (const field of topLevelFields(sections)) {
    if (field.type !== "group") choices.push({ path: field.key, label: field.label, field });
    else if (field.key === repeat) {
      for (const child of field.fields) {
        choices.push({
          path: `${field.key}.${child.key}`,
          label: `${field.label} › ${child.label}`,
          field: child,
        });
      }
    }
  }
  return choices;
}

/** The label a chip shows for a path, or null when the path isn't declared. */
export function pathLabel(sections: readonly FieldSection[], path: string) {
  const token = pageTokens.find((t) => t.path === path);
  if (token) return token.label;
  const [key, child] = path.split(".");
  const field = topLevelFields(sections).find((f) => f.key === key);
  if (!field) return null;
  if (child === undefined) return field.label;
  if (field.type !== "group") return null;
  const sub = field.fields.find((f) => f.key === child);
  return sub ? `${field.label} › ${sub.label}` : null;
}

/** The repeating group a position sits inside: a repeating section or a repeated table row. */
export function enclosingRepeat($pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const group: unknown =
      node.type.name === "repeatingSection"
        ? node.attrs.field
        : node.type.name === "tableRow"
          ? node.attrs.repeat
          : null;
    if (typeof group === "string" && group) return group;
  }
  return null;
}
