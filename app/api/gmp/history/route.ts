import { toGmpRows } from "@/lib/providers/gmp-provider";
import {
  getClosedIpoBackup,
  mergeClosedHistoryRows,
  rememberClosedIpos
} from "@/lib/providers/closed-history-backup";
import { fetchIpoPremiumIposPage } from "@/lib/providers/live-provider";
import { observePublicSource } from "@/lib/providers/source-health";

export const dynamic = "force-dynamic";

const historyCacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
};

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function newestRowUpdate(rows: ReturnType<typeof toGmpRows>, fallback: string) {
  const newest = Math.max(
    0,
    ...rows.map((row) => {
      const timestamp = row.gmpLastUpdated
        ? new Date(row.gmpLastUpdated).getTime()
        : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    })
  );
  return newest ? new Date(newest).toISOString() : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offset = boundedNumber(url.searchParams.get("offset"), 0, 0, 100000);
  const limit = boundedNumber(url.searchParams.get("limit"), 50, 1, 100);
  const refresh = url.searchParams.get("refresh") === "1";

  function cachedHistoryResponse(message: string) {
    const fallbackRows = getClosedIpoBackup();
    const gmp = fallbackRows.slice(offset, offset + limit);
    const cachedAt = newestRowUpdate(gmp, new Date().toISOString());

    return Response.json(
      {
        gmp,
        total: fallbackRows.length,
        offset,
        limit,
        nextOffset: offset + gmp.length,
        hasMore: offset + gmp.length < fallbackRows.length,
        source: "Closed IPO snapshot",
        dataState: "cached",
        cachedAt,
        message
      },
      { headers: historyCacheHeaders }
    );
  }

  if (!refresh) {
    return cachedHistoryResponse(
      "Showing the latest saved history while live data refreshes in the background."
    );
  }

  try {
    if (process.env.DISABLE_IPOPREMIUM_HISTORY_SOURCE === "true") {
      throw new Error("IPO Premium history source disabled");
    }

    const page = await observePublicSource(
      "ipopremium-history",
      () =>
        fetchIpoPremiumIposPage({
          status: "closed",
          start: offset,
          length: limit,
          timeoutMs: 20000
        }),
      (result) => result.ipos.length,
      "malformed"
    );
    if (!page.ipos.length) throw new Error("Closed-history source returned no usable rows");
    const historyRows = toGmpRows(page.ipos);
    const gmp = mergeClosedHistoryRows(historyRows);
    rememberClosedIpos(gmp);

    return Response.json(
      {
        gmp,
        total: page.total,
        offset,
        limit,
        nextOffset: offset + gmp.length,
        hasMore: offset + gmp.length < page.total,
        source: "IPO Premium",
        dataState: "live",
        fetchedAt: new Date().toISOString()
      },
      { headers: historyCacheHeaders }
    );
  } catch {
    return cachedHistoryResponse(
      "Live closed-history source is unavailable. Showing the latest saved history."
    );
  }
}
