import type { AllotmentAvailability, Ipo, IpoStatus } from "@/lib/types";
import * as cheerio from "cheerio";

type IpoGuruRow = {
  name?: string;
  symbol?: string;
  open_date?: string;
  close_date?: string;
  allotment_date?: string | null;
  listing_date?: string | null;
  price_band?: string | null;
  issue_price?: string | number | null;
  lot_size?: string | number | null;
  registrar?: string | null;
  status?: string;
  gmp?: {
    price?: string | number | null;
    percentage?: string | number | null;
    updated_at?: string | null;
  };
};

type IpoAlertsRow = {
  id?: string;
  name?: string;
  symbol?: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
  listingDate?: string;
  priceRange?: string;
  minQty?: number;
  status?: string;
  gmp?: {
    lastUpdatedAt?: string;
    aggregations?: {
      mean?: number;
      median?: number;
      mode?: number;
    };
  };
};

type IpoWatchParsedRow = {
  name: string;
  gmp: number;
  price: number;
  estimatedListingPrice: number;
  estimatedListingGainPercent: number;
  dates: string;
  status: IpoStatus;
  lastUpdated: string;
  section: "Mainboard" | "SME";
};

type IpoWatchAllotmentRow = {
  name: string;
  allotmentDate: string;
  registrar: string;
  allotmentUrl: string;
  releaseStatus?: string;
};

type IpoJiListedRow = {
  name: string;
  openDate: string;
  closeDate: string;
  priceBand: string;
  allotmentPath?: string;
  status: IpoStatus;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function numberFrom(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function upperPrice(priceBand?: string | null, issuePrice?: string | number | null) {
  const issue = numberFrom(issuePrice);
  if (issue) return issue;
  if (!priceBand) return 0;
  const matches = priceBand.replace(/,/g, "").match(/\d+(\.\d+)?/g);
  return matches?.length ? Number(matches[matches.length - 1]) : 0;
}

function statusFrom(value?: string): IpoStatus {
  const normalized = value?.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "open") return "open";
  if (normalized === "upcoming" || normalized === "announced") return "upcoming";
  if (normalized === "listed") return "listed";
  if (normalized === "listing_soon") return "listing_soon";
  return "closed";
}

function availabilityFrom(status: IpoStatus, allotmentDate?: string | null): AllotmentAvailability {
  if (status === "upcoming" || status === "open") return "pending";
  if (!allotmentDate) return "unavailable";

  const today = new Date();
  const allotment = new Date(allotmentDate);
  if (Number.isNaN(allotment.getTime())) return "unavailable";

  const dayMs = 24 * 60 * 60 * 1000;
  const diff = allotment.getTime() - today.getTime();
  if (diff <= 0) return "available";
  if (diff <= 3 * dayMs) return "expected_soon";
  return "pending";
}

async function fetchJson<T>(url: string, headers: HeadersInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Provider returned ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "IPO Fast Check/0.1 (+https://ipofastcheck.local)"
      },
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Provider returned ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseListing(value: string, price: number, gmp: number) {
  const listing = numberFrom(value);
  const percentMatch = value.match(/\((-?\d+(\.\d+)?)%\)/);

  return {
    estimatedListingPrice: listing || price + gmp,
    estimatedListingGainPercent: percentMatch ? Number(percentMatch[1]) : 0
  };
}

function monthIndexFromName(value: string) {
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ];
  const lower = value.toLowerCase();
  return monthNames.findIndex((month) => lower.includes(month.slice(0, 3)));
}

