import { type SigningPackage, signingKindLabels } from "@necodoc/shared";
import { DownloadSimpleIcon, EyeIcon, EyeSlashIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { PdfTray } from "@/components/pdf-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { generationPdfUrl } from "@/lib/api";
import { PageCanvas, usePdfDocument } from "../templates/-overlay-pages";

// Spec: docs/features/signing-packages.md. A generation's signers and sign boxes, the package
// download, and the boxes drawn over the PDF to check them by eye.

/** Every provider format, PDF embedded for DocuSign: one file to hand off. */
const packageUrl = (id: string) =>
  `/api/generations/${id}/signing-package?formats=docusign&formats=dropbox_sign&formats=adobe_sign`;

/** One categorical series colour per signer (index.css), so a box's colour says whose it is. */
const SERIES = 8;

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
    `var(--series-${
      (Math.max(
        0,
        signing.signers.findIndex((s) => s.id === signerId),
      ) %
        SERIES) +
      1
    })`;
  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>Signing package</CardTitle>
        <CardDescription>
          {plural(signing.signers.length, "signer")} ·{" "}
          {plural(signing.boxes.length, "sign box", "sign boxes")}
          {signing.anchors ? " · anchor text in the PDF" : ""}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showing}
            onClick={() => setShowing(!showing)}
          >
            {showing ? <EyeSlashIcon /> : <EyeIcon />}
            {showing ? "Hide boxes" : "Show boxes on the PDF"}
          </Button>
          <a
            href={packageUrl(generationId)}
            download={`${filename.replace(/\.pdf$/i, "")}.signing.json`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadSimpleIcon />
            Package JSON
          </a>
          <a
            href={generationPdfUrl(generationId)}
            download={filename}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadSimpleIcon />
            PDF
          </a>
        </CardAction>
      </CardHeader>
      {signing.warnings.length > 0 && (
        <div className="px-5">
          <Alert>
            <WarningIcon className="text-warn" />
            <AlertDescription>
              <ul className="list-disc pl-5">
                {signing.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 pl-5">Order</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="pr-5">Sign boxes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signing.signers.map((s) => {
            const boxes = signing.boxes.filter((b) => b.signerId === s.id);
            return (
              <TableRow key={s.id}>
                <TableCell className="pl-5 tabular-nums">{s.routingOrder}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: colour(s.id) }}
                    />
                    <span className="font-semibold">{s.role}</span>
                    <span className="font-mono text-xs text-ink-3">{s.id}</span>
                  </span>
                </TableCell>
                <TableCell>{s.name || "—"}</TableCell>
                <TableCell>{s.email || "—"}</TableCell>
                <TableCell className="pr-5">
                  {boxes.length ? (
                    <span className="flex flex-wrap gap-1">
                      {boxes.map((b) => (
                        <Badge key={b.id} variant="secondary">
                          {signingKindLabels[b.kind]} · p{b.page}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {showing && (
        <div className="border-t border-hair p-5">
          <BoxesOnPages generationId={generationId} signing={signing} colour={colour} />
        </div>
      )}
    </Card>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const SCALE = 1;

/** Each page with the package's boxes drawn where the package says they are. */
function BoxesOnPages({
  generationId,
  signing,
  colour,
}: {
  generationId: string;
  signing: SigningPackage;
  colour: (signerId: string) => string;
}) {
  const { doc, error } = usePdfDocument(generationPdfUrl(generationId));
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!doc) return <p className="text-sm text-ink-3">Loading the PDF…</p>;
  const role = (id: string) => signing.signers.find((s) => s.id === id)?.role ?? id;
  return (
    <PdfTray wellClassName="flex flex-wrap justify-center gap-4 overflow-x-auto p-4">
      {signing.pages.map((_, i) => {
        const page = i + 1;
        return (
          <figure key={page} className="relative bg-white shadow-float">
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
                    background: `color-mix(in srgb, ${colour(b.signerId)} 13%, transparent)`,
                  }}
                >
                  <span className="absolute -top-3 left-0 whitespace-nowrap">
                    {signingKindLabels[b.kind]} · {role(b.signerId)}
                  </span>
                </div>
              ))}
            <figcaption className="absolute right-1 bottom-1 font-mono text-xs text-black/50">
              {page}
            </figcaption>
          </figure>
        );
      })}
    </PdfTray>
  );
}
