---
type: adr
title: AI assistant proposes changes as client-side tool calls
description: The template assistant's tools have no server-side execute. The model's tool calls stream to the editor as proposals validated against shared zod schemas; the author applies or rejects each, and that answer goes back to the model as the tool result. The server never changes a template.
tags: [architecture, api, app, ai]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T05:58:32Z }
---

# AI assistant proposes changes as client-side tool calls

## Status

Accepted. Behaviour: [AI template assistant](../features/ai-template-assistant.md). Builds on [ADR 0022](0022-vercel-ai-sdk-for-all-ai-features.md).

## Context

The [assistant](../features/ai-template-assistant.md) edits a template draft, but every change must be shown to the author and applied only when accepted. The draft the author is looking at lives in the editor, usually with unsaved edits; the server only has the last save. Saving on the author's behalf would also skip the editor's undo and its unsaved-changes guard.

## Decision

- **Tools without `execute`.** The API's `streamText` declares the tools ([assistant.ts](../../packages/shared/src/assistant.ts) holds their input schemas) but runs none. Each tool call streams to the browser (`useChat`) as a proposal.
- **The editor applies.** Accept runs the shared, pure apply function on the in-memory draft, then sends `applied` as the tool result; reject sends `rejected`. The model sees the answer and carries on. Nothing is saved until the author saves.
- **The request carries the draft.** Each chat request sends the current (unsaved) draft; the model's instructions describe it, so it always edits what the author sees.
- **Validated twice.** The AI SDK checks tool inputs against the shared zod schemas (an invalid call goes back to the model as an error), and applying checks the result is still a valid draft.

## Alternatives considered

- **Server-side tools that write the draft.** Simple loop, but changes would land unreviewed, race the author's unsaved edits and bypass undo.
- **AI SDK tool approval (`toolApproval`) with server execution.** Gives an approve step, but execution still happens on the server against the saved draft.
- **One structured-output call returning a whole draft.** Fine for "create from a description", but no conversation, and every small edit would regenerate everything.

## Consequences

- The API stays stateless for the assistant: no conversations or pending changes stored.
- Apply logic is plain shared code, testable without a model.
- Large drafts are re-sent on every turn (cost grows with template size).
- A tampered client could fabricate tool results; it can only change its own unsaved draft, which saving validates as usual.
