import { getMockIpos } from "@/lib/providers/mock-data";
import { sortIposForUtility, withinIpoWindow } from "@/lib/providers/date-window";
import {
  fetchIpoAlertsIpos,
  fetchIpoGuruIpos,
  fetchIpoWatchIpos
} from "@/lib/providers/live-provider";
import type { Ipo, ProviderMeta } from "@/lib/types";

export interface IpoDataProvider {
  listRecentIpos(): Promise<Ipo[]>;
  getMeta(): ProviderMeta;
}

export class MockIpoDataProvider implements IpoDataProvider {
  getMeta(): ProviderMeta {
    return {
      source: "mock",
      isLive: false,
      message: "Demo data is showing because all live sources are unavailable.",
      fetchedAt: new Date().toISOString()
    };
  }

  async listRecentIpos() {
    return sortIposForUtility(getMockIpos().filter((ipo) => withinIpoWindow(ipo)));
  }
}

export class IpoWatchDataProvider implements IpoDataProvider {
  getMeta(): ProviderMeta {
    return {
      source: "ipowatch",
      isLive: true,
      message: "Live IPO and GMP data loaded from IPOWatch.",
      fetchedAt: new Date().toISOString()
    };
  }

  async listRecentIpos() {
    const ipos = await fetchIpoWatchIpos();
    return sortIposForUtility(ipos.filter((ipo) => withinIpoWindow(ipo)));
  }
}

export class IpoGuruDataProvider implements IpoDataProvider {
  constructor(private apiKey: string) {}

  getMeta(): ProviderMeta {
    return {
      source: "ipoguru",
      isLive: true,
      message: "Live IPO and GMP data loaded from IPO Guru.",
      fetchedAt: new Date().toISOString()
    };
  }

  async listRecentIpos() {
    const ipos = await fetchIpoGuruIpos(this.apiKey);
    return sortIposForUtility(ipos.filter((ipo) => withinIpoWindow(ipo)));
  }
}

export class IpoAlertsDataProvider implements IpoDataProvider {
  constructor(private apiKey: string) {}

  getMeta(): ProviderMeta {
    return {
      source: "ipoalerts",
      isLive: true,
      message:
        "Live IPO data loaded from ipoalerts. GMP requires your ipoalerts plan to include GMP access.",
      fetchedAt: new Date().toISOString()
    };
  }

  async listRecentIpos() {
    const ipos = await fetchIpoAlertsIpos(this.apiKey);
    return sortIposForUtility(ipos.filter((ipo) => withinIpoWindow(ipo)));
  }
}

export function getIpoDataProvider(): IpoDataProvider {
  if (process.env.IPOGURU_API_KEY) {
    return new IpoGuruDataProvider(process.env.IPOGURU_API_KEY);
  }

  if (process.env.IPOALERTS_API_KEY) {
    return new IpoAlertsDataProvider(process.env.IPOALERTS_API_KEY);
  }

  if (process.env.DISABLE_IPOWATCH_SOURCE !== "true") {
    return new IpoWatchDataProvider();
  }

  return new MockIpoDataProvider();
}
