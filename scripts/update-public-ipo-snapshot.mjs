import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const SOURCE_ROOT = "https://dash.ipopremium.in";
const USER_AGENT = "Mozilla/5.0 (compatible; IPO Fast Check/1.0; +https://ipoinfo.online)";
const PAGE_SIZE = 100;

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function csrfToken(html) {
  return (
    html.match(/d\._token\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1] ??
    html.match(/<meta\s+[^>]*name=['\"]csrf-token['\"][^>]*content=['\"]([^'\"]+)/i)?.[1]
  );
}

async function sourceSession() {
  const response = await fetch(`${SOURCE_ROOT}/`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Source page returned ${response.status}`);

  const html = await response.text();
  const token = csrfToken(html);
  if (!token) throw new Error("Source CSRF token was unavailable");
  return { token, cookie: cookieHeader(response) };
}

async function fetchPage(session, status, start) {
  const body = new URLSearchParams({
    draw: "1",
    start: String(start),
    length: String(PAGE_SIZE),
    _token: session.token,
    all: "true",
    eq: "false",
    sme: "false",
    all_ipos: String(status === "all"),
    upcoming_ipos: String(status === "upcoming"),
    open_ipos: String(status === "open"),
    closed_ipos: String(status === "closed")
  });
  const response = await fetch(`${SOURCE_ROOT}/ipo`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      Origin: SOURCE_ROOT,
      Referer: `${SOURCE_ROOT}/`,
      Cookie: session.cookie
    },
    body,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${status} page at ${start} returned ${response.status}`);
  return response.json();
}

function numberFrom(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function dateOnly(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(/Sept/i, "Sep"));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function cleanName(value) {
  const text = cheerio.load(String(value ?? "")).text();
  const name = text
    .replace(/\b(?:closing|closes?|opening|opens?)\s+today\b|\bopen\s+now\b|\bapply\s+now\b|\btentative\s+dates?\b/gi, " ")
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

function normalize(row, capturedAt) {
  const rawName = cheerio.load(String(row.name ?? "")).text().replace(/\s+/g, " ").trim();
  const name = cleanName(row.name);
  if (!name) return null;

  const minimum = numberFrom(row.min_price);
  const maximum = numberFrom(row.max_price) ?? minimum;
  const gmp = numberFrom(row.premium);
  const closeDate = dateOnly(row.close);
  const today = new Date().toISOString().slice(0, 10);
  const sourceStatus = String(row.current_status ?? "closed").toLowerCase();
  const status = closeDate && closeDate < today ? "closed" : sourceStatus === "open" ? "open" : "upcoming";
  const id = `ipopremium-${row.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    id,
    name,
    ...(row.script_code ? { symbol: String(row.script_code).trim() } : {}),
    marketType: /\bsme\b/i.test(rawName) ? "SME" : "Mainboard",
    ...(minimum ? { issuePriceMin: minimum } : {}),
    issuePriceMax: maximum ?? 0,
    lotSize: numberFrom(row.lot_size) ?? 0,
    openDate: dateOnly(row.open),
    closeDate,
    allotmentDate: dateOnly(row.allotment_date),
    listingDate: dateOnly(row.listing_date),
    registrar: "Registrar to confirm",
    status,
    allotmentAvailability: status === "open" || status === "upcoming" ? "pending" : "unavailable",
    ...(gmp !== undefined ? { gmp, gmpLastUpdated: capturedAt } : {}),
    ...(maximum && gmp !== undefined
      ? {
          gmpPercent: (gmp / maximum) * 100,
          estimatedListingPrice: maximum + gmp,
          estimatedListingGain: gmp
        }
      : {}),
    dataSource: "IPO Premium snapshot"
  };
}

function uniqueRows(rows) {
  return [...new Map(rows.filter(Boolean).map((row) => [row.id, row])).values()];
}

function indiaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchAllClosed(session) {
  const first = await fetchPage(session, "closed", 0);
  const total = Number(first.recordsFiltered ?? first.recordsTotal ?? first.data?.length ?? 0);
  const starts = [];
  for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) starts.push(start);

  const pages = [first];
  for (let index = 0; index < starts.length; index += 3) {
    pages.push(...(await Promise.all(starts.slice(index, index + 3).map((start) => fetchPage(session, "closed", start)))));
  }
  return pages.flatMap((page) => page.data ?? []);
}

async function main() {
  const session = await sourceSession();
  const capturedAt = new Date().toISOString();
  const [all, allClosed] = await Promise.all([
    fetchPage(session, "all", 0),
    fetchAllClosed(session)
  ]);
  const normalizeRows = (rows) => uniqueRows(rows.map((row) => normalize(row, capturedAt)));
  const current = normalizeRows(all.data ?? []);
  const closed = normalizeRows(allClosed);
  const today = indiaDate();
  const openCount = current.filter(
    (row) => row.openDate && row.openDate <= today && (!row.closeDate || row.closeDate >= today)
  ).length;
  const upcomingCount = current.filter((row) => row.openDate && row.openDate > today).length;

  const dataDirectory = fileURLToPath(new URL("../data/", import.meta.url));
  await Promise.all([
    writeFile(`${dataDirectory}current-ipo-backup.json`, `${JSON.stringify(current, null, 2)}\n`),
    writeFile(`${dataDirectory}closed-ipo-backup.json`, `${JSON.stringify(closed, null, 2)}\n`),
    writeFile(
      `${dataDirectory}ipo-snapshot-meta.json`,
      `${JSON.stringify(
        {
          capturedAt,
          current: current.length,
          open: openCount,
          upcoming: upcomingCount,
          closed: closed.length
        },
        null,
        2
      )}\n`
    )
  ]);
  console.log(`Saved ${current.length} current/recent rows and ${closed.length} closed rows at ${capturedAt}.`);
}

await main();
