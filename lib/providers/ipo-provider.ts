import { sortIposForUtility, withinIpoWindow } from "@/lib/providers/date-window";
import {
  fetchIpoAlertsIpos,
  fetchIpoGuruIpos,
  fetchIpoWatchIpos,
  mergeIpos
} from "@/lib/providers/live-provider";
import {
  getPublicSourceHealthSnapshot,
  observePublicSource
} from "@/lib/providers/source-health";
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
    const sources = getPublicSourceHealthSnapshot();
    const healthySources = sources.filter((source) => source.state === "healthy");
    const hasHealthySchedule = healthySources.some((source) =>
      /ipopremium-current|ipowatch-calendar|ipoji-current|ipoguru-api|ipoalerts-api/.test(
        source.source
      )
    );
    const hasHealthyGmp = healthySources.some((source) =>
      /ipowatch-gmp|ipopremium-current|ipoguru-api|ipoalerts-api/.test(source.source)
    );
    const isLive = hasHealthySchedule && hasHealthyGmp;

    return {
      source: "multi-source",
      isLive,
      dataState: isLive ? "live" : "cached",
      message: isLive
        ? "Live IPO data merged from multiple available sources."
        : "Some live sources are unavailable. Verified rows were merged with saved public data.",
      fetchedAt: new Date().toISOString(),
      cachedAt: isLive ? undefined : new Date().toISOString()
    };
  }

  async listRecentIpos() {
    const sourceRequests: Array<Promise<Ipo[]>> = [
      observePublicSource(
        "public-web-aggregate",
        fetchIpoWatchIpos,
        (rows) => rows.length,
        "malformed"
      ).catch(() => [])
    ];

    if (this.ipoGuruApiKey) {
      sourceRequests.push(
        observePublicSource("ipoguru-api", () => fetchIpoGuruIpos(this.ipoGuruApiKey!), (rows) => rows.length)
          .catch(() => [])
      );
    }
    if (this.ipoAlertsApiKey) {
      sourceRequests.push(
        observePublicSource(
          "ipoalerts-api",
          () => fetchIpoAlertsIpos(this.ipoAlertsApiKey!),
          (rows) => rows.length
        ).catch(() => [])
      );
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
