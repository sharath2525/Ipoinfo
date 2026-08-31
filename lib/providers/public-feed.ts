import { unstable_cache } from "next/cache";
import { rememberClosedIpos } from "@/lib/providers/closed-history-backup";
import { toGmpRows } from "@/lib/providers/gmp-provider";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";

export const getPublicIpoFeed = unstable_cache(
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
