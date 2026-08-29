import { createCipheriv } from "crypto";
import * as cheerio from "cheerio";
import type { AllotmentResult, Ipo } from "@/lib/types";

export interface AllotmentProvider {
  registrar: string;
  check(ipo: Ipo, pan: string): Promise<AllotmentResult>;
}

type KfinIssue = {
  clientId: string;
  name: string;
};

const MUFG_BASE_URL = "https://in.mpms.mufg.com/Initial_Offer/";
const KFIN_BUNDLE_URL = "https://ipostatus.kfintech.com/static/js/main.59c23bd9.js";
const KFIN_QUERY_URL =
  "https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=";

function normalizeKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\blimited\b/g, "")
    .replace(/\bltd\b/g, "")
    .replace(/\bsme\b/g, "")
    .replace(/\bipo\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberFrom(value?: string | number | null) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Registrar returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function parseXmlTables(xmlText: string) {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const rows: Array<Record<string, string>> = [];

  $("Table").each((_, table) => {
    const row: Record<string, string> = {};
    $(table)
      .children()
      .each((__, child) => {
        row[child.tagName.toLowerCase()] = $(child).text().trim();
      });
    rows.push(row);
  });

  return rows;
}

async function loadMufgCompanies() {
  const payload = await postJson<{ d: string }>(`${MUFG_BASE_URL}IPO.aspx/GetDetails`, {});

  return parseXmlTables(payload.d).map((row) => ({
    id: row.company_id,
    name: row.companyname
  }));
}

function encryptMufgToken(token: string) {
  const key = Buffer.from("8080808080808080", "utf8");
  const iv = Buffer.from("8080808080808080", "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return cipher.update(token, "utf8", "base64") + cipher.final("base64");
}

function findIssueId<T extends { name: string }>(
  issues: T[],
  ipoName: string,
  getId: (issue: T) => string | undefined
) {
  const target = normalizeKey(ipoName);
  const direct = issues.find((issue) => normalizeKey(issue.name) === target);
  const fuzzy = issues.find((issue) => {
    const candidate = normalizeKey(issue.name);
    return candidate.includes(target) || target.includes(candidate);
  });

  const match = direct ?? fuzzy;
  return match ? getId(match) : undefined;
}

function resultFromRegistrarRows(
  ipo: Ipo,
  pan: string,
  rows: Array<Record<string, string>>,
  checkedAt: string
): AllotmentResult {
  if (!rows.length) {
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: "not_applied",
      registrar: ipo.registrar,
      checkedAt,
      liveStatus: "Not applied",
      error: "The registrar did not find an application for this PAN."
    };
  }

  const first = rows[0];
  const allottedQuantity = numberFrom(
    first.allot ?? first.alloted ?? first.allotted ?? first.securitiesallotted
  );
  const appliedQuantity = numberFrom(first.shares ?? first.applied ?? first.appliedshares);
  const status = allottedQuantity > 0 ? "allotted" : "not_allotted";

  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    pan,
    status,
    allottedQuantity,
    appliedQuantity,
    applicantName: first.name1 ?? first.name,
    applicationNo: first.application_no ?? first.applno ?? first.appl_no,
    amountAdjusted: numberFrom(first.amtadj),
    refundAmount: numberFrom(first.rfndamt),
    registrar: ipo.registrar,
    checkedAt,
    liveStatus:
      status === "allotted"
        ? `Allotted ${allottedQuantity} shares`
        : "Applied, not allotted"
  };
}

async function checkMufg(ipo: Ipo, pan: string, checkedAt: string) {
  const companies = await loadMufgCompanies();
  const companyId = findIssueId(companies, ipo.name, (company) => company.id);

  if (!companyId) {
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: "unavailable" as const,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl ?? `${MUFG_BASE_URL}public-issues.html`,
      actionLabel: "Open official form",
      liveStatus: "Result not active in registrar list",
      checkedAt,
      error: "The registrar has removed this IPO from its active same-page lookup list."
    };
  }

  const tokenPayload = await postJson<{ d: string }>(
    `${MUFG_BASE_URL}IPO.aspx/generateToken`,
    {}
  );
  const payload = await postJson<{ d: string }>(`${MUFG_BASE_URL}IPO.aspx/SearchOnPan`, {
    clientid: companyId,
    PAN: pan,
    IFSC: "",
    CHKVAL: "1",
    token: encryptMufgToken(tokenPayload.d)
  });

  return resultFromRegistrarRows(ipo, pan, parseXmlTables(payload.d), checkedAt);
}

