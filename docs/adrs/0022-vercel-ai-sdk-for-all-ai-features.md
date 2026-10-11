---
type: adr
title: Vercel AI SDK for all AI features
description: Every AI feature (field detection, drafting, the template chat assistant) goes through the Vercel AI SDK with the Anthropic provider and Claude Sonnet; AI is on only when ANTHROPIC_KEY is set. Supersedes ADR 0018's choice of SDK.
tags: [architecture, api, app, ai]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T17:36:07Z }
---

# Vercel AI SDK for all AI features

## Status

Accepted. Supersedes the SDK choice in [ADR 0018](0018-claude-api-for-ai-field-detection-and-drafting.md); the rest of 0018 still holds: Claude Sonnet, AI output is always a suggestion, and page content goes to the model provider. Adds the [AI template assistant](../features/ai-template-assistant.md). ai 7.x deprecates `generateObject`; structured output uses `generateText` with `Output.object({ schema })` ([ADR 0028](0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md)). The module is [ai.ts](../../apps/api/src/ai.ts).

## Context

ADR 0018 picked `@anthropic-ai/sdk`. Since then a third feature joined field detection and drafting: a chat assistant that builds and edits templates with tool calls and streams into the editor.

Enterprise customers often have to reach models through their own cloud account (AWS Bedrock, Google Vertex, Azure), not a direct Anthropic key. A direct SDK ties every AI call to one provider's client.

No AI code had been written yet, so switching costs nothing.

## Decision

- **Vercel AI SDK** (`ai`) in the API for every model call: `generateObject` / `streamObject` with zod schemas from `packages/shared` for structured output (field detection), `streamText` with tools for drafting and the assistant.
- **Provider:** `@ai-sdk/anthropic`, model `claude-sonnet-5-5`, the key passed explicitly from `ANTHROPIC_KEY`. The model id is configurable (`AI_MODEL`, default `claude-sonnet-5-5`).
- **One switch.** AI is on only when `ANTHROPIC_KEY` is set ([env.ts](../../apps/api/src/env.ts)). Without it, every AI route returns 404, `/api/me` (or a capabilities endpoint) reports AI as off, and the app hides every AI control. No AI code path runs without the key.
- **App side:** `@ai-sdk/react` (`useChat`) for the assistant's streaming chat UI, talking to our API; the browser never holds a provider key.
- **One module** in the API owns the model instance and the on/off check, so adding another provider later (Bedrock, Vertex, Azure) is a config change there.

## Alternatives considered

- **`@anthropic-ai/sdk` directly** (ADR 0018). The thinnest path to Claude and first to get new API features, but no provider switching and no ready-made streaming chat or tool-call UI plumbing.
- **LangChain.** Much larger surface than we need.

## Consequences

- Swapping or adding providers is configuration in one module.
- New Anthropic API features reach us when `@ai-sdk/anthropic` supports them, which can lag the direct SDK.
- Tool-calling and streaming code is shared by drafting and the assistant.
- Per-user quotas and usage tracking are still open (see [ADR 0018](0018-claude-api-for-ai-field-detection-and-drafting.md)).
