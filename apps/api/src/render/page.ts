import type { Band, PageOptions, PageSize } from "@necodoc/shared";

/** Portrait sizes in millimetres. */
const pageSizes: Record<PageSize, { width: number; height: number }> = {
  Letter: { width: 215.9, height: 279.4 },
  A4: { width: 210, height: 297 },
  Legal: { width: 215.9, height: 355.6 },
};

export const MM_TO_PT = 72 / 25.4;

export function pageDimensions({ size, orientation }: Pick<PageOptions, "size" | "orientation">) {
  const { width, height } = pageSizes[size];
  return orientation === "portrait" ? { width, height } : { width: height, height: width };
}

/**
 * Page size and body margins, in millimetres. The body's top and bottom margins reserve the
 * band heights on top of the author's margins, so bands sit inside the author's margins,
 * directly above and below the body (ADR 0012).
 */
export function pageLayout(page: PageOptions, header?: Band, footer?: Band) {
  const { width, height } = pageDimensions(page);
  const { margins } = page;
  return {
    width,
    height,
    bodyMargins: {
      ...margins,
      top: margins.top + (header?.height ?? 0),
      bottom: margins.bottom + (footer?.height ?? 0),
    },
  };
}
