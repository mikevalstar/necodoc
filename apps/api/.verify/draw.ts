// Temporary verification helper (deleted after use): rasterises a PDF and draws package boxes,
// or a 36pt grid when no package is given.
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { renderPage } from "../src/detect/geometry";
import { openPdfjs } from "../src/render/pdfjs";

const [pdfPath, pkgPath, outPrefix] = process.argv.slice(2);
const SCALE = 2;
const pkg = pkgPath && pkgPath !== "-" ? JSON.parse(readFileSync(pkgPath, "utf8")) : null;
const doc = await openPdfjs(new Uint8Array(readFileSync(pdfPath)));
for (let n = 1; n <= doc.numPages; n++) {
  const page = await renderPage(await doc.getPage(n), SCALE);
  const c = createCanvas(page.width, page.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(page, 0, 0);
  if (pkg) {
    ctx.lineWidth = 2;
    ctx.font = "16px sans-serif";
    for (const b of pkg.boxes.filter((b: { page: number }) => b.page === n)) {
      const { x, y, width, height } = b.topLeft;
      ctx.strokeStyle = "#e00";
      ctx.fillStyle = "rgba(255,0,0,0.12)";
      ctx.fillRect(x * SCALE, y * SCALE, width * SCALE, height * SCALE);
      ctx.strokeRect(x * SCALE, y * SCALE, width * SCALE, height * SCALE);
      ctx.fillStyle = "#e00";
      ctx.fillText(`${b.kind}:${b.signerId}`, x * SCALE, y * SCALE - 4);
    }
  } else {
    ctx.strokeStyle = "rgba(0,0,255,0.3)";
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "blue";
    for (let v = 0; v < page.width / SCALE; v += 36) {
      ctx.beginPath(); ctx.moveTo(v * SCALE, 0); ctx.lineTo(v * SCALE, page.height); ctx.stroke();
      ctx.fillText(String(v), v * SCALE + 2, 14);
    }
    for (let v = 0; v < page.height / SCALE; v += 36) {
      ctx.beginPath(); ctx.moveTo(0, v * SCALE); ctx.lineTo(page.width, v * SCALE); ctx.stroke();
      ctx.fillText(String(v), 2, v * SCALE - 2);
    }
  }
  writeFileSync(`${outPrefix}-${n}.png`, c.toBuffer("image/png"));
}
await doc.loadingTask.destroy();
console.log("pages", doc.numPages);
