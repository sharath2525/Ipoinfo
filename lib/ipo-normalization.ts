import type { Ipo, IpoStatus } from "@/lib/types";

type IpoStatusInput = {
  status: IpoStatus;
  openDate?: string;
  closeDate?: string;
  listingDate?: string;
};

export function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isRealIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
}

export function isoDateOnly(value?: string, now = new Date()) {
  if (!value) return "";
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  let normalized = match?.[0] ?? "";

  if (!normalized) {
    const parsed = new Date(value);
    normalized = Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  if (!normalized || !isRealIsoDate(normalized)) return "";
  const year = Number(normalized.slice(0, 4));
  const currentYear = Number(indiaDate(now).slice(0, 4));
  return year >= 1990 && year <= currentYear + 3 ? normalized : "";
}

export function sanitizeIpoDates<T extends Pick<Ipo, "openDate" | "closeDate" | "allotmentDate" | "listingDate">>(
  ipo: T,
  now = new Date()
): T {
  let openDate = isoDateOnly(ipo.openDate, now);
  let closeDate = isoDateOnly(ipo.closeDate, now);
  let allotmentDate = isoDateOnly(ipo.allotmentDate, now);
  let listingDate = isoDateOnly(ipo.listingDate, now);

  if (openDate && closeDate) {
    const duration = (Date.parse(closeDate) - Date.parse(openDate)) / 86_400_000;
    if (duration < 0 || duration > 90) {
      openDate = "";
      closeDate = "";
    }
  }
  if (allotmentDate && closeDate && allotmentDate < closeDate) allotmentDate = "";
  if (listingDate && closeDate && listingDate < closeDate) listingDate = "";

  return { ...ipo, openDate, closeDate, allotmentDate, listingDate };
}

export function cleanIpoName(value: string) {
  const name = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(
      /\b(?:closing|closes?|opening|opens?)\s+today\b|\bopen\s+now\b|\bapply\s+now\b|\btentative\s+dates?\b/gi,
      " "
    )
    .replace(/\(\s*(?:mainboard|(?:bse|nse)\s+sme|sme)\s*\)/gi, " ")
    .replace(/\b(?:mainboard|(?:bse|nse)\s+sme)\b/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\bipo\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[|,:;\-\s]+$/g, "")
    .replace(/\s+(?:limited|ltd\.?)$/i, "")
    .trim();

  return name ? `${name} IPO` : "";
}

export function ipoNameKey(value: string) {
  return cleanIpoName(value)
    .toLowerCase()
    .replace(/\bnational stock exchange(?:\s+of)?\b/g, "nse")
    .replace(/&/g, " and ")
    .replace(/\b(?:ipo|limited|ltd|mainboard|sme|india|indian|pvt|private|and)\b/g, " ")
    .replace(/\bsolutions\b/g, "solution")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function effectiveIpoStatus(ipo: IpoStatusInput, now = new Date()): IpoStatus {
  const today = indiaDate(now);
  const openDate = isoDateOnly(ipo.openDate, now);
  const closeDate = isoDateOnly(ipo.closeDate, now);
  const listingDate = isoDateOnly(ipo.listingDate, now);

  if (openDate && today < openDate) return "upcoming";
  if (closeDate && today > closeDate) {
    return listingDate && today >= listingDate ? "listed" : "closed";
  }
  if (openDate && today >= openDate && (!closeDate || today <= closeDate)) return "open";

  return ipo.status;
}

export function isClosedIpo(ipo: IpoStatusInput, now = new Date()) {
  const status = effectiveIpoStatus(ipo, now);
  return status !== "open" && status !== "upcoming";
}
