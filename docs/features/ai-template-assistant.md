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

Authors chat with an assistant in the template editor: "a surety bond for a contractor licence in Oregon, principal, surety and obligee, penal sum, effective date". It proposes the fields and content, and edits the template when the author accepts. Mechanism: [ADR 0022](../adrs/0022-vercel-ai-sdk-for-all-ai-features.md), [ADR 0035](../adrs/0035-ai-assistant-proposes-changes-as-client-side-tool-calls.md).

## Motivation

A blank editor is the slowest part of authoring. GhostDraft authors start from Word; DocSpring and Anvil start from HTML or a PDF. Describing the document and refining it in conversation gets a first draft in minutes and lowers the skill needed for [document templates](document-templates.md).

## Behavior

- **Where:** a chat panel beside the editor of a designed template, for users who can edit it. Hidden when AI is off.
- **What it can do** (tool calls against the current draft):
  - add, change or remove [fields](template-fields-and-guided-form.md) and sections, including show-if conditions and repeating groups
  - write or rewrite body content, a selection, or a header/footer, using only declared fields and the editor's node set (merge fields, conditional and repeating sections, tables, page breaks)
  - set page size, margins and the [theme](document-themes.md)
  - fill sample data
  - edit the HTML/Liquid body, header or footer of a code-mode template, and the template CSS
  - explain the template or a Liquid expression (plain chat, no change)

  The tools and how a proposal applies to the draft: [assistant.ts](../../packages/shared/src/assistant.ts); the route: [assistant.ts](../../apps/api/src/routes/assistant.ts).
- **Context it sees:** the draft (fields, content, page settings), the theme names, and the conversation. It does not see other templates, generation data or users.
- **Reviewed changes.** Each proposed change shows as a structural diff (the one [review](review-and-approval.md) uses), with field-reference warnings and an optional preview of the PDF with the change, which the author applies or rejects. Applied changes land in the draft like a manual edit (undo works, nothing is published). The live preview updates.
- **Streaming** responses; the author can stop a response.
- **Start from a description:** the new-template dialog takes a description; the template is created empty and opens with the assistant building it from that description, through the same reviewed proposals (with an "Apply all").
- **Errors** (refusal, invalid tool call, provider error) show in the chat and change nothing.
- **Summaries.** A template's description and a version's publish note are written by people and can be drafted by AI:
  - *Template summary:* "Suggest with AI" next to the description drafts a plain-language summary from the fields and content (what the document is, who fills it, key conditions).
  - *Version summary:* in the publish dialog, "Suggest with AI" drafts the note from the diff against the previous version (fields added/removed/changed, content and header/footer changes, page or theme changes), computed by the shared structural diff ([template-diff.ts](../../packages/shared/src/template-diff.ts)) that review also uses. On the first version it summarises the template.
  - The draft lands in the text box for the author to edit; nothing is saved until they save or publish. Existing versions without a note can get one drafted and saved by a user with publish permission.
  - The versions list shows each note, so the history reads as a changelog. Notes can be edited there by a user with publish permission.
- **Audit:** each AI request is recorded in the [audit log](audit-log.md) as `template.ai_requested` (which feature, by whom, on which template); prompts and replies aren't stored. Editing a version note is recorded too.
- **On/off:** AI features exist only when `ANTHROPIC_KEY` is set. Without it, the panel and every other AI control are absent and the AI routes return 404.

## Acceptance criteria

- [x] With no `ANTHROPIC_KEY`, no AI control appears anywhere and AI routes return 404.
- [x] From a one-paragraph description, the assistant creates a draft with sensible fields and content that previews without errors.
- [x] Asking it to "add a co-principal and show the second signature block only when there is one" adds the field, the condition and the content.
- [x] Every change is shown before it applies, and rejecting it leaves the draft unchanged.
- [x] "Suggest with AI" drafts a template description and, in the publish dialog, a version note that names the actual changes since the previous version; both stay editable and save only when the author saves.
- [x] A viewer or a user without edit permission can't call the assistant routes (403).

## Known limitations

- Template content and the conversation go to the model provider. The panel says so.
- Suggestions can be wrong; the author reviews every change.
- No per-user quota or cost tracking yet; the audit log shows who used AI on which template.
- Conversations aren't saved between sessions.
- Overlay templates have no chat assistant (they have [AI field detection](pdf-overlay-templates.md)); the description summary works for both kinds.
- The whole draft and the tool definitions (about 20,000 tokens) are sent on every chat turn, so long templates cost more per message.
- The model sometimes miscounts body blocks after its own edits; a proposal that no longer fits is shown as "can't apply" and the model is told why.
- Version notes come from the structural diff, which shortens long paragraphs, so wording changes inside a clause are summarised loosely.
- The assistant can't see snippet content or upload images; it can only place existing assets and fields.
