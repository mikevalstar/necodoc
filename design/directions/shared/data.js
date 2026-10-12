// Shared mock content for the three direction mockups. Realistic necodoc data.
window.NECO = {
  user: { name: "Mike Valstar", initials: "MV", role: "Admin" },
  org: "Harbour Surety Group",
  templates: [
    { name: "Oregon Contractor License Bond", desc: "Filed with the Construction Contractors Board (CCB)", kind: "Designed", status: "published", version: 4, changes: false, fields: 18, pages: 2, uses: 1284, edited: "12 min ago", by: "Priya N." },
    { name: "NY DMV VS-3 Dealer Bond", desc: "Motor vehicle dealer surety, overlay on DMV form", kind: "PDF overlay", status: "published", version: 2, changes: true, fields: 24, pages: 1, uses: 642, edited: "1 h ago", by: "Mike V." },
    { name: "Castle Pines ROW Permit Bond", desc: "Right-of-way permit, City of Castle Pines, CO", kind: "PDF overlay", status: "review", version: 1, changes: true, fields: 11, pages: 1, uses: 0, edited: "3 h ago", by: "Dana K." },
    { name: "New Haven In-ROW Bond", desc: "Excavation in public right-of-way, New Haven, CT", kind: "Designed", status: "draft", version: 0, changes: true, fields: 9, pages: 2, uses: 0, edited: "5 h ago", by: "Priya N." },
    { name: "Notary Public Bond — Texas", desc: "Four-year notary bond, $10,000 penal sum", kind: "Designed", status: "published", version: 7, changes: false, fields: 12, pages: 1, uses: 3410, edited: "2 d ago", by: "Luis A." },
    { name: "Power of Attorney — Surety", desc: "Attorney-in-fact appointment with seal", kind: "Designed", status: "published", version: 3, changes: false, fields: 7, pages: 1, uses: 2215, edited: "4 d ago", by: "Mike V." },
    { name: "Commercial Quote Letter", desc: "Premium quote with rate table and conditions", kind: "Designed", status: "published", version: 5, changes: true, fields: 21, pages: 3, uses: 918, edited: "6 d ago", by: "Dana K." },
    { name: "Indemnity Agreement — General", desc: "General indemnity, principal and indemnitors", kind: "Designed", status: "archived", version: 2, changes: false, fields: 30, pages: 6, uses: 77, edited: "3 wk ago", by: "Luis A." },
  ],
  generations: [
    { id: "gen_8f3a1c", at: "10:42:29.114", template: "Notary Public Bond — Texas", file: "TX-NP-2026-04187.pdf", source: "API", key: "prod-portal", status: "success", queue: 0.04, render: 0.61, pages: 1, size: "84 KB" },
    { id: "gen_8f3a1b", at: "10:42:28.902", template: "Oregon Contractor License Bond", file: "OR-CCB-238114.pdf", source: "API", key: "prod-portal", status: "success", queue: 0.05, render: 1.12, pages: 2, size: "142 KB" },
    { id: "gen_8f3a19", at: "10:42:27.440", template: "NY DMV VS-3 Dealer Bond", file: "VS3-Hudson-Motors.pdf", source: "Batch", key: "—", status: "success", queue: 2.31, render: 0.88, pages: 1, size: "211 KB" },
    { id: "gen_8f3a17", at: "10:42:25.006", template: "Commercial Quote Letter", file: "Quote-Brightline-Q4.pdf", source: "Form", key: "—", status: "slow", queue: 0.12, render: 6.94, pages: 3, size: "396 KB" },
    { id: "gen_8f3a16", at: "10:42:21.780", template: "Power of Attorney — Surety", file: "POA-RJ-Tanaka.pdf", source: "API", key: "agency-sync", status: "success", queue: 0.03, render: 0.47, pages: 1, size: "58 KB" },
    { id: "gen_8f3a12", at: "10:42:19.231", template: "NY DMV VS-3 Dealer Bond", file: "VS3-Empire-Auto.pdf", source: "Batch", key: "—", status: "failed", queue: 2.40, render: null, pages: null, size: "—", error: "Field dealer_facility_no is required" },
    { id: "gen_8f3a0e", at: "10:42:12.665", template: "Oregon Contractor License Bond", file: "OR-CCB-238109.pdf", source: "API", key: "prod-portal", status: "success", queue: 0.06, render: 1.04, pages: 2, size: "139 KB" },
    { id: "gen_8f3a0b", at: "10:41:58.090", template: "Notary Public Bond — Texas", file: "TX-NP-2026-04186.pdf", source: "API", key: "prod-portal", status: "success", queue: 0.04, render: 0.58, pages: 1, size: "83 KB" },
    { id: "gen_8f3a07", at: "10:41:44.512", template: "Indemnity Agreement — General", file: "GIA-Northgate-Builders.pdf", source: "Form", key: "—", status: "success", queue: 0.09, render: 3.86, pages: 6, size: "612 KB" },
    { id: "gen_8f3a03", at: "10:41:30.377", template: "Commercial Quote Letter", file: "Quote-Ridgeway-Q4.pdf", source: "API", key: "agency-sync", status: "running", queue: 0.10, render: null, pages: null, size: "—" },
    { id: "gen_8f39fe", at: "10:41:12.948", template: "Power of Attorney — Surety", file: "POA-LM-Okafor.pdf", source: "API", key: "agency-sync", status: "success", queue: 0.03, render: 0.52, pages: 1, size: "57 KB" },
    { id: "gen_8f39fa", at: "10:40:59.201", template: "Oregon Contractor License Bond", file: "OR-CCB-238102.pdf", source: "API", key: "prod-portal", status: "success", queue: 0.05, render: 1.21, pages: 2, size: "145 KB" },
    { id: "gen_8f39f4", at: "10:40:41.633", template: "NY DMV VS-3 Dealer Bond", file: "VS3-Lakeside-Cars.pdf", source: "Batch", key: "—", status: "success", queue: 2.18, render: 0.91, pages: 1, size: "209 KB" },
    { id: "gen_8f39ef", at: "10:40:20.010", template: "Notary Public Bond — Texas", file: "TX-NP-2026-04185.pdf", source: "Share link", key: "—", status: "success", queue: 0.05, render: 0.63, pages: 1, size: "84 KB" },
  ],
  queue: { rendersToday: 4812, p95: 2.4, p50: 0.71, failed: 0.6, depth: 37, workers: "6 / 8", spark: [22,31,28,40,36,52,61,58,49,66,72,64,80,77,69,88,92,85,71,79,94,101,96,88] },
  activity: [
    { who: "Priya N.", what: "published", obj: "Oregon Contractor License Bond", meta: "v4", when: "12 min" },
    { who: "Batch #219", what: "finished", obj: "412 VS-3 dealer bonds", meta: "3 failed", when: "26 min" },
    { who: "Dana K.", what: "requested review on", obj: "Castle Pines ROW Permit Bond", meta: "2 comments", when: "3 h" },
    { who: "agency-sync", what: "API key rotated by", obj: "Luis A.", meta: "", when: "5 h" },
    { who: "Mike V.", what: "filled", obj: "Power of Attorney — RJ Tanaka", meta: "PDF", when: "yesterday" },
  ],
  checklist: [
    { title: "Design a template", desc: "Lay out a certificate, quote or letter and the questions it asks.", done: true },
    { title: "Upload a PDF form", desc: "Already have the form as a PDF? Place fields on it instead.", done: true },
    { title: "Publish a template", desc: "Publishing makes a version others can fill in and the API can use.", done: false },
    { title: "Fill in your first document", desc: "Answer a template's questions and download the finished PDF.", done: false },
  ],
  editorTabs: ["Content", "Header & footer", "Fields", "Sample data", "Signing", "Output", "Translations", "Page & theme", "CSS", "Tests", "Versions"],
};
// ?theme=dark → html.dark (each mockup also has an in-page toggle)
(function () {
  const p = new URLSearchParams(location.search);
  if (p.get("theme") === "dark") document.documentElement.classList.add("dark");
  window.toggleTheme = () => document.documentElement.classList.toggle("dark");
})();
window.fmtS = (s) => (s == null ? "—" : s.toFixed(2) + " s");

