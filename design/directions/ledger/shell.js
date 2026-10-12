// Ledger shell: table-of-contents sidebar + masthead. Pages call shell("<active label>", "<crumb html>").
const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"/><path fill="var(--brand)" d="M36 47H40V53H36Z"/></svg>`;
const SECTIONS = [
  ["Documents", [["My documents", ""], ["Share links", "3"]]],
  ["Templates", [["Templates", "8"], ["Reviews", "2"], ["Snippets", ""], ["Themes", ""], ["Assets", ""]]],
  ["Developers", [["API reference", ""], ["API keys", ""], ["Render playground", ""], ["Generations", ""], ["Batches", ""]]],
  ["Admin", [["Users", ""], ["Queue", "37"], ["Analytics", ""], ["Audit log", ""], ["System", ""]]],
];
const RAIL = [["Documents","file-text"],["Templates","layout-template"],["Developers","terminal"],["Admin","shield"]];
function shell(active, crumb, opts = {}) {
  const toc = SECTIONS.map(([s, items], i) => `<h6><span>0${i + 1}</span>${s}</h6>` + items.map(([l, n]) =>
    `<a href="#" class="${l === active ? "on" : ""}" ${l === active ? 'aria-current="page"' : ""}>${l}<span class="leader"></span><span class="n">${n}</span></a>`).join("")).join("");
  const main = document.getElementById("page");
  const app = document.createElement("div");
  app.className = "app" + (opts.rail ? " railed" : "");
  app.innerHTML = `
  ${true ? `<nav class="rail" aria-label="Sections"><span class="rail-mark">${MARK}</span>${RAIL.map(([l, i]) => `<a href="#" class="${l === (opts.rail || SECTIONS.find(([, it]) => it.some(([x]) => x === active))?.[0]) ? "on" : ""}" aria-label="${l}" title="${l}"><i data-lucide="${i}"></i></a>`).join("")}<span style="flex:1"></span><button class="iconbtn" onclick="toggleTheme()" aria-label="Toggle theme"><i data-lucide="moon"></i></button><span class="avatar">MV</span></nav>` : ""}
  <nav class="toc" aria-label="Sections" ${opts.rail ? "hidden" : ""}>
    <div class="brand">${MARK}<div><b>necodoc</b><small>Harbour Surety Group</small></div></div>
    ${toc}
    <div class="foot"><span class="avatar">MV</span><div class="who">Mike Valstar<small>Administrator</small></div>
      <button class="iconbtn" style="margin-left:auto" onclick="toggleTheme()" aria-label="Toggle theme"><i data-lucide="moon"></i></button></div>
  </nav>
  <div class="main">
    <header class="masthead">
      <div class="crumb">${crumb}</div>
      <div class="search"><i data-lucide="search"></i>Search templates, files, people<span class="kbd">⌘K</span></div>
      <button class="iconbtn" aria-label="Help"><i data-lucide="circle-help"></i></button>
      <button class="iconbtn" aria-label="Notifications, 7 unread"><i data-lucide="bell"></i><span class="dot"></span></button>
    </header>
  </div>`;
  main.replaceWith(app);
  app.querySelector(".main").appendChild(main);
  lucide.createIcons({ attrs: { "stroke-width": 1.25 } });
}
