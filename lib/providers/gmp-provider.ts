import { getIpoDataProvider } from "@/lib/providers/ipo-provider";
import { toGmpRows } from "@/lib/gmp-values";
import type { GmpRow, ProviderMeta } from "@/lib/types";

export { toGmpRows } from "@/lib/gmp-values";

export interface GmpProvider {
  listCurrentGmp(): Promise<GmpRow[]>;
  getMeta(): ProviderMeta;
}

export class LiveGmpProvider implements GmpProvider {
  getMeta() {
    return getIpoDataProvider().getMeta();
  }

  async listCurrentGmp() {
    const ipos = await getIpoDataProvider().listRecentIpos();
    return toGmpRows(ipos);
  }
}

export function getGmpProvider(): GmpProvider {
  return new LiveGmpProvider();
}
