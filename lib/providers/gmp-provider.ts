import { getIpoDataProvider } from "@/lib/providers/ipo-provider";
import type { GmpRow, Ipo, ProviderMeta } from "@/lib/types";

export interface GmpProvider {
  listCurrentGmp(): Promise<GmpRow[]>;
  getMeta(): ProviderMeta;
}

export function toGmpRows(ipos: Ipo[]): GmpRow[] {
  return ipos
    .filter((ipo) => typeof ipo.gmp === "number" && ipo.gmpLastUpdated)
    .map((ipo) => {
      const gmp = ipo.gmp ?? 0;
      const estimatedListingPrice = ipo.issuePriceMax + gmp;
      const gmpPercent = ipo.issuePriceMax ? (gmp / ipo.issuePriceMax) * 100 : 0;

      return {
        ...ipo,
        gmp,
        gmpPercent,
        estimatedListingPrice,
        estimatedListingGain: gmp,
        gmpLastUpdated: ipo.gmpLastUpdated ?? new Date().toISOString()
      };
    });
}

export class LiveGmpProvider implements GmpProvider {
  getMeta() {
    return getIpoDataProvider().getMeta();
  }

  async listCurrentGmp() {
    const ipos = await getIpoDataProvider().listRecentIpos();
    return toGmpRows(ipos);
  }
}

export function getGmpProvider(): GmpProvider {
  return new LiveGmpProvider();
}
