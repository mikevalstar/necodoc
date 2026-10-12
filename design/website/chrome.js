// Shared header and footer for the W3 mockups (the Astro build will use a layout instead).
// <body data-page="home"> marks the active nav item.
(() => {
  const page = document.body.dataset.page;
  const mark = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="M8 12.5A2 2 0 0 1 11.3 11L22 20H42L52.7 11A2 2 0 0 1 56 12.5V56A4 4 0 0 1 52 60H12A4 4 0 0 1 8 56ZM16 32V36H48V32ZM16 40V44H48V40ZM16 48V52H32V48Z"/><path fill="#ffc53d" d="M36 47H40V53H36Z"/></svg>`;
  const nav = [
    ["product", "Product", "product.html"],
    ["insurance", "Insurance", "insurance.html"],
    ["architecture", "Architecture", "architecture.html"],
    ["security", "Security & governance", "security.html"],
    ["performance", "Performance", "performance.html"],
    ["docs", "Docs", "#", true],
  ];
  const header = `
  <header class="top"><div class="wrap">
    <a class="logo" href="index.html" aria-label="necodoc home">${mark}necodoc</a>
    <nav class="nav" aria-label="Main">${nav
      .map(([id, label, href, ext]) => `<a href="${href}"${id === page ? ' class="on" aria-current="page"' : ""}>${label}${ext ? '<span class="ext"> ↗</span>' : ""}</a>`)
      .join("")}</nav>
    <div class="right">
      <a class="tlink" href="#" style="color:var(--night-fg-2);font-weight:500;font-size:15px"><i class="ph ph-github-logo" style="font-size:20px"></i></a>
      <span class="lang" role="group" aria-label="Language"><a class="on" href="#" lang="en" aria-current="true">EN</a><a href="#" lang="fr-CA" hreflang="fr-CA">FR</a></span>
      <a class="btn next sm" href="#run">Run it in 10 minutes</a>
      <button class="menu-btn" aria-label="Menu"><i class="ph ph-list"></i></button>
    </div>
  </div></header>`;
  const footer = `
  <footer><div class="wrap">
    <div class="cols">
      <div class="about"><a class="logo" href="index.html" style="color:#fff">${mark}necodoc</a>
        <p>Document generation for P&amp;C and surety carriers, run on your own infrastructure. MIT-licensed. We don't host it, so we never hold your data.</p></div>
      <div><h4>Product</h4><ul><li><a href="product.html">Overview</a></li><li><a href="product.html#overlay">PDF overlay</a></li><li><a href="product.html#api">HTML to PDF API</a></li><li><a href="performance.html">Performance</a></li><li><a href="#">Compare</a></li></ul></div>
      <div><h4>For carriers</h4><ul><li><a href="insurance.html#surety">Surety bonds</a></li><li><a href="insurance.html#coi">Certificates</a></li><li><a href="insurance.html#renewals">Renewal runs</a></li><li><a href="insurance.html#bilingual">Bilingual EN/FR</a></li></ul></div>
      <div><h4>Evaluate</h4><ul><li><a href="architecture.html">Architecture</a></li><li><a href="security.html">Security &amp; governance</a></li><li><a href="#">Architecture review pack (PDF)</a></li><li><a href="#">Known limitations</a></li></ul></div>
      <div><h4>Project</h4><ul><li><a href="#">Developer docs ↗</a></li><li><a href="#">Source on GitHub ↗</a></li><li><a href="#">Open source &amp; pricing</a></li><li><a href="#">Questions: GitHub Discussions</a></li></ul></div>
    </div>
    <div class="base"><span>MIT licence</span><span>Nothing phones home</span><span class="r">EN · <a href="#" lang="fr-CA">Français</a></span></div>
  </div></footer>`;
  document.body.insertAdjacentHTML("afterbegin", header);
  document.body.insertAdjacentHTML("beforeend", footer);
})();
