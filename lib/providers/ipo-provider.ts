import { sortIposForUtility, withinIpoWindow } from "@/lib/providers/date-window";
import {
  fetchIpoAlertsIpos,
  fetchIpoGuruIpos,
  fetchIpoWatchIpos,
  mergeIpos
} from "@/lib/providers/live-provider";
import type { Ipo, ProviderMeta } from "@/lib/types";

export interface IpoDataProvider {
  listRecentIpos(): Promise<Ipo[]>;
  getMeta(): ProviderMeta;
}

export class MultiSourceIpoDataProvider implements IpoDataProvider {
  constructor(
    private ipoGuruApiKey?: string,
    private ipoAlertsApiKey?: string
  ) {}

  getMeta(): ProviderMeta {
    return {
      source: "multi-source",
      isLive: true,
      message: "Live IPO data merged from multiple available sources.",
      fetchedAt: new Date().toISOString()
    };
  }

  async listRecentIpos() {
    const sourceRequests: Array<Promise<Ipo[]>> = [
      fetchIpoWatchIpos().catch(() => [])
    ];

    if (this.ipoGuruApiKey) {
      sourceRequests.push(fetchIpoGuruIpos(this.ipoGuruApiKey).catch(() => []));
    }
    if (this.ipoAlertsApiKey) {
      sourceRequests.push(fetchIpoAlertsIpos(this.ipoAlertsApiKey).catch(() => []));
    }

    const sourceRows = await Promise.all(sourceRequests);
    const ipos = sourceRows.reduce(
      (merged, rows) => mergeIpos(rows, merged),
      [] as Ipo[]
    );

    if (!ipos.length) {
      throw new Error("All configured live IPO sources returned no rows");
    }

    return sortIposForUtility(ipos.filter((ipo) => withinIpoWindow(ipo)));
  }
}

export function getIpoDataProvider(): IpoDataProvider {
  return new MultiSourceIpoDataProvider(
    process.env.IPOGURU_API_KEY,
    process.env.IPOALERTS_API_KEY
  );
}
