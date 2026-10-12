---
title: Personal data masking and erasure
description: Mark fields sensitive so their values are masked in logs and audit history, tag generations with a data subject, and erase everything stored about a person.
sidebar:
  order: 12
---

Generated documents contain personal data, so the stored inputs, the PDFs and anything you export keep it whole. Everywhere else necodoc keeps it out of sight, and admins can erase it on request.

## Sensitive fields

Each field in the field designer has a **Sensitive** setting: on, off or automatic. Automatic treats signatures, and fields whose keys look like a SIN/SSN, tax id, passport, birth date, bank account, IBAN or card number, as sensitive.

| Where | What you see |
| --- | --- |
| Logs and traces | Never any field values, sensitive or not. Render errors log the input as `[masked]`. |
| Audit log | Sensitive values masked in template sample data, share-link prefills and test cases. |
| Generation log | The owner sees values whole; an admin opening someone else's entry sees sensitive values masked. |
| PDFs, downloads, signing packages, webhooks, stored inputs | Whole. |

## Tag generations with a subject

Render and generate calls take an optional `subject`: whoever the document is about, such as an email or a customer number. Send it from the API so erasure finds the generation even when the person's details are buried in HTML:

```sh
curl https://necodoc.example.com/api/v1/templates/$TEMPLATE_ID/versions/latest/generate \
  -H "x-api-key: $NECODOC_API_KEY" -H "content-type: application/json" \
  -d '{ "data": { "client_name": "Ada Lovelace" }, "subject": "ada@example.com" }'
```

Share-link submissions use the respondent's email. The generation log shows the subject.

## Erase a data subject

Admins open **Admin > Data subjects** and search by a subject key or any value (an email, a name, an id). Matches are exact and case-insensitive against subject keys, stored generation data and signers, and submission answers and respondent emails. Untick false positives, then erase.

Erasing deletes the generations (input, PDF and stored file), packets built from them, their webhook delivery logs and download-link records, and the submissions and share-link responses. The erasure report lists every id deleted, and any stored file the storage driver couldn't remove; download it as JSON for your records. The audit log records the erasure with counts only, never the search term.

## Limitations

- The audit log is append-only and logs you've shipped elsewhere are out of necodoc's hands; neither can be erased.
- Entries written before this feature aren't masked retroactively.
- Exact matching misses misspellings and values inside longer text; send `subject`.
- Template sample data, share-link prefills and test cases aren't searched or erased.
- Erasure is a hard delete: analytics counts and batch progress drop with it.
- People who are app users are removed through user management, not this tool.