function yearAwareRange(value: string) {
  const today = new Date();
  const years = value.match(/\b20\d{2}\b/g)?.map(Number) ?? [];
  const explicitYear = years[years.length - 1] ?? today.getFullYear();
  const datePieces = value.match(/([A-Za-z]{3,9})\s+(\d{1,2})|\b(\d{1,2})\s+([A-Za-z]{3,9})/g) ?? [];

  if (datePieces.length) {
    const parsed = datePieces
      .map((piece) => {
        const monthIndex = monthIndexFromName(piece);
        const day = Number(piece.match(/\d{1,2}/)?.[0] ?? 0);
        return monthIndex >= 0 && day
          ? new Date(explicitYear, monthIndex, day)
          : null;
      })
      .filter(Boolean) as Date[];

    if (parsed.length) {
      const open = parsed[0];
      const close = parsed[parsed.length - 1];

      if (parsed.length > 1 && close < open) {
        open.setFullYear(open.getFullYear() - 1);
      }

      return {
        openDate: open.toISOString().slice(0, 10),
        closeDate: close.toISOString().slice(0, 10)
      };
    }
  }

  const monthIndex = monthIndexFromName(value);
  const numbers = value
    .replace(/\b20\d{2}\b/g, "")
    .match(/\d{1,2}/g)
    ?.map(Number) ?? [];

  if (monthIndex === -1 || !numbers.length) {
    return { openDate: "", closeDate: "" };
  }

  const startDay = numbers[0];
  const endDay = numbers[numbers.length - 1];
  const startMonth = endDay < startDay ? monthIndex - 1 : monthIndex;
  const start = new Date(explicitYear, startMonth, startDay);
  const end = new Date(explicitYear, monthIndex, endDay);

  return {
    openDate: start.toISOString().slice(0, 10),
    closeDate: end.toISOString().slice(0, 10)
  };
}

function estimateAllotmentDate(closeDate: string, status: IpoStatus) {
  if (!closeDate) return "";
  const close = new Date(closeDate);
  if (Number.isNaN(close.getTime())) return "";
  const offset = status === "listed" ? 2 : 3;
  close.setDate(close.getDate() + offset);
  return close.toISOString().slice(0, 10);
}

