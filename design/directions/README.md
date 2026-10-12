# Design directions (NECO-vzhaxewp)

Three directions to replace the stock shadcn look. Each folder has four static mockups
(`home`, `templates`, `editor`, `generations`). Open any page with `?theme=dark` for dark
mode. Screenshots are in `<slug>/shots/`: 1440×900 light and dark for every screen, plus
820-wide tablet shots of home and generations. All pages share the same content
([shared/data.js](shared/data.js)) and the same rendered PDF ([shared/paper.css](shared/paper.css)),
so only the design system changes between them. Every text/background pair listed below
passes WCAG AA (4.5:1 or better), and every direction has a visible `:focus-visible` ring.

## A. Ledger: paper and ink (`ledger/`)

The product makes legal documents, so the app looks like the desk they're made on: warm
paper, black ink, ruled ledgers, rubber stamps. Pages open like a document, with an eyebrow,
a serif title and a double rule. Tables are ruled ledgers with italic serif column labels.
Statuses are outlined stamps ("FILED", "IN REVIEW"). The PDF is the only thing that sits
above the page: a real sheet on a darker desk, with crop marks and a folio line. It reads as
calm and authoritative, and it looks like no other SaaS tool.

| Token | Value |
|---|---|
| Fonts | Newsreader (display, italic labels), Instrument Sans (UI), DM Mono (IDs, numbers) |
| Neutrals light | paper `#f4f1ea`, sheet `#fbfaf6`, desk `#e8e3d6`, ink `#1c1b18`, ink-2 `#4f4b42`, ink-3 `#6b665b`, rule `#d8d1c1` |
| Neutrals dark ("carbon") | paper `#171612`, sheet `#1f1e19`, ink `#ede8dc`, ink-3 `#9d9686`, rule `#34312a`. The PDF stays white. |
| Accent | brand `#2f6bff` (mark, focus, active marker), link `#1f4fd1` / `#8fadff`, stamp red `#b03a2e` (assistant, attention) |
| Semantic | ok `#2e6a3b`, warn `#8a5d00`, bad `#b03a2e`, running `#1f4fd1` (dark: `#8cc49a` `#e0b45a` `#ec8b7a` `#8fadff`) |
| Radius | 2px everywhere; avatars round |
| Depth | hairline rules and double rules, no card borders. The only shadow is the paper lift: `0 1px 0 rgba(60,45,20,.08), 0 18px 30px -18px rgba(60,45,20,.35)` |
| Density | rows 44–52px, table numerals in mono |
| Icons | Lucide at 1.25 stroke, used sparingly |

**Signature details:** a table-of-contents sidebar (numbered sections, leader dots to the
counts); fields in the editor drawn as fill-in blanks with small-caps labels; conditions
shown as red margin notes; stamp badges; generation rows grouped under day headings.

**Trade-offs:** medium cost. It's mostly tokens plus three new components (Stamp badge,
ledger table variant, proof desk), and Base UI primitives stay as they are. The
underline-only filter inputs give a weaker affordance than boxed inputs, so keep boxed
inputs in guided forms. The serif can read as "law firm", which is the intent for surety
and legal buyers but less so for developers. The tablet layout collapses to an icon rail.

## B. Drafting: precise console (`drafting/`)

Dark-first and built for people who spend all day in tables: ops, developers, high-volume
publishers. The UI is cyanotype blue-black and IBM Plex. Every number is mono, rows are
32px, statuses are LED squares with mono codes, and the shell has an IDE-style status bar
showing live queue, workers, p95 and versions. The PDF preview sits on a blueprint grid
with inch rulers, margin guides and a coordinate readout for the selected field. The same
tool can then place overlay boxes on uploaded PDFs.

