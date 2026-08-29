import { getGmpProvider, toGmpRows } from "@/lib/providers/gmp-provider";
import { fetchIpoPremiumIposPage } from "@/lib/providers/live-provider";

export const dynamic = "force-dynamic";

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offset = boundedNumber(url.searchParams.get("offset"), 0, 0, 100000);
  const limit = boundedNumber(url.searchParams.get("limit"), 50, 1, 100);

  try {
    const page = await fetchIpoPremiumIposPage({
      status: "closed",
      start: offset,
      length: limit
    });
    const gmp = toGmpRows(page.ipos);

    return Response.json({
      gmp,
      total: page.total,
      offset,
      limit,
      nextOffset: offset + page.ipos.length,
      hasMore: offset + gmp.length < page.total,
      source: "IPO Premium"
    });
  } catch (premiumError) {
    try {
      const fallbackRows = (await getGmpProvider().listCurrentGmp()).filter(
        (row) => row.status !== "open" && row.status !== "upcoming"
      );
      const gmp = fallbackRows.slice(offset, offset + limit);

      return Response.json({
        gmp,
        total: fallbackRows.length,
        offset,
        limit,
        nextOffset: offset + gmp.length,
        hasMore: offset + gmp.length < fallbackRows.length,
        source: "Fallback live sources"
      });
    } catch {
      return Response.json(
        {
          gmp: [],
          total: 0,
          offset,
          limit,
          nextOffset: offset,
          hasMore: false,
          error:
            premiumError instanceof Error
              ? premiumError.message
              : "Closed IPO history is temporarily unavailable."
        },
        { status: 502 }
      );
    }
  }
}
