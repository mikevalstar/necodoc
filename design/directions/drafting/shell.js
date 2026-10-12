// Drafting shell: top bar + icon rail + section tree + status bar. shell(active, crumbs, { wide })
const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"/><path fill="var(--brand)" d="M36 47H40V53H36Z"/></svg>`;
const SECTIONS = {
  Documents: ["file-text", [["My documents", "24"], ["Share links", "3"]]],
  Templates: ["layout-template", [["Templates", "8"], ["Reviews", "2"], ["Snippets", "14"], ["Themes", "3"], ["Assets", "41"]]],
  Developers: ["square-terminal", [["API reference", ""], ["API keys", "4"], ["Render playground", ""], ["Generations", "12.4k"], ["Batches", "219"]]],
  Admin: ["shield-check", [["Users", "36"], ["Queue", "37"], ["Analytics", ""], ["Audit log", ""], ["System", ""]]],
};
const SAVED = { Developers: ["Failed · last 24 h", "Slow > 2 s", "prod-portal key"], Templates: ["Needs review", "PDF overlays"], Documents: ["Drafts"], Admin: ["Logins today"] };
function shell(active, crumbs, opts = {}) {
  const sec = Object.keys(SECTIONS).find(k => SECTIONS[k][1].some(([l]) => l === active)) || "Documents";
  const page = document.getElementById("page");
  const app = document.createElement("div");
  app.className = "app" + (opts.wide ? " wide" : "");
  app.innerHTML = `
  <header class="top">
    <a class="mark" href="#" aria-label="necodoc home">${MARK}</a>
    <span class="org">necodoc <span style="color:var(--fg-3);font-weight:400">/</span> Harbour Surety <span class="env">PROD</span></span>
    <span class="crumbs">${crumbs}</span>
    <div class="cmd"><i data-lucide="search"></i>Jump to, or run a command…<span class="k">⌘K</span></div>
    <button class="ib" aria-label="Help"><i data-lucide="circle-help"></i></button>
    <button class="ib" aria-label="Notifications, 7 unread"><i data-lucide="bell"></i><span class="badge">7</span></button>
    <button class="ib" onclick="toggleTheme()" aria-label="Toggle theme"><i data-lucide="sun-moon"></i></button>
    <span class="av">MV</span>
  </header>
  <nav class="rail" aria-label="Sections">${Object.entries(SECTIONS).map(([k, [ic]]) => `<a href="#" class="${k === sec ? "on" : ""}" aria-label="${k}" title="${k}"><i data-lucide="${ic}"></i></a>`).join("")}
    <span style="flex:1"></span><a href="#" aria-label="Settings"><i data-lucide="settings-2"></i></a></nav>
  <nav class="tree" aria-label="${sec}"><span class="lbl">${sec}</span>${SECTIONS[sec][1].map(([l, c]) => `<a href="#" class="${l === active ? "on" : ""}">${l}<span class="c">${c}</span></a>`).join("")}
    <hr><span class="lbl">Saved views</span><div class="saved">${(SAVED[sec] || []).map(v => `<a href="#">${v}</a>`).join("")}</div></nav>
  <div class="main"></div>
  <footer class="status" aria-label="System status">
    <span><span class="led ok"></span><b>connected</b></span><span>queue <b>37</b></span><span>workers <b>6/8</b></span><span>p95 <b>2.40 s</b></span><span>failed 1h <b>0.6%</b></span>
    <span class="r"><span>chromium <b>138.0</b></span><span>api <b>v1.18.2</b></span><span>12 Oct 2026 10:42 UTC</span></span>
  </footer>`;
  page.replaceWith(app);
  app.querySelector(".main").appendChild(page);
  lucide.createIcons({ attrs: { "stroke-width": 1.75 } });
}
