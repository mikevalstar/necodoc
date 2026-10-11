import { type SigningPackage, signingKindLabels } from "@necodoc/shared";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { generationPdfUrl } from "@/lib/api";
import { PageCanvas, usePdfDocument } from "../templates/-overlay-pages";

// Spec: docs/features/signing-packages.md. A generation's signers and sign boxes, the package
// download, and the boxes drawn over the PDF to check them by eye.

/** Every provider format, PDF embedded for DocuSign: one file to hand off. */
const packageUrl = (id: string) =>
  `/api/generations/${id}/signing-package?formats=docusign&formats=dropbox_sign&formats=adobe_sign`;

const COLOURS = ["#d97706", "#2563eb", "#16a34a", "#db2777", "#7c3aed", "#0891b2"];

export function SigningSection({
  generationId,
  filename,
  signing,
}: {
  generationId: string;
  filename: string;
  signing: SigningPackage;
}) {
  const [showing, setShowing] = useState(false);
  const colour = (signerId: string) =>
    COLOURS[
      Math.max(
        0,
        signing.signers.findIndex((s) => s.id === signerId),
      ) % COLOURS.length
    ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Signing package</h2>
        <span className="text-sm text-muted-foreground">
          {signing.signers.length} signers · {signing.boxes.length} boxes
          {signing.anchors ? " · anchors in the PDF" : ""}
        </span>
        <div className="ml-auto flex gap-2">
          <a
            href={packageUrl(generationId)}
            download={`${filename.replace(/\.pdf$/i, "")}.signing.json`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadIcon />
            Package JSON
          </a>
          <a
            href={generationPdfUrl(generationId)}
            download={filename}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadIcon />
            PDF
          </a>
          <Button variant="outline" size="sm" onClick={() => setShowing(!showing)}>
            {showing ? "Hide boxes" : "Show boxes on the PDF"}
          </Button>
        </div>
      </div>
      {signing.warnings.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {signing.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Order</th>
            <th className="font-normal">Role</th>
            <th className="font-normal">Name</th>
            <th className="font-normal">Email</th>
            <th className="font-normal">Boxes</th>
          </tr>
        </thead>
        <tbody>
          {signing.signers.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="py-1">{s.routingOrder}</td>
              <td>
                <span
                  className="mr-1.5 inline-block size-2.5 rounded-full"
                  style={{ background: colour(s.id) }}
                />
                {s.role} <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
              </td>
              <td>{s.name || "—"}</td>
              <td>{s.email || "—"}</td>
              <td>
                {signing.boxes
                  .filter((b) => b.signerId === s.id)
                  .map((b) => `${signingKindLabels[b.kind]} p${b.page}`)
                  .join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showing && <BoxesOnPages generationId={generationId} signing={signing} colour={colour} />}
    </section>
  );
}

const SCALE = 1;

/** Each page with the package's boxes drawn where the package says they are. */
function BoxesOnPages({
  generationId,
  signing,
  colour,
}: {
  generationId: string;
  signing: SigningPackage;
  colour: (signerId: string) => string | undefined;
}) {
  const { doc, error } = usePdfDocument(generationPdfUrl(generationId));
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!doc) return <p className="text-sm text-muted-foreground">Loading the PDF…</p>;
  const role = (id: string) => signing.signers.find((s) => s.id === id)?.role ?? id;
  return (
    <div className="flex flex-wrap gap-4 overflow-x-auto rounded-lg bg-muted p-4">
      {signing.pages.map((_, i) => {
        const page = i + 1;
        return (
          <figure key={page} className="relative shadow">
            <PageCanvas doc={doc} page={page} scale={SCALE} />
            {signing.boxes
              .filter((b) => b.page === page)
              .map((b) => (
                <div
                  key={b.id}
                  title={`${b.id}: ${signingKindLabels[b.kind]} for ${role(b.signerId)}${b.required ? "" : " (optional)"}`}
                  className="absolute border-2 text-[9px] leading-none font-medium"
                  style={{
                    left: b.topLeft.x * SCALE,
                    top: b.topLeft.y * SCALE,
                    width: b.topLeft.width * SCALE,
                    height: b.topLeft.height * SCALE,
                    borderColor: colour(b.signerId),
                    color: colour(b.signerId),
                    background: `${colour(b.signerId)}22`,
                  }}
                >
                  <span className="absolute -top-3 left-0 whitespace-nowrap">
                    {signingKindLabels[b.kind]} · {role(b.signerId)}
                  </span>
                </div>
              ))}
            <figcaption className="absolute right-1 bottom-1 text-xs text-muted-foreground">
              {page}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
