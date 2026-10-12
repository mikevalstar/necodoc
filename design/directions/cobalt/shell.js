// Cobalt shell: brand-coloured sidebar with the cat-ear active tab. shell(section, sub, crumbs)
const MARK = (ink = "currentColor", acc = "var(--sun)") => `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="${ink}" fill-rule="evenodd" d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"/><path fill="${acc}" d="M36 47H40V53H36Z"/></svg>`;
const NAV = [
  ["Home", "house", []],
  ["Documents", "files", ["My documents", "Share links"]],
  ["Templates", "layout", ["Templates", "Reviews", "Snippets", "Themes", "Assets"]],
  ["Developers", "brackets-curly", ["API reference", "API keys", "Render playground", "Generations", "Batches"]],
  ["Admin", "shield-check", ["Users", "Queue", "Analytics", "Audit log", "System"]],
];
const COUNTS = { Templates: "8", Documents: "24", Admin: "" };
function shell(section, sub, crumbs, opts = {}) {
  const nav = NAV.map(([l, ic, subs]) => `<a href="#" class="${l === section ? "on ears" : ""}" ${l === section && !sub ? 'aria-current="page"' : ""}><i class="ph-duotone ph-${ic}"></i>${l}${COUNTS[l] ? `<span class="c">${COUNTS[l]}</span>` : ""}</a>` +
    (l === section && subs.length ? `<div class="sub">${subs.map(s => `<a href="#" class="${s === sub ? "on2" : ""}" ${s === sub ? 'aria-current="page"' : ""}>${s}</a>`).join("")}</div>` : "")).join("");
  const page = document.getElementById("page");
  const app = document.createElement("div");
  app.className = "app" + (opts.collapsed ? " collapsed" : "");
  app.innerHTML = `
  <nav class="side" aria-label="Sections">
    <div class="logo">${MARK("#fff")}<span class="lt">necodoc</span></div>
    <div class="ws"><span class="ini">HS</span><div class="lt">Harbour Surety<small>Self-hosted · prod</small></div></div>
    ${nav}
    <div class="me"><span class="av">MV</span><div class="lt">Mike Valstar<small>Admin</small></div><button onclick="toggleTheme()" aria-label="Toggle theme"><i class="ph-duotone ph-moon-stars"></i></button></div>
  </nav>
  <div class="main">
    <header class="topbar"><div class="crumbs">${crumbs}</div>
      <div class="search"><i class="ph ph-magnifying-glass"></i>Search or jump to…<span class="k">⌘K</span></div>
      <button class="ib" aria-label="Help"><i class="ph-duotone ph-question"></i></button>
      <button class="ib" aria-label="Notifications, 7 unread"><i class="ph-duotone ph-bell"></i><span class="dot"></span></button>
    </header>
  </div>`;
  page.replaceWith(app);
  app.querySelector(".main").appendChild(page);
}
