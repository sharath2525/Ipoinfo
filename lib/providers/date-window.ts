import type { Ipo } from "@/lib/types";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function withinIpoWindow(ipo: Ipo, now = new Date()) {
  const windowStart = addMonths(startOfMonth(now), -1);
  const windowEnd = addMonths(startOfMonth(now), 2);
  const dates = [
    parseDate(ipo.openDate),
    parseDate(ipo.closeDate),
    parseDate(ipo.allotmentDate),
    parseDate(ipo.listingDate)
  ].filter(Boolean) as Date[];

  return (
    ipo.status === "upcoming" ||
    dates.some((date) => date >= windowStart && date < windowEnd)
  );
}

export function sortIposForUtility(ipos: Ipo[]) {
  const priority = {
    available: 0,
    expected_soon: 1,
    pending: 2,
    unavailable: 3
  };

  return [...ipos].sort((first, second) => {
    const availability =
      priority[first.allotmentAvailability] - priority[second.allotmentAvailability];
    if (availability !== 0) return availability;
    return (
      (parseDate(second.closeDate)?.getTime() ?? 0) -
      (parseDate(first.closeDate)?.getTime() ?? 0)
    );
  });
}
