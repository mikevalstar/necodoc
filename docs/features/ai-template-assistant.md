---
type: feature
title: AI template assistant
description: A chat panel in the template editor where an author describes a document and the AI builds or edits the template (fields, content, header/footer, page settings, theme) through reviewed tool calls. Available only when AI is enabled.
tags: [product, app, api, ai]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T17:36:07Z }
---

# AI template assistant

## Summary

Authors chat with an assistant in the template editor: "a surety bond for a contractor licence in Oregon, principal, surety and obligee, penal sum, effective date". It proposes the fields and content, and edits the template when the author accepts. Mechanism: [ADR 0022](../adrs/0022-vercel-ai-sdk-for-all-ai-features.md).

## Motivation

A blank editor is the slowest part of authoring. GhostDraft authors start from Word; DocSpring and Anvil start from HTML or a PDF. Describing the document and refining it in conversation gets a first draft in minutes and lowers the skill needed for [document templates](document-templates.md).

## Behavior

- **Where:** a chat panel beside the editor, for users who can edit the template. Hidden when AI is off.
- **What it can do** (tool calls against the current draft):
  - add, change or remove [fields](template-fields-and-guided-form.md) and sections, including show-if conditions and repeating groups
  - write or rewrite body content, a selection, or a header/footer, using only declared fields and the editor's node set (merge fields, conditional and repeating sections, tables, page breaks)
  - set page size, margins and the [theme](document-themes.md)
  - fill sample data
  - explain the template or a Liquid expression
- **Context it sees:** the draft (fields, content, page settings), the theme names, and the conversation. It does not see other templates, generation data or users.
- **Reviewed changes.** Each proposed change shows as a diff or preview the author applies or rejects. Applied changes land in the draft like a manual edit (undo works, nothing is published). The live preview updates.
- **Streaming** responses; the author can stop a response.
- **Start from a description:** a new template can be created from a prompt, producing a draft with fields and content.
- **Errors** (refusal, invalid tool call, provider error) show in the chat and change nothing.
- **Summaries.** A template's description and a version's publish note are written by people and can be drafted by AI:
  - *Template summary:* "Suggest with AI" next to the description drafts a plain-language summary from the fields and content (what the document is, who fills it, key conditions).
  - *Version summary:* in the publish dialog, "Suggest with AI" drafts the note from the diff against the previous version (fields added/removed/changed, content and header/footer changes, page or theme changes). On the first version it summarises the template.
  - The draft lands in the text box for the author to edit; nothing is saved until they save or publish. Existing versions without a note can get one drafted and saved by a user with publish permission.
  - The versions list shows each note, so the history reads as a changelog.
- **On/off:** AI features exist only when `ANTHROPIC_KEY` is set. Without it, the panel and every other AI control are absent and the AI routes return 404.

## Acceptance criteria

- [ ] With no `ANTHROPIC_KEY`, no AI control appears anywhere and AI routes return 404.
- [ ] From a one-paragraph description, the assistant creates a draft with sensible fields and content that previews without errors.
- [ ] Asking it to "add a co-principal and show the second signature block only when there is one" adds the field, the condition and the content.
- [ ] Every change is shown before it applies, and rejecting it leaves the draft unchanged.
- [ ] "Suggest with AI" drafts a template description and, in the publish dialog, a version note that names the actual changes since the previous version; both stay editable and save only when the author saves.
- [ ] A viewer or a user without edit permission can't call the assistant routes (403).

## Known limitations

- Template content and the conversation go to the model provider. The panel says so.
- Suggestions can be wrong; the author reviews every change.
- No per-user quota or cost tracking yet.
- Conversations aren't saved between sessions.
