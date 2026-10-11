# Surety bond fixtures

Public US state and municipal surety bond forms, the kind insurers fill in for
principals. Test inputs for [PDF overlay templates](../../../docs/features/pdf-overlay-templates.md)
and AI field detection. Downloaded 2026-10-11 from the publishers' sites;
re-download from the source if a form needs to be current.

| File | Publisher | Pages | AcroForm fields | Notes |
|---|---|---|---|---|
| `or-ccb-commercial-contractor-bond.pdf` | [Oregon CCB](https://www.Oregon.Gov/ccb/Documents/Surety%20Bond_Commercial.pdf) | 2 | 15 | |
| `phoenix-az-permit-bond.pdf` | [City of Phoenix](https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00452.pdf) | 1 | 35 | |
| `ct-dmv-k158-dealer-bond.pdf` | [Connecticut DMV](https://portal.ct.gov/dmv/-/media/dmv/20/29/k158pdf.pdf) | 1 | 3 | |
| `castle-pines-co-row-permit-bond.pdf` | [Castle Pines, CO](https://www.castlepinesco.gov/wp-content/uploads/2026/04/ROW-Permit-Bond-Form.pdf) | 3 | 0 | |
| `moraine-oh-row-bond.pdf` | [Moraine, OH](https://ci.moraine.oh.us/pdf/Engineering/ROW%20Bond%20Form.pdf) | 2 | 0 | |
| `new-haven-in-row-bond.pdf` | [New Haven, IN](https://www.newhaven.in.gov/DocumentCenter/View/112/Right-of-Way-Bond-PDF) | 1 | 0 | |
| `rockville-md-row-performance-bond-llc.pdf` | [Rockville, MD](https://www.rockvillemd.gov/wp-content/uploads/2026/02/Performance-Bond-LLC-Public-ROW.pdf) | 3 | 0 | |
| `ny-dmv-vs3-dealer-bond.pdf` | [New York DMV](https://dmv.ny.gov/forms/vs3.pdf) | 1 | 17 | encrypted |
| `ca-dmv-ol25b-motorcycle-dealer-bond.pdf` | [California DMV](https://www.dmv.ca.gov/portal/uploads/2020/04/ol25b.pdf) | 2 | 17 | encrypted |
| `sc-dmv-dla1b-dealer-bond.pdf` | [South Carolina DMV](https://www.dmv.sc.gov/sites/scdmv/files/2026-01/DLA-1B%20and%201B%20IS.pdf) | 2 | 12 | encrypted |
| `university-place-wa-street-use-bond.pdf` | [University Place, WA](https://www.cityofup.com/DocumentCenter/View/285/Street-Use-Bond-PDF) | 2 | 27 | encrypted |

"encrypted" means the file is encrypted with an empty user password: viewers
open it silently, but stock `@cantoo/pdf-lib` with `ignoreEncryption` reads
ciphertext object streams and loses the page tree (`Expected instance of
PDFDict`). Loading with `{ password: '' }` plus our patch to the library's
decrypt path fixes it. Every fixture must upload, preview and fill.
