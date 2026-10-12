# Copy pass (W6b, NECO-ijpejxan)

A pass over every page, the reel captions and the review pack, so the copy reads like a person
wrote it. Guide: ASD-STE100 loosely (one idea per sentence, active voice, common verbs, one word
per meaning), stricter on Architecture and Security. Claims stay inside the
[Marketing site](../../docs/features/marketing-site.md) defendable list. Notable changes only.

## Patterns removed

- Slogan headlines and punchlines: "Month-end is a replica count.", "No badges we haven't
  earned.", "Run it, and answer for it.", "These gaps are real. If one of them decides it for
  you, it should."
- "X, not Y" and "because there isn't one" closers, where the contrast added nothing.
- Semicolon chains and fragments in body copy, split into sentences with a subject and a verb.
- Passive voice with a hidden actor ("is logged", "is audited", "are created") turned active.
- Signposting ("This page is the reference for…", "answered here", "walks through").
- Disclaimers readers already understand ("example, not a connector", "We don't claim unlimited
  workers" beside a limit that already says so).
- Jargon and idiom: "minting" a link, "plugs into", "rewrite history", "where its time went".
- One term per meaning: "audit log" (not "audit trail"), "worker process", "signing".

## Home

| Before | After |
|---|---|
| What it does differently. | Existing forms, month-end volume and insurance documents. |
| Month-end is a few more workers. | Add workers for month-end. Remove them after. |
| Renders run as queued jobs on worker processes. Month-end is a replica count, and every render records where its time went. | Each render is a job in a queue, and worker processes take jobs from it. For month-end, raise the worker replica count. Each render records how long each step took. |
| One drawing your review board can check line by line. | What runs, and where the data lives. |
| No third party holds your data, because there isn't one. | necodoc isn't a hosted service, so no vendor holds your data. |
| With AI off, which is the default, nothing leaves. | AI is off by default. With AI off, nothing leaves except the webhooks you configure. |
| What it doesn't do, so you don't find out in month three. | What necodoc doesn't do. |
| MIT-licensed. Fork it, audit it, add a storage driver. | MIT licence. Read the code your review needs, or fork it and add a storage driver. |
| Hero rotor: "government forms", "teams stuck with old PDF forms" | "government agencies", "teams still filling PDFs by hand" |

## Insurance

| Before | After |
|---|---|
| Two templates means two copies that drift. necodoc keeps one. | With two templates, the French and English copies drift apart. necodoc uses one template with a translation per language. |
| Progress, cancel, invalid rows fail alone; download one ZIP or one combined packet. | Watch progress or cancel the run. An invalid row fails alone. Download one ZIP or one combined packet. |

## Architecture

| Before | After |
|---|---|
| …in a Postgres and a bucket you already operate. This page is the reference for your architecture review. | All durable state is in a Postgres database and a bucket that you operate. |
| Everything necodoc runs can be killed and replaced. | You can stop and replace any necodoc process. |
| No packaged connector. A versioned REST API described by OpenAPI 3.1, a JSON Schema per template version, and generated SDKs… | There is no packaged connector. Your systems call a versioned REST API, described by OpenAPI 3.1. Each template version has a JSON Schema. … |
| Everything stays in your account except what you send out on purpose. AI is the only third party… | Data stays in your account unless you configure it to go out. The only third party is Anthropic, for the AI features… |
| Stated here so your review doesn't have to find them. | What it doesn't do yet. |

## Security and governance

| Before | After |
|---|---|
| The table your security reviewer copies into the questionnaire. | Every control, and the spec that defines it. |
| Together they answer the auditor's question without a spreadsheet. | (cut) |
| Streamed through signed, expiring links. Minting a link is audited. | Files download through signed links that expire. The audit log records each link that is issued. |
| Roles add up; each grants one job. | A user can hold several roles, and each role grants one kind of work. |
| No badges we haven't earned. | Attestations and claims we don't make. |

## Performance, Product, Compare, Open source

| Before | After |
|---|---|
| The benchmark tells you what to expect. The generation log tells you what happened: … | In production, the generation log records the queue wait, run time and a per-step breakdown for every PDF. |
| Our documents, not yours. / Cold start is a process, not a machine. | The test documents are ours. / Cold start means a new process. |
| A rich-text editor for the forms team, code mode for developers, one renderer behind both. | The forms team uses a rich-text editor, and developers can switch to code mode. The live preview uses the production renderer… |
| Files that hold up in an archive, a screen reader and Québec. | Archival, accessible and bilingual PDFs. |
| The business owns the wording. Nothing goes live unreviewed. | The business owns the wording. Your systems own the fields. ("Nothing goes live unreviewed" is only true with the review gate on.) |
| Most changes are configuration. The rest is the source. | Extend it with settings, or with code. |

## Reel captions ([timeline.ts](../../apps/reel/src/timeline.ts))

| Before | After |
|---|---|
| Or call it from your policy system: HTML and data in, PDF out. | Your policy system can also post HTML and data to the API and get the PDF back. |
| Every change and sign-in lands in an audit log that can't be edited. | Every change and sign-in goes into an append-only audit log. ("Can't be edited" overstated tamper resistance.) |
| Add workers to go faster: … | More workers, more throughput: … |

## Review pack ([pack.md](../../scripts/review-pack/pack.md))

Already close to the guide. Fragments split ("Health and readiness endpoints on every process;
readiness fails without…"), passives made active, the "so your review doesn't have to find
them" closer cut.

## Left as is, on purpose

- "Tamper-resistant, not tamper-evident", "E-signature ready", "We describe controls, not
  attestations": the contrast is the legal point.
- The six home Q&A titles are questions because they quote the reviewer.
- "Example:" labels on worked examples: the spec requires them.
- The demo line ("A shared public demo. It resets every night at midnight Eastern.") is fixed by
  the spec.
- Headlines that already name concrete things ("Bonds on the obligee's own form.").
