import { getPublicIpoFeed } from "@/lib/providers/public-feed";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=3600"
};

export async function GET() {
  try {
    return Response.json(await getPublicIpoFeed(), { headers: cacheHeaders });
  } catch {
    return Response.json(
      {
        ipos: [],
        gmp: [],
        meta: {
          source: "multi-source",
          isLive: false,
          dataState: "unavailable",
          fetchedAt: new Date().toISOString(),
          message: "Live IPO sources are temporarily unavailable."
        }
      },
      { status: 503 }
    );
  }
}
