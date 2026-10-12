---
title: AI template assistant
description: Describe a document and let the assistant build or edit a designed template through changes you review.
sidebar:
  order: 11
---

The template editor has a chat panel where you describe a document ("a surety bond for a contractor licence in Oregon: principal, surety, obligee, penal sum, effective date") and the assistant builds or edits the draft. It appears only when the deployment has AI turned on (`ANTHROPIC_KEY`, see [Configuration](/self-hosting/configuration/#ai)), and only to people who can edit the template.

## What it can change

- Fields and sections, including show-if conditions and repeating groups.
- Body content, a selection, or the header and footer, using the template's fields.
- The template's name and description.
- Page size, margins and theme; sample data; template CSS.
- In code mode, the HTML/Liquid body and bands.
- A translation of the template into another language (see [Localization](/guides/localization/)).

It can also explain the template or a Liquid expression without changing anything.

## Every change is reviewed

Each proposal shows as a diff of the draft, with warnings about field references and an optional PDF preview. Apply it or reject it. Applied changes land in the draft like a manual edit: undo works and nothing is published until you publish.

To start from scratch, give the new-template dialog a description: the template opens with the assistant building it, and **Apply all** takes every proposal at once.

"Suggest with AI" next to a template's description, and in the publish dialog for a version note, drafts the text for you to edit. Version notes come from the changes since the previous version.

## Good to know

- The draft and the conversation go to the model provider; other templates, generation data and users don't. Prompts and replies aren't stored; the audit log (Admin > Audit log) records who used AI on which template.
- Conversations aren't kept between sessions.
- Overlay templates have no chat assistant; they have AI field detection instead.
- Suggestions can be wrong. Preview before you publish, or use template test cases.
