import { getPublicIpoFeed } from "@/lib/providers/public-feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { gmp, meta } = await getPublicIpoFeed();
    return Response.json({ gmp, meta });
  } catch {
    return Response.json(
      {
        gmp: [],
        meta: {
          source: "multi-source",
          isLive: false,
          dataState: "unavailable",
          fetchedAt: new Date().toISOString(),
          message: "Live GMP sources are temporarily unavailable."
        }
      },
      { status: 503 }
    );
  }
}
