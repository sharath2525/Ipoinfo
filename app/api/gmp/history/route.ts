import { getGmpProvider, toGmpRows } from "@/lib/providers/gmp-provider";
import {
  getClosedIpoBackup,
  mergeClosedHistoryRows,
  rememberClosedIpos
} from "@/lib/providers/closed-history-backup";
import { fetchIpoPremiumIposPage } from "@/lib/providers/live-provider";

export const dynamic = "force-dynamic";

const historyCacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=1800"
};

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offset = boundedNumber(url.searchParams.get("offset"), 0, 0, 100000);
  const limit = boundedNumber(url.searchParams.get("limit"), 50, 1, 100);

  try {
    if (process.env.DISABLE_IPOPREMIUM_HISTORY_SOURCE === "true") {
      throw new Error("IPO Premium history source disabled");
    }

    const page = await fetchIpoPremiumIposPage({
      status: "closed",
      start: offset,
      length: limit
    });
    const gmp = toGmpRows(page.ipos);
    rememberClosedIpos(gmp);

    return Response.json(
      {
        gmp,
        total: page.total,
        offset,
        limit,
        nextOffset: offset + page.ipos.length,
        hasMore: offset + gmp.length < page.total,
        source: "IPO Premium"
      },
      { headers: historyCacheHeaders }
    );
  } catch (premiumError) {
    try {
      const liveRows = (await getGmpProvider().listCurrentGmp()).filter(
        (row) => row.status !== "open" && row.status !== "upcoming"
      );
      rememberClosedIpos(liveRows);
      const fallbackRows = mergeClosedHistoryRows(liveRows, getClosedIpoBackup());
      const gmp = fallbackRows.slice(offset, offset + limit);

      return Response.json(
        {
          gmp,
          total: fallbackRows.length,
          offset,
          limit,
          nextOffset: offset + gmp.length,
          hasMore: offset + gmp.length < fallbackRows.length,
          source: "Fallback live sources + closed backup"
        },
        { headers: historyCacheHeaders }
      );
    } catch {
      const fallbackRows = getClosedIpoBackup();
      const gmp = fallbackRows.slice(offset, offset + limit);

      return Response.json(
        {
          gmp,
          total: fallbackRows.length,
          offset,
          limit,
          nextOffset: offset + gmp.length,
          hasMore: offset + gmp.length < fallbackRows.length,
          source: "Closed IPO backup",
          warning:
            premiumError instanceof Error
              ? premiumError.message
              : "Live closed-history sources are temporarily unavailable."
        },
        { headers: historyCacheHeaders }
      );
    }
  }
}
