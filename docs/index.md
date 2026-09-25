---
okf_version: "0.2"
---

# necodoc docs

An [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
(OKF) bundle ([local copy of the spec](external/okf-spec-0.2.md)): Markdown +
YAML frontmatter, one concept per file. Query it with okq:

    okq --bundle docs find --type adr
    okq --bundle docs search "<topic>"
    okq --bundle docs stats

Folders: `adrs/` (decisions), `features/` (specs), `external/` (verbatim
snapshots of specs owned elsewhere).

<!-- okq:index:begin -->
### Folders

- [adrs/](adrs/)
- [external/](external/)
- [features/](features/)

### Concepts

| Title | File |
|-------|------|
| Knowledge base | [README.md](README.md) |
<!-- okq:index:end -->
