import type { Ipo } from "@/lib/types";

export type IpoReference = {
  id: string;
  name?: string;
  closeDate?: string;
};

function normalizedName(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(limited|ltd|sme|ipo|mainboard|bse|nse)\b/g, " ")
    .replace(/\b(india|indian|solution|solutions|pvt|private|eq)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

export function resolveIpoReference(catalogue: Ipo[], reference: IpoReference) {
  const exactId = catalogue.find((ipo) => ipo.id === reference.id);
  if (exactId) return exactId;

  const targetName = normalizedName(reference.name);
  if (!targetName) return undefined;

  const nameMatches = catalogue.filter(
    (ipo) => normalizedName(ipo.name) === targetName
  );
  if (nameMatches.length === 1) return nameMatches[0];

  const targetCloseDate = normalizedDate(reference.closeDate);
  if (targetCloseDate) {
    const datedMatch = nameMatches.filter(
      (ipo) => normalizedDate(ipo.closeDate) === targetCloseDate
    );
    if (datedMatch.length === 1) return datedMatch[0];
  }

  const fuzzyMatches = catalogue.filter((ipo) => {
    const candidate = normalizedName(ipo.name);
    const sameDate =
      !targetCloseDate || normalizedDate(ipo.closeDate) === targetCloseDate;
    return (
      sameDate &&
      targetName.length >= 5 &&
      (candidate.includes(targetName) || targetName.includes(candidate))
    );
  });

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined;
}

export function resolveIpoReferences(
  catalogue: Ipo[],
  references: IpoReference[]
) {
  const resolved = new Map<string, Ipo>();

  for (const reference of references) {
    const ipo = resolveIpoReference(catalogue, reference);
    if (ipo) resolved.set(ipo.id, ipo);
  }

  return [...resolved.values()];
}
