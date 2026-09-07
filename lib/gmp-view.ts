import type { GmpRow } from "@/lib/types";

export type GmpCategory = "open" | "upcoming" | "closed";
export type GmpMarketFilter = "all" | "mainboard" | "sme";
export type GmpSort = "date" | "mainboard_first" | "sme_first";

export type GmpViewState = {
  category: GmpCategory;
  market: GmpMarketFilter;
  sort: GmpSort;
  page: number;
  pageSize: 25 | 50 | 100;
};

const categories = new Set<GmpCategory>(["open", "upcoming", "closed"]);
const markets = new Set<GmpMarketFilter>(["all", "mainboard", "sme"]);
const sorts = new Set<GmpSort>(["date", "mainboard_first", "sme_first"]);
const pageSizes = new Set([25, 50, 100]);

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortAndFilterGmpRows(
  rows: GmpRow[],
  category: GmpCategory,
  market: GmpMarketFilter,
  sort: GmpSort
) {
  const filtered = rows.filter((row) => {
    if (market === "all") return true;
    return market === "sme" ? row.marketType === "SME" : row.marketType !== "SME";
  });
  const relevantDate = (row: GmpRow) =>
    timestamp(category === "upcoming" ? row.openDate : row.closeDate);
  const dateOrder = (first: GmpRow, second: GmpRow) => {
    const firstDate = relevantDate(first);
    const secondDate = relevantDate(second);
    if (firstDate === null && secondDate === null) return first.name.localeCompare(second.name);
    if (firstDate === null) return 1;
    if (secondDate === null) return -1;
    if (category === "closed") {
      return secondDate - firstDate || first.name.localeCompare(second.name);
    }
    return firstDate - secondDate || first.name.localeCompare(second.name);
  };

  if (sort === "date" || category === "closed") return [...filtered].sort(dateOrder);

  const preferred = sort === "sme_first" ? "SME" : "Mainboard";
  return [...filtered].sort((first, second) => {
    const firstRank = (first.marketType ?? "Mainboard") === preferred ? 0 : 1;
    const secondRank = (second.marketType ?? "Mainboard") === preferred ? 0 : 1;
    return firstRank - secondRank || dateOrder(first, second);
  });
}

export function gmpTimingLabel(row: GmpRow, category: GmpCategory, today: string) {
  if (category === "open" && row.closeDate === today) return "Closes Today";

  if (category === "upcoming" && row.openDate) {
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (row.openDate === tomorrow.toISOString().slice(0, 10)) return "Opens Tomorrow";
  }

  if (
    category === "closed" &&
    row.allotmentDate &&
    row.allotmentDate >= today &&
    (row.allotmentAvailability === "expected_soon" ||
      row.allotmentAvailability === "pending")
  ) {
    return "Allotment Expected";
  }

  return "";
}

export function parseGmpViewHash(hash: string): GmpViewState | null {
  const match = hash.toLowerCase().match(/^#gmp(?:-(open|upcoming|closed))?(?:\?(.*))?$/);
  if (!match) return null;
  const category = categories.has(match[1] as GmpCategory)
    ? (match[1] as GmpCategory)
    : "open";
  const params = new URLSearchParams(match[2] ?? "");
  const marketValue = params.get("market") as GmpMarketFilter;
  const sortValue = params.get("sort") as GmpSort;
  const pageValue = Number(params.get("page"));
  const sizeValue = Number(params.get("size"));

  return {
    category,
    market: markets.has(marketValue) ? marketValue : "all",
    sort: sorts.has(sortValue) ? sortValue : "date",
    page: Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    pageSize: pageSizes.has(sizeValue) ? (sizeValue as 25 | 50 | 100) : 25
  };
}

export function serializeGmpViewHash(state: GmpViewState) {
  const params = new URLSearchParams();
  if (state.market !== "all") params.set("market", state.market);
  if (state.sort !== "date") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== 25) params.set("size", String(state.pageSize));
  const query = params.toString();
  return `#gmp-${state.category}${query ? `?${query}` : ""}`;
}

export function paginationWindow(currentPage: number, totalPages: number) {
  const visibleCount = Math.min(3, totalPages);
  const start = Math.max(1, Math.min(currentPage - 1, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}
