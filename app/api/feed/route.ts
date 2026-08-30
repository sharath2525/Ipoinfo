import { unstable_cache } from "next/cache";
import { toGmpRows } from "@/lib/providers/gmp-provider";
import { rememberClosedIpos } from "@/lib/providers/closed-history-backup";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=3600"
};

const loadCachedFeed = unstable_cache(
  async () => {
    const provider = getIpoDataProvider();
    const ipos = await provider.listRecentIpos();
    const gmp = toGmpRows(ipos);
    rememberClosedIpos(gmp);

    return {
      ipos,
      gmp,
      meta: provider.getMeta()
    };
  },
  ["public-ipo-feed-v1"],
  { revalidate: 60 }
);

export async function GET() {
  try {
    return Response.json(await loadCachedFeed(), { headers: cacheHeaders });
  } catch (error) {
    return Response.json(
      {
        ipos: [],
        gmp: [],
        meta: {
          source: "multi-source",
          isLive: false,
          fetchedAt: new Date().toISOString(),
          message:
            error instanceof Error
              ? `Live providers failed: ${error.message}`
              : "Live providers failed."
        }
      },
      { status: 502 }
    );
  }
}
