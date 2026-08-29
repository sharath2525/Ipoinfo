import { getGmpProvider } from "@/lib/providers/gmp-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const provider = getGmpProvider();
  const meta = provider.getMeta();

  try {
    const gmp = await provider.listCurrentGmp();
    return Response.json({ gmp, meta });
  } catch (error) {
    return Response.json(
      {
        gmp: [],
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