async function loadKfinIssues() {
  const response = await fetch(KFIN_BUNDLE_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`KFinTech bundle returned ${response.status}`);
  }

  const bundle = await response.text();
  const matches = bundle.matchAll(/\{"clientId":"(\d+)","name":"([^"]+)"\}/g);

  return Array.from(matches, (match) => ({
    clientId: match[1] ?? "",
    name: match[2] ?? ""
  })).filter((issue) => issue.clientId && issue.name);
}

function resultFromKfinPayload(
  ipo: Ipo,
  pan: string,
  payload: unknown,
  checkedAt: string
): AllotmentResult {
  const data: Array<Record<string, unknown>> =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: Array<Record<string, unknown>> }).data
      : [];

  if (!data.length) {
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: "not_applied",
      registrar: ipo.registrar,
      checkedAt,
      liveStatus: "Not applied",
      error: "The registrar did not find an application for this PAN."
    };
  }

  const first = data[0] ?? {};
  const allottedQuantity = numberFrom(
    String(first.allot ?? first.allotted ?? first.ALLOT ?? first.Allotted ?? "")
  );
  const appliedQuantity = numberFrom(
    String(first.applied ?? first.shares ?? first.SHARES ?? "")
  );

  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    pan,
    status: allottedQuantity > 0 ? "allotted" : "not_allotted",
    allottedQuantity,
    appliedQuantity,
    applicantName: String(first.name ?? first.NAME1 ?? first.Name ?? ""),
    applicationNo: String(first.application_no ?? first.ApplicationNo ?? ""),
    registrar: ipo.registrar,
    checkedAt,
    liveStatus:
      allottedQuantity > 0
        ? `Allotted ${allottedQuantity} shares`
        : "Not allotted / no allotment record"
  };
}

async function checkKfin(ipo: Ipo, pan: string, checkedAt: string) {
  const issues = await loadKfinIssues();
  const clientId = findIssueId(issues, ipo.name, (issue) => issue.clientId);

  if (!clientId) {
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: "unavailable" as const,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl ?? "https://ipostatus.kfintech.com/",
      actionLabel: "Open official form",
      liveStatus: "Result not active in registrar list",
      checkedAt,
      error: "The registrar has removed this IPO from its active same-page lookup list."
    };
  }

  const response = await fetch(`${KFIN_QUERY_URL}pan`, {
    headers: {
      reqparam: pan,
      client_id: clientId
    },
    cache: "no-store"
  });

  if (response.status === 404) {
    return resultFromKfinPayload(ipo, pan, { data: [] }, checkedAt);
  }

  if (!response.ok) {
    throw new Error(`KFinTech returned ${response.status}`);
  }

  return resultFromKfinPayload(ipo, pan, await response.json(), checkedAt);
}

function captchaRequired(ipo: Ipo, pan: string, checkedAt: string): AllotmentResult {
  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    pan,
    status: "captcha_required",
    registrar: ipo.registrar,
    actionUrl: ipo.allotmentUrl ?? "https://www.bseindia.com/investors/appli_check.aspx",
    actionLabel: "Open official form",
    liveStatus: "CAPTCHA required",
    checkedAt,
    error: "This registrar requires CAPTCHA, so automatic same-page checking is blocked."
  };
}

class RealAllotmentProvider implements AllotmentProvider {
  constructor(public registrar: string) {}

  async check(ipo: Ipo, pan: string): Promise<AllotmentResult> {
    const checkedAt = new Date().toISOString();
    const registrar = ipo.registrar.toLowerCase();
    const releaseStatus = ipo.allotmentStatusText?.trim();
    const isResultOut = releaseStatus
      ? releaseStatus.toLowerCase().includes("out")
      : ipo.allotmentAvailability === "available";

    if (!isResultOut) {
      return {
        ipoId: ipo.id,
        ipoName: ipo.name,
        pan,
        status: "pending",
        registrar: ipo.registrar,
        actionUrl: ipo.allotmentUrl,
        actionLabel: "Open status page",
        liveStatus: releaseStatus ?? "Allotment result is pending",
        checkedAt,
        error: "Allotment result is not out yet."
      };
    }

    if (registrar.includes("mufg") || registrar.includes("intime")) {
      return checkMufg(ipo, pan, checkedAt);
    }

    if (registrar.includes("kfin")) {
      return checkKfin(ipo, pan, checkedAt);
    }

    if (registrar.includes("bigshare")) {
      return captchaRequired(ipo, pan, checkedAt);
    }

    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: "unavailable",
      registrar: this.registrar,
      actionUrl: ipo.allotmentUrl,
      actionLabel: "Open official form",
      liveStatus: "Direct registrar check not integrated",
      checkedAt,
      error: "This source does not expose a same-page allotment check yet."
    };
  }
}

export function getAllotmentProvider(registrar: string): AllotmentProvider {
  return new RealAllotmentProvider(registrar);
}
