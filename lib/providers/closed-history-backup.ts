import closedIpoSeed from "@/data/closed-ipo-backup.json";
import { cleanIpoName, effectiveIpoStatus, ipoNameKey, isClosedIpo } from "@/lib/ipo-normalization";
import type { GmpRow } from "@/lib/types";

const memoryBackup = new Map<string, GmpRow>();

function normalizedName(name: string) {
  return ipoNameKey(name);
}

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeRow(existing: GmpRow, incoming: GmpRow): GmpRow {
  const newer = timestamp(incoming.gmpLastUpdated) >= timestamp(existing.gmpLastUpdated);
  const primary = newer ? incoming : existing;
  const secondary = newer ? existing : incoming;

  return {
    ...secondary,
    ...primary,
    symbol: primary.symbol || secondary.symbol,
    marketType: primary.marketType || secondary.marketType,
    issuePriceMin: primary.issuePriceMin || secondary.issuePriceMin,
    issuePriceMax: primary.issuePriceMax || secondary.issuePriceMax,
    lotSize: primary.lotSize || secondary.lotSize,
    openDate: primary.openDate || secondary.openDate,
    closeDate: primary.closeDate || secondary.closeDate,
    allotmentDate: primary.allotmentDate || secondary.allotmentDate,
    listingDate: primary.listingDate || secondary.listingDate,
    registrar: primary.registrar || secondary.registrar,
    dataSource: [primary.dataSource, secondary.dataSource]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" + ")
  };
}

function isClosed(row: GmpRow) {
  return isClosedIpo(row);
}

function normalizeRow(row: GmpRow): GmpRow {
  return {
    ...row,
    name: cleanIpoName(row.name),
    status: effectiveIpoStatus(row)
  };
}

export function mergeClosedHistoryRows(...groups: GmpRow[][]) {
  const merged = new Map<string, GmpRow>();

  for (const sourceRow of groups.flat()) {
    const row = normalizeRow(sourceRow);
    if (!isClosed(row)) continue;
    const key = normalizedName(row.name) || row.id;
    const existing = merged.get(key);
    merged.set(key, existing ? mergeRow(existing, row) : row);
  }

  return [...merged.values()].sort((first, second) => {
    const closeDifference = timestamp(second.closeDate) - timestamp(first.closeDate);
    if (closeDifference !== 0) return closeDifference;
    return first.name.localeCompare(second.name);
  });
}

export function rememberClosedIpos(rows: GmpRow[]) {
  for (const sourceRow of rows) {
    const row = normalizeRow(sourceRow);
    if (!isClosed(row)) continue;
    const key = normalizedName(row.name) || row.id;
    const existing = memoryBackup.get(key);
    memoryBackup.set(key, existing ? mergeRow(existing, row) : row);
  }
}

export function getClosedIpoBackup() {
  return mergeClosedHistoryRows(closedIpoSeed as GmpRow[], [...memoryBackup.values()]);
}
