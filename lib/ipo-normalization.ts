import type { IpoStatus } from "@/lib/types";

type IpoStatusInput = {
  status: IpoStatus;
  openDate?: string;
  closeDate?: string;
  listingDate?: string;
};

function indiaDate(now: Date) {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function isoDateOnly(value?: string) {
  if (!value) return "";
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
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
  const openDate = isoDateOnly(ipo.openDate);
  const closeDate = isoDateOnly(ipo.closeDate);
  const listingDate = isoDateOnly(ipo.listingDate);

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