| Token | Value |
|---|---|
| Fonts | IBM Plex Sans (UI), IBM Plex Mono (data, labels, codes) |
| Neutrals dark | bg `#0a111e`, panel `#0e1727`, raised `#132036`, line `#1f2d45`, fg `#dbe5f5`, fg-3 `#7d8fae` |
| Neutrals light ("drafting film") | bg `#f2f5fa`, panel `#ffffff`, line `#d3dce9`, fg `#0e1a2e`, fg-3 `#5d6d88` |
| Accent | brand `#2f6bff` / `#5b8cff`, brand text `#2257e0` / `#8cb0ff`, grid `rgba(47,107,255,.07–.14)` |
| Semantic | ok `#0d7a4b` (dot `#12a866`), warn `#9a5b00` (dot `#e59a1a`), bad `#c42b2b` (dot `#e5484d`); dark text `#43d394` `#ffbd5a` `#ff7b7b` |
| Radius | 3px controls, 2px tags |
| Depth | 1px lines only, no shadows. Panels are separated by fill steps. |
| Density | 28px controls, 32px rows, 13px base text |
| Icons | Lucide at 1.75 stroke, 15px |

**Signature details:** the blueprint preview with rulers and field hit-boxes; the status
bar; a section tree with saved views; a token query bar plus a render-time histogram on
Generations; keyboard hints throughout (⌘K, j/k, ⌘↵).

**Trade-offs:** lowest cost, because it stays closest to shadcn's structure (mostly tokens,
`size="sm"` defaults, a status bar, the tree). It is the best fit for admins and API users.
The risk is that non-technical publishers and form fillers find it cold or developer-only.
Mono uppercase labels work at this size, but don't push them smaller than 10.5px.

## C. Cobalt: product brand (`cobalt/`)

A confident, warm brand built from the neko mark. The sidebar is solid cobalt. The active
item is a white tab wearing the mark's ears, and the PDF preview sits in a cobalt tray with
the same ears, so the document literally becomes the cat. Surfaces are soft white cards on
lavender, with pills instead of borders and marigold for the "do this next" moment. It is
the most approachable of the three and suits a self-serve audience and the marketing site.

| Token | Value |
|---|---|
| Fonts | Bricolage Grotesque (display, numbers), Figtree (UI), Fragment Mono (IDs) |
| Neutrals light | canvas `#f2f3fa`, surface `#ffffff`, tint `#eceefb`, ink `#0c1233`, ink-2 `#3f4668`, ink-3 `#5b6285`, hair `#e3e5f2` |
| Neutrals dark | canvas `#0a0d22`, surface `#121834`, tint `#19204a`, ink `#eef0ff`, ink-3 `#959cc4` |
| Brand | cobalt `#2f6bff` / `#5b8cff`, shell `#1430a6 → #0f2585` (dark `#0e1544`), marigold `#ffc53d` (with `#3a2900` text; also the focus ring) |
| Semantic | pills on washes: ok `#0b7a52/#dcf5e9`, warn `#8a5600/#fff0cc`, bad `#c92a32/#fde4e4`, run `#1f50e0/#e7eeff` |
| Radius | 16px cards, 10px controls, pills fully round |
| Depth | shadows instead of borders: `0 1px 2px rgba(12,18,51,.06), 0 10px 30px -14px rgba(12,18,51,.22)` |
| Density | 40px controls, 46–52px rows, with a compact toggle on tables |
| Icons | Phosphor duotone (replaces Lucide) |

**Signature details:** cat-ear tabs on the active nav item and on template thumbnails; the
ear-shaped preview tray; marigold "next step" highlights; an assistant toast inline in the
editor; a gallery view of templates.

**Trade-offs:** highest cost. It needs the shadow system, clip-path ears, a collapsible
shell, a Phosphor swap, and restyling of most shadcn components. It is the least dense, so
the compact mode has to be a real feature. White on `#2f6bff` is exactly 4.5:1, so primary
button text must stay at 14px or larger and semibold or heavier. There's a risk of looking
playful to enterprise buyers if the ears spread beyond those two uses.

## Recommendation

**Go with Ledger (A).** It is the only one of the three that makes necodoc look like a
document product, the paper is a signature nobody else in this space owns, and it costs
less than Cobalt. Borrow two things from Drafting: the status bar for admins, and the
token query bar with the render histogram on Generations, which Ledger's prose filters
don't do as well. If the main audience turns out to be developers and ops rather than
publishers, Drafting is the safe, cheap alternative. Keep Cobalt's ears for the marketing
site and the logo lockup, not the app.
