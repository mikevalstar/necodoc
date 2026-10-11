---
type: feature
title: Template fields and guided form
description: Each template declares typed fields with validation, help text, sections and show-if conditions. That one definition drives the guided form, API validation, an exported JSON Schema, and sample data.
tags: [product, forms, app, api, shared]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Template fields and guided form

## Summary

A template lists the data it needs as typed fields. From that list necodoc
builds the guided form users fill in, the validation the API applies, a JSON
Schema for API callers, and the sample data previews use.

## Motivation

The form, the API checks and the template must agree on what a field is. If
they're defined separately they drift, and a document ships with a blank where
a name should be. One definition per template keeps them in step, the same idea
as [ADR 0008](../adrs/0008-zod-schemas-shared-between-api-and-app.md) applied
to user-defined data.

## Behavior

- **Field types:** text, long text, number, date, boolean, choice (single or
  multiple, with options), email, image, signature, repeating group.
- **Every field has:** a key (`snake_case`, unique in the template), a label,
  optional help text, required or optional, and an optional default.
- **Validation per type:** min/max length and pattern for text; min, max and
  decimals for number; min/max date; min/max items for repeating groups and
  multiple choice.
- **Repeating group.** A list of items, each with its own child fields. It
  feeds repeating sections and table rows in
  [designed templates](document-templates.md).
- **Sections.** Fields are ordered and grouped into sections. The guided form
  shows one section per step, with progress.
- **Show-if conditions.** A field or section can be shown only when another
  field matches a simple rule (equals, not equals, is one of, is set, greater
  or less than). Hidden fields are never required, and their values are
  dropped from the data. Conditions are structured data, not Liquid, so the
  browser and the API evaluate them the same way.
- **Image and signature inputs.** Image fields take an upload; signature
  fields take a drawn signature saved as a PNG.
- **One schema.** A builder in `packages/shared` turns the field list into a zod
  schema. The app uses it for the form; the API uses it for every generation,
  from the UI, the [API](html-to-pdf-api.md) and
  [share links](share-links-and-data-requests.md). The API also exports it as JSON
  Schema per template version.
- **Sample data.** Each template keeps one sample data set, editable as a form
  or as JSON, used by previews. "Fill with examples" generates plausible values
  from the field types.
- Field definitions are part of the published version
  ([Publishing and versions](publishing-and-versions.md)).

## Acceptance criteria

- [ ] An editor can add, reorder, group and delete fields of every type.
- [ ] The guided form shows sections as steps, help text under each field,
      and errors as the user types.
- [ ] A show-if field appears and disappears as its condition changes, and a
      hidden required field doesn't block submission.
- [ ] The API rejects data that the form would reject, with field-level
      errors keyed by field path.
- [ ] The JSON Schema export validates the same sample data the zod schema
      accepts.
- [ ] Renaming a field key flags every template expression that still uses the
      old key.

## Known limitations

- No computed fields. Derive values with Liquid filters in the template.
- Show-if rules compare one field with a value. No AND/OR groups yet.
- No cross-field validation (e.g. end date after start date).
- Fields belong to one template. There is no shared field library.