function estimateListingDate(closeDate: string) {
  if (!closeDate) return "";
  const close = new Date(closeDate);
  if (Number.isNaN(close.getTime())) return "";
  close.setDate(close.getDate() + 5);
  return close.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function statusFromDates(openDate: string, closeDate: string): IpoStatus {
  const now = new Date();
  const open = new Date(openDate);
  const close = new Date(closeDate);

  if (Number.isNaN(open.getTime()) || Number.isNaN(close.getTime())) return "upcoming";
  if (now < open) return "upcoming";
  if (now <= addDays(close, 1)) return "open";
  if (now <= addDays(close, 10)) return "closed";
  return "listed";
}

function normalizeKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\blimited\b/g, "")
    .replace(/\bltd\b/g, "")
    .replace(/\bsme\b/g, "")
    .replace(/\bipo\b/g, "")
    .replace(/\bindia\b/g, "")
    .replace(/\bindian\b/g, "")
    .replace(/\bsolution\b/g, "")
    .replace(/\bsolutions\b/g, "")
    .replace(/\bpvt\b/g, "")
    .replace(/\bprivate\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isoDate(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  const parsed = new Date(value.replace(/Sept/i, "Sep").replace(",", ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function recentWindowStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

function shortDateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function ipoJiUrl(path: string) {
  return path.startsWith("http") ? path : `https://www.ipoji.com${path}`;
}

function registrarUrl(registrar: string) {
  const normalized = registrar.toLowerCase();
  if (normalized.includes("kfin")) return "https://ipostatus.kfintech.com/";
  if (normalized.includes("mufg") || normalized.includes("intime")) {
    return "https://in.mpms.mufg.com/Initial_Offer/public-issues.html";
  }
  if (normalized.includes("bigshare")) {
    return "https://ipo.bigshareonline.com/ipo_status.html";
  }
  if (normalized.includes("skyline")) {
    return "https://www.skylinerta.com/ipo.php";
  }
  return "https://www.bseindia.com/investors/appli_check.aspx";
}

function urlMatchesRegistrar(url: string, registrar: string) {
  const normalizedUrl = url.toLowerCase();
  const normalizedRegistrar = registrar.toLowerCase();

  if (normalizedRegistrar.includes("kfin")) return normalizedUrl.includes("kfin");
  if (normalizedRegistrar.includes("mufg") || normalizedRegistrar.includes("intime")) {
    return normalizedUrl.includes("mpms") || normalizedUrl.includes("linkintime");
  }
  if (normalizedRegistrar.includes("bigshare")) return normalizedUrl.includes("bigshare");
  if (normalizedRegistrar.includes("skyline")) return normalizedUrl.includes("skylinerta");
  if (normalizedRegistrar.includes("cameo")) return normalizedUrl.includes("cameo");
  if (normalizedRegistrar.includes("maashitla")) return normalizedUrl.includes("maashitla");
  if (normalizedRegistrar.includes("purva")) return normalizedUrl.includes("purvashare");

  return true;
}

function rowToIpo(row: IpoWatchParsedRow): Ipo {
  const range = yearAwareRange(row.dates);
  const allotmentDate = estimateAllotmentDate(range.closeDate, row.status);

  return {
    id: slugify(`${row.name}-${range.openDate || row.section}`),
    name: `${row.name} IPO`,
    issuePriceMax: row.price,
    lotSize: 0,
    openDate: range.openDate,
    closeDate: range.closeDate,
    allotmentDate,
    listingDate: estimateListingDate(range.closeDate),
    registrar: "Registrar to confirm",
    status: row.status,
    allotmentAvailability: availabilityFrom(row.status, allotmentDate),
    gmp: row.gmp,
    gmpLastUpdated: row.lastUpdated,
    dataSource: "IPOWatch"
  };
}

function calendarRowToIpo(cells: string[]): Ipo | null {
  const name = cells[0]?.replace(/\s+IPO$/i, "").trim();
  const open = new Date(cells[1]);
  const close = new Date(cells[2]);

  if (!name || Number.isNaN(open.getTime()) || Number.isNaN(close.getTime())) {
    return null;
  }

  const openDate = open.toISOString().slice(0, 10);
  const closeDate = close.toISOString().slice(0, 10);
  const status = statusFromDates(openDate, closeDate);
  const allotmentDate = estimateAllotmentDate(closeDate, status);
  const issuePriceMax = upperPrice(cells[5], null);

  return {
    id: slugify(`${name}-${openDate}`),
    name: `${name} IPO`,
    issuePriceMax,
    lotSize: 0,
    openDate,
    closeDate,
    allotmentDate,
    listingDate: estimateListingDate(closeDate),
    registrar: "Registrar to confirm",
    status,
    allotmentAvailability: availabilityFrom(status, allotmentDate),
    gmp: 0,
    gmpLastUpdated: "",
    dataSource: "IPOWatch Calendar"
  };
}

function parseIpoWatchRows(html: string) {
  const $ = cheerio.load(html);
  const rows: IpoWatchParsedRow[] = [];

  $("h3").each((_, heading) => {
    const title = $(heading).text();
    const section = title.includes("SME") ? "SME" : title.includes("Mainboard") ? "Mainboard" : null;
    if (!section) return;

    const table = $(heading).nextAll("figure").first().find("table").first();
    table.find("tbody tr, tr").each((__, row) => {
      const cells = $(row)
        .find("td")
        .map((___, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get();

      if (cells.length < 8 || !cells[0] || cells[0].toLowerCase().includes("ipo name")) {
        return;
      }

      const price = numberFrom(cells[3]);
      const gmp = numberFrom(cells[1]);
      const listing = parseListing(cells[4], price, gmp);

      rows.push({
        name: cells[0].replace(/\s+IPO$/i, ""),
        gmp,
        price,
        estimatedListingPrice: listing.estimatedListingPrice,
        estimatedListingGainPercent: listing.estimatedListingGainPercent,
        dates: cells[5],
        status: statusFrom(cells[6]),
        lastUpdated: cells[7],
        section
      });
    });
  });

  return rows;
}

function parseIpoWatchCalendarRows(html: string) {
  const $ = cheerio.load(html);
  const ipos: Ipo[] = [];

  $("table").each((_, table) => {
    const header = $(table)
      .find("tr")
      .first()
      .find("td,th")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get()
      .join(" | ")
      .toLowerCase();

    if (
      !header.includes("company ipo") ||
      !header.includes("open date") ||
      !header.includes("close date")
    ) {
      return;
    }

    $(table)
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const cells = $(row)
          .find("td")
          .map((___, cell) => $(cell).text().replace(/\s+/g, " ").trim())
          .get();
        const ipo = calendarRowToIpo(cells);
        if (ipo) ipos.push(ipo);
      });
  });

  return ipos;
}

function parseIpoWatchAllotmentRows(html: string) {
  const $ = cheerio.load(html);
  const rows: IpoWatchAllotmentRow[] = [];

  $("table").each((_, table) => {
    const header = $(table)
      .find("tr")
      .first()
      .find("td,th")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get()
      .join(" | ")
      .toLowerCase();

    if (
      !header.includes("ipo date") ||
      !header.includes("allotment date") ||
      !header.includes("allotment status")
    ) {
      return;
    }

    $(table)
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const cells = $(row)
          .find("td")
          .map((___, cell) => $(cell).text().replace(/\s+/g, " ").trim())
          .get();
        const name = cells[0]?.replace(/\s+IPO$/i, "").trim();
        const registrar = cells[3]?.trim();

        if (!name || !registrar) return;

        rows.push({
          name,
          allotmentDate: cells[2] ?? "",
          registrar,
          allotmentUrl: registrarUrl(registrar)
        });
      });
  });

  return rows;
}

function parseIpo360AllotmentRows(html: string) {
  const $ = cheerio.load(html);
  const rows: IpoWatchAllotmentRow[] = [];

  $("tr.allotment-row").each((_, row) => {
    const cells = $(row).find("td");
    const name = $(cells[0])
      .find(".company-name")
      .first()
      .text()
      .replace(/\s+IPO$/i, "")
      .trim();
    const allotmentUrl = $(cells[1]).find("a").first().attr("href")?.trim();
    const releaseStatus = $(cells[2]).text().replace(/\s+/g, " ").trim();
    const allotmentDate =
      $(cells[3]).find("time").first().attr("datetime")?.trim() ||
      $(cells[3]).text().replace(/\s+/g, " ").trim();
    const registrar = $(cells[4]).text().replace(/\s+/g, " ").trim();

    if (!name || !registrar) return;

    rows.push({
      name,
      allotmentDate,
      registrar,
      allotmentUrl: allotmentUrl || registrarUrl(registrar),
      releaseStatus
    });
  });

  if (rows.length) return rows;

  $("table").each((_, table) => {
    const header = $(table)
      .find("tr")
      .first()
      .find("td,th")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get()
      .join(" | ")
      .toLowerCase();

    if (
      !header.includes("action") ||
      !header.includes("status") ||
      !header.includes("allotment date") ||
      !header.includes("registrar")
    ) {
      return;
    }

    $(table)
      .find("tr")
      .slice(1)
      .each((__, row) => {
        const cells = $(row).find("td");
        const name = $(cells[0])
          .find("a")
          .first()
          .text()
          .replace(/\s+IPO$/i, "")
          .trim();
        const registrar = $(cells[4]).text().replace(/\s+/g, " ").trim();

        if (!name || !registrar) return;

        rows.push({
          name,
          allotmentDate:
            $(cells[3]).find("time").first().attr("datetime")?.trim() ||
            $(cells[3]).text().replace(/\s+/g, " ").trim(),
          registrar,
          allotmentUrl:
            $(cells[1]).find("a").first().attr("href")?.trim() ||
            registrarUrl(registrar),
          releaseStatus: $(cells[2]).text().replace(/\s+/g, " ").trim()
        });
      });
  });

  return rows;
}

function parseIpoJiListedRows(html: string, pageStatus: IpoStatus) {
  const $ = cheerio.load(html);
  const rows: IpoJiListedRow[] = [];

  $("article.ipo-card").each((_, card) => {
    const name = $(card).find(".ipo-card-name").first().text().replace(/\s+/g, " ").trim();
    const sourceStatus = $(card).attr("data-ipo-status")?.toLowerCase();
    const status: IpoStatus =
      pageStatus === "listed"
        ? "listed"
        : sourceStatus === "upcoming"
        ? "upcoming"
        : sourceStatus === "current"
          ? "open"
          : sourceStatus === "listed"
            ? "listed"
            : pageStatus;
    const dates = $(card)
      .find(".ipo-card-date time")
      .map((__, time) => $(time).attr("datetime")?.trim() ?? "")
      .get()
      .filter(Boolean);
    const allotmentPath = $(card).find("a[href*='/ipo-allotment-status/']").first().attr("href");
    let priceBand = "";

    $(card)
      .find(".ipo-card-body-stat")
      .each((__, stat) => {
        const label = $(stat)
          .find(".ipo-card-secondary-label")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        if (label.includes("offer price")) {
          priceBand = $(stat)
            .find(".ipo-card-body-value")
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim();
        }
      });

    if (!name || dates.length < 2) return;

    rows.push({
      name: `${name} IPO`,
      openDate: isoDate(dates[0]),
      closeDate: isoDate(dates[1]),
      priceBand,
      allotmentPath,
      status
    });
  });

  return rows;
}

function additionalPropertyValue(payload: unknown, targetName: string): string {
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const value = record.value;

  if (name.includes(targetName) && (typeof value === "string" || typeof value === "number")) {
    return String(value);
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = additionalPropertyValue(item, targetName);
        if (found) return found;
      }
    } else if (nested && typeof nested === "object") {
      const found = additionalPropertyValue(nested, targetName);
      if (found) return found;
    }
  }

  return "";
}

