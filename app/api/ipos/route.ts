import { getPublicIpoFeed } from "@/lib/providers/public-feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { ipos, meta } = await getPublicIpoFeed();
    return Response.json({ ipos, meta });
  } catch {
    return Response.json(
      {
        ipos: [],
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
