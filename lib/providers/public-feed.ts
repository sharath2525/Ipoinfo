import { unstable_cache } from "next/cache";
import {
  getClosedIpoBackup,
  rememberClosedIpos
} from "@/lib/providers/closed-history-backup";
import { toGmpRows } from "@/lib/providers/gmp-provider";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";
import { selectPublicSnapshot } from "@/lib/public-snapshot";
import publicIpoSeed from "@/data/current-ipo-backup.json";
import { effectiveIpoStatus } from "@/lib/ipo-normalization";
import type { GmpRow, Ipo, ProviderMeta } from "@/lib/types";

export type PublicIpoFeed = {
  ipos: Ipo[];
  gmp: GmpRow[];
  meta: ProviderMeta;
};

let lastSuccessfulFeed: PublicIpoFeed | null = null;

function newestUpdate(rows: GmpRow[]) {
  const newest = Math.max(
    0,
    ...rows.map((row) => {
      const timestamp = row.gmpLastUpdated
        ? new Date(row.gmpLastUpdated).getTime()
        : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    })
  );
  return newest ? new Date(newest).toISOString() : new Date(0).toISOString();
}

const getCachedLivePublicIpoFeed = unstable_cache(
  async () => {
    const provider = getIpoDataProvider();
    const ipos = await provider.listRecentIpos();
    const gmp = toGmpRows(ipos);
    rememberClosedIpos(gmp);
    const meta = provider.getMeta();

    return {
      ipos,
      gmp,
      meta: {
        ...meta,
        dataState: meta.dataState ?? (meta.isLive ? "live" : "cached")
      }
    } satisfies PublicIpoFeed;
  },
  ["public-ipo-feed-v8"],
  { revalidate: 60 }
);

export async function getPublicIpoFeed(): Promise<PublicIpoFeed> {
  try {
    const feed = await getCachedLivePublicIpoFeed();
    const fetchedAt = new Date(feed.meta.fetchedAt).getTime();
    const isStale = Number.isFinite(fetchedAt) && Date.now() - fetchedAt > 90_000;
    const current: PublicIpoFeed = isStale
      ? {
          ...feed,
          meta: {
            ...feed.meta,
            isLive: false,
            dataState: "cached",
            cachedAt: feed.meta.fetchedAt,
            message: "Showing the last successful public IPO update."
          }
        }
      : feed;

    lastSuccessfulFeed = current;
    return current;
  } catch {
    const saved = selectPublicSnapshot<PublicIpoFeed>(null, lastSuccessfulFeed);
    if (saved.snapshot) {
      return {
        ...saved.snapshot,
        meta: {
          ...saved.snapshot.meta,
          isLive: false,
          dataState: "cached",
          cachedAt: saved.snapshot.meta.fetchedAt,
          message: "Live sources are temporarily unavailable. Showing the last successful update."
        }
      };
    }

    const currentRows = (publicIpoSeed as GmpRow[]).map((row) => ({
      ...row,
      status: effectiveIpoStatus(row)
    }));
    const savedRows = currentRows.length ? currentRows : getClosedIpoBackup();
    if (savedRows.length) {
      const cachedAt = newestUpdate(savedRows);
      return {
        ipos: savedRows,
        gmp: savedRows,
        meta: {
          source: "multi-source",
          isLive: false,
          dataState: "cached",
          fetchedAt: cachedAt,
          cachedAt,
          message: "Live sources are unavailable. Showing the bundled last successful history."
        }
      };
    }

    throw new Error("Public IPO sources are temporarily unavailable");
  }
}