function parseIpoJiAllotmentInfo(html: string) {
  const $ = cheerio.load(html);
  let allotmentDate = "";
  let registrar = "";

  $("script[type='application/ld+json']").each((_, script) => {
    if (allotmentDate && registrar) return;

    try {
      const payload = JSON.parse($(script).text());
      allotmentDate ||= isoDate(additionalPropertyValue(payload, "allotment date"));
      registrar ||= additionalPropertyValue(payload, "registrar");
    } catch {
      // Ignore malformed embedded JSON-LD from the source page.
    }
  });

  if (!allotmentDate) {
    const description = $("meta[name='description']").attr("content") ?? "";
    const dateMatch = description.match(/allotment was out on ([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
    allotmentDate = isoDate(dateMatch?.[1]);
  }

  return { allotmentDate, registrar };
}

async function fetchIpoJiIpos() {
  const sourcePages: Array<{ url: string; status: IpoStatus }> = [
    { url: "https://www.ipoji.com/ipo/current-ipo", status: "open" },
    { url: "https://www.ipoji.com/sme-ipo/current-ipo", status: "open" },
    { url: "https://www.ipoji.com/ipo/upcoming-ipo", status: "upcoming" },
    { url: "https://www.ipoji.com/sme-ipo/upcoming-ipo", status: "upcoming" },
    { url: "https://www.ipoji.com/ipo/listed-ipo", status: "listed" },
    { url: "https://www.ipoji.com/sme-ipo/listed-ipo", status: "listed" }
  ];
  const htmlPages = await Promise.all(
    sourcePages.map((page) =>
      fetchHtml(page.url)
        .then((html) => ({ html, status: page.status }))
        .catch(() => ({ html: "", status: page.status }))
    )
  );
  const rows = htmlPages.flatMap((page) =>
    page.html ? parseIpoJiListedRows(page.html, page.status) : []
  );
  const start = recentWindowStart();
  const seen = new Set<string>();
  const recentRows = rows.filter((row) => {
    const close = new Date(row.closeDate);
    const key = normalizeKey(row.name);

    if (!row.closeDate || Number.isNaN(close.getTime()) || close < start || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return Promise.all(
    recentRows.map(async (row) => {
      const info = row.allotmentPath
        ? await fetchHtml(ipoJiUrl(row.allotmentPath))
            .then(parseIpoJiAllotmentInfo)
            .catch(() => ({ allotmentDate: "", registrar: "" }))
        : { allotmentDate: "", registrar: "" };
      const allotmentDate = info.allotmentDate || estimateAllotmentDate(row.closeDate, row.status);
      const registrar = info.registrar || "Registrar to confirm";

      return {
        id: slugify(`${row.name}-${row.openDate}`),
        name: row.name,
        issuePriceMax: upperPrice(row.priceBand, null),
        lotSize: 0,
        openDate: row.openDate,
        closeDate: row.closeDate,
        allotmentDate,
        listingDate: estimateListingDate(row.closeDate),
        registrar,
        allotmentUrl: registrarUrl(registrar),
        allotmentStatusText: allotmentDate ? `Out: ${shortDateText(allotmentDate)}` : "Out",
        status: row.status,
        allotmentAvailability: availabilityFrom(row.status, allotmentDate),
        gmp: 0,
        gmpLastUpdated: "",
        dataSource: "IPO Ji"
      };
    })
  );
}

function monthSlug(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long" })
    .format(date)
    .toLowerCase();
}

function monthCalendarUrls() {
  const now = new Date();
  return [-1, 0, 1].map((offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `https://ipowatch.in/ipo-calendar-${monthSlug(date)}-${date.getFullYear()}/`;
  });
}

function mergeIpos(primary: Ipo[], secondary: Ipo[]) {
  const merged = new Map<string, Ipo>();

  for (const ipo of secondary) {
    merged.set(normalizeKey(ipo.name), ipo);
  }

  for (const ipo of primary) {
    const key = normalizeKey(ipo.name);
    const existing = merged.get(key);
    merged.set(key, {
      ...(existing ?? {}),
      ...ipo,
      openDate: existing?.openDate || ipo.openDate || "",
      closeDate: existing?.closeDate || ipo.closeDate || "",
      allotmentDate: existing?.allotmentDate || ipo.allotmentDate,
      listingDate: existing?.listingDate || ipo.listingDate,
      issuePriceMax: ipo.issuePriceMax || existing?.issuePriceMax || 0,
      status: ipo.status || existing?.status || "upcoming",
      allotmentAvailability:
        existing?.allotmentAvailability ?? ipo.allotmentAvailability,
      dataSource: "IPOWatch"
    });
  }

  return Array.from(merged.values());
}

function mergeAllotmentInfo(ipos: Ipo[], allotments: IpoWatchAllotmentRow[]) {
  const byName = new Map(allotments.map((row) => [normalizeKey(row.name), row]));

  return ipos.map((ipo) => {
    const key = normalizeKey(ipo.name);
    const direct = byName.get(key);
    const fuzzyMatches = allotments.filter((candidate) => {
        const candidateKey = normalizeKey(candidate.name);
        return key.includes(candidateKey) || candidateKey.includes(key);
      });
    const row =
      [direct, ...fuzzyMatches].find((candidate) => candidate?.releaseStatus) ??
      direct ??
      fuzzyMatches[0];

    if (!row) return ipo;

    const parsedAllotment = new Date(row.allotmentDate.replace(",", ""));
    const allotmentDate = Number.isNaN(parsedAllotment.getTime())
      ? ipo.allotmentDate
      : parsedAllotment.toISOString().slice(0, 10);

    return {
      ...ipo,
      allotmentDate,
      allotmentAvailability: availabilityFrom(ipo.status, allotmentDate),
      registrar: row.registrar,
      allotmentUrl: urlMatchesRegistrar(row.allotmentUrl, row.registrar)
        ? row.allotmentUrl
        : registrarUrl(row.registrar),
      allotmentStatusText: row.releaseStatus
    };
  });
}

function normalizeIpoGuru(row: IpoGuruRow): Ipo | null {
  if (!row.name) return null;
  const status = statusFrom(row.status);
  const issuePriceMax = upperPrice(row.price_band, row.issue_price);
  const allotmentDate = row.allotment_date ?? "";

  return {
    id: slugify(`${row.name}-${row.open_date ?? ""}`),
    name: row.name,
    symbol: row.symbol,
    issuePriceMin: numberFrom(row.price_band),
    issuePriceMax,
    lotSize: numberFrom(row.lot_size),
    openDate: row.open_date ?? "",
    closeDate: row.close_date ?? "",
    allotmentDate,
    listingDate: row.listing_date ?? "",
    registrar: row.registrar ?? "Registrar unavailable",
    status,
    allotmentAvailability: availabilityFrom(status, allotmentDate),
    gmp: numberFrom(row.gmp?.price),
    gmpLastUpdated: row.gmp?.updated_at ?? undefined,
    dataSource: "IPO Guru"
  };
}

function normalizeIpoAlerts(row: IpoAlertsRow): Ipo | null {
  if (!row.name) return null;
  const status = statusFrom(row.status);
  const issuePriceMax = upperPrice(row.priceRange, null);
  const gmp =
    row.gmp?.aggregations?.median ??
    row.gmp?.aggregations?.mode ??
    row.gmp?.aggregations?.mean ??
    0;

  return {
    id: row.id ?? row.slug ?? slugify(row.name),
    name: row.name,
    symbol: row.symbol,
    issuePriceMin: numberFrom(row.priceRange),
    issuePriceMax,
    lotSize: row.minQty ?? 0,
    openDate: row.startDate ?? "",
    closeDate: row.endDate ?? "",
    allotmentDate: "",
    listingDate: row.listingDate ?? "",
    registrar: "Registrar unavailable",
    status,
    allotmentAvailability: availabilityFrom(status, undefined),
    gmp,
    gmpLastUpdated: row.gmp?.lastUpdatedAt,
    dataSource: "ipoalerts"
  };
}

export async function fetchIpoGuruIpos(apiKey: string) {
  const payload = await fetchJson<{ data?: IpoGuruRow[] }>(
    "https://www.ipoguru.in/api/v1/ipos",
    { "X-API-KEY": apiKey }
  );

  return (payload.data ?? []).map(normalizeIpoGuru).filter(Boolean) as Ipo[];
}

export async function fetchIpoAlertsIpos(apiKey: string) {
  const payload = await fetchJson<{ responseBody?: { data?: IpoAlertsRow[] }; data?: IpoAlertsRow[] }>(
    "https://api.ipoalerts.in/ipos?includeGmp=true",
    { "x-api-key": apiKey }
  );

  return (payload.responseBody?.data ?? payload.data ?? [])
    .map(normalizeIpoAlerts)
    .filter(Boolean) as Ipo[];
}

export async function fetchIpoWatchIpos() {
  const [gmpHtml, allotmentHtml, ipo360Html, ...calendarResults] = await Promise.all([
    fetchHtml("https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/"),
    fetchHtml("https://ipowatch.in/ipo-allotment-status-how-to-check/").catch(
      () => ""
    ),
    fetchHtml("https://www.ipo360.in/allotment-status").catch(() => ""),
    ...monthCalendarUrls().map((url) =>
      fetchHtml(url).catch(() => "")
    )
  ]);
  const gmpIpos = parseIpoWatchRows(gmpHtml).map(rowToIpo);
  const calendarIpos = calendarResults.flatMap((html) =>
    html ? parseIpoWatchCalendarRows(html) : []
  );
  const ipoJiIpos = await fetchIpoJiIpos().catch(() => []);
  const allotments = [
    ...(allotmentHtml ? parseIpoWatchAllotmentRows(allotmentHtml) : []),
    ...(ipo360Html ? parseIpo360AllotmentRows(ipo360Html) : [])
  ];
  const merged = mergeAllotmentInfo(
    mergeIpos(gmpIpos, [...calendarIpos, ...ipoJiIpos]),
    allotments
  );

  if (!merged.length) {
    throw new Error("IPOWatch returned no IPO rows");
  }

  return merged;
}
