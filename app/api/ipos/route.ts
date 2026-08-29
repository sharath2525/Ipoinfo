import { getIpoDataProvider } from "@/lib/providers/ipo-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const provider = getIpoDataProvider();
  const meta = provider.getMeta();

  try {
    const ipos = await provider.listRecentIpos();
    return Response.json({ ipos, meta });
  } catch (error) {
    return Response.json(
      {
        ipos: [],
        meta: {
          ...meta,
          isLive: false,
          message:
            error instanceof Error
              ? `Live provider failed: ${error.message}`
              : "Live provider failed."
        }
      },
      { status: 502 }
    );
  }
}
