import type { GmpRow, Ipo } from "@/lib/types";

export function toGmpRows(ipos: Ipo[]): GmpRow[] {
  return ipos.map((ipo) => {
    const hasGmp = typeof ipo.gmp === "number" && Number.isFinite(ipo.gmp);
    const hasPrice = ipo.issuePriceMax > 0;
    const gmp = hasGmp ? ipo.gmp : undefined;

    return {
      ...ipo,
      gmp,
      gmpPercent: hasGmp && hasPrice ? (ipo.gmp! / ipo.issuePriceMax) * 100 : undefined,
      estimatedListingPrice:
        hasGmp && hasPrice ? ipo.issuePriceMax + ipo.gmp! : undefined,
      estimatedListingGain: gmp,
      gmpLastUpdated: hasGmp ? ipo.gmpLastUpdated : undefined
    };
  });
}
