---
type: adr
title: Record architecture decisions
description: Use ADRs to capture significant, hard-to-reverse decisions.
tags: [process]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:49:34Z }
---

# Record architecture decisions

## Status

Accepted.

## Context

We need to record the architectural decisions made on this project — the
significant, hard-to-reverse ones — so the reasoning survives turnover and time.

## Decision

We will use Architecture Decision Records, as [described by Michael
Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each record is one Markdown file in `adrs/`, numbered, with Status / Context /
Decision / Consequences.

## Consequences

The rationale behind decisions is preserved and queryable
(`okq find --type adr`). One lightweight step is added when making a
significant decision.
