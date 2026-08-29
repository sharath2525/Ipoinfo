import { toGmpRows } from "@/lib/providers/gmp-provider";
import { rememberClosedIpos } from "@/lib/providers/closed-history-backup";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";

export const dynamic = "force-dynamic";

const cacheHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=45, stale-while-revalidate=180"
};

export async function GET() {
  const provider = getIpoDataProvider();
  const meta = provider.getMeta();

  try {
    const ipos = await provider.listRecentIpos();
    const gmp = toGmpRows(ipos);
    rememberClosedIpos(gmp);

    return Response.json(
      {
        ipos,
        gmp,
        meta
      },
      { headers: cacheHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        ipos: [],
        gmp: [],
        meta: {
          ...meta,
          isLive: false,
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