// The rendered PDF page (the user's document) is the same in every direction; only its framing differs.
window.NECO.bondPage = `
<div class="pdf-page">
  <div class="pdf-head">
    <div class="pdf-seal">HSC</div>
    <div>
      <div class="pdf-org">Harbour Surety Company</div>
      <div class="pdf-sub">1200 SW Naito Pkwy, Portland, OR 97201 · NAIC 31194</div>
    </div>
    <div class="pdf-no">Bond No.<br><b>HSC-OR-238114</b></div>
  </div>
  <h1 class="pdf-title">Contractor License Bond</h1>
  <div class="pdf-kicker">State of Oregon · Construction Contractors Board · ORS 701.068</div>
  <p><b>KNOW ALL PERSONS BY THESE PRESENTS</b>, that we, <u>Northgate Builders LLC</u>, of <u>Bend, Oregon</u>, as Principal, CCB License No. <u>238114</u>, and <u>Harbour Surety Company</u>, a corporation authorized to transact surety business in the State of Oregon, as Surety, are held and firmly bound unto the State of Oregon in the penal sum of <u>Twenty-Five Thousand Dollars ($25,000.00)</u> for the use and benefit of any person, firm or corporation having a claim against the Principal as provided in ORS 701.140.</p>
  <p><b>THE CONDITION OF THIS OBLIGATION</b> is such that the Principal has applied to the Construction Contractors Board for a license as a <u>Residential General Contractor</u> and shall comply with ORS Chapter 701 and the rules adopted thereunder.</p>
  <p>This bond shall be effective from <u>October 12, 2026</u> and shall continue in force until cancelled by the Surety upon thirty (30) days' written notice to the Board.</p>
  <div class="pdf-sigs">
    <div><div class="pdf-sigline"><span class="pdf-sig">R. J. Tanaka</span></div>Principal — Northgate Builders LLC</div>
    <div><div class="pdf-sigline"><span class="pdf-sig">L. Okafor</span></div>Attorney-in-fact — Harbour Surety Co.</div>
  </div>
  <div class="pdf-foot"><span>CCB Form 701-B (rev. 2024)</span><span>Page 1 of 2</span></div>
</div>`;
