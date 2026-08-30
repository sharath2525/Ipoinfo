import * as cheerio from "cheerio";
import { isValidPan, normalizePan } from "@/lib/pan";
import { getIpoDataProvider } from "@/lib/providers/ipo-provider";
import { classifyOfficialResult } from "@/lib/providers/allotment-result";
import type { AllotmentResult, Ipo } from "@/lib/types";

type RequestBody = {
  ipoId?: string;
  pan?: string;
  captchaToken?: string;
  captchaAnswer?: string;
};

export const dynamic = "force-dynamic";

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

async function bigshareCompanyId(ipo: Ipo) {
  const response = await fetch("https://ipo.bigshareonline.com/ipo_status.html", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Bigshare issue list returned ${response.status}`);
  }

  const $ = cheerio.load(await response.text());
  const target = normalizeKey(ipo.name);
  const options = $("#ddlCompany option")
    .map((_, option) => ({
      id: $(option).attr("value")?.trim() ?? "",
      name: $(option).text().trim()
    }))
    .get()
    .filter((option) => option.id && option.id !== "--Select Company--");

  const direct = options.find((option) => normalizeKey(option.name) === target);
  if (direct) return direct.id;

  const fuzzy = options.filter((option) => {
    const candidate = normalizeKey(option.name);
    return candidate.includes(target) || target.includes(candidate);
  });

  return fuzzy.length === 1 ? fuzzy[0].id : undefined;
}

function resultFromBigsharePayload(
  ipo: Ipo,
  pan: string,
  payload: {
    APPLICATION_NO?: string;
    DPID?: string;
    Name?: string;
    APPLIED?: string;
    ALLOTED?: string;
    Status?: string;
    Message?: string;
    Records?: Array<{
      APPLICATION_NO?: string;
      DPID?: string;
      Name?: string;
      APPLIED?: string;
      ALLOTED?: string;
    }>;
  }
): AllotmentResult {
  const checkedAt = new Date().toISOString();
  const record = payload.Records?.[0] ?? payload;
  const appliedQuantity = numberFrom(record.APPLIED);
  const allottedQuantity = numberFrom(record.ALLOTED);
  const officialStatus = String(payload.Status ?? "").trim().toUpperCase();

  if (officialStatus === "CAPTCHA") {
    const decision = classifyOfficialResult({
      signal: "captcha",
      message: payload.Message ?? "The CAPTCHA was incorrect or expired. Load a fresh one and retry."
    });
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: decision.status,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl,
      actionLabel: "Retry CAPTCHA",
      liveStatus: decision.liveStatus,
      checkedAt,
      error: decision.explanation
    };
  }

  if (officialStatus === "RATELIMIT" || officialStatus === "WARMING") {
    const decision = classifyOfficialResult({
      signal: "pending",
      message:
        payload.Message ??
        (officialStatus === "RATELIMIT"
          ? "Bigshare is receiving too many checks. Please wait briefly and retry."
          : "Bigshare is preparing the result service. Please retry shortly.")
    });
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: decision.status,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl,
      actionLabel: "Open Bigshare",
      liveStatus: decision.liveStatus,
      checkedAt,
      error: decision.explanation
    };
  }

  if (officialStatus === "NOTFOUND") {
    const decision = classifyOfficialResult({
      signal: "not_found",
      message: "Bigshare explicitly returned no application record for this PAN and IPO."
    });
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: decision.status,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl,
      actionLabel: "Verify on Bigshare",
      liveStatus: decision.liveStatus,
      checkedAt,
      error: decision.explanation
    };
  }

  if (officialStatus !== "OK") {
    const decision = classifyOfficialResult({
      signal: "unavailable",
      message:
        payload.Message ??
        "Bigshare returned an unexpected response. Load a fresh CAPTCHA and retry."
    });
    return {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan,
      status: decision.status,
      registrar: ipo.registrar,
      actionUrl: ipo.allotmentUrl,
      actionLabel: "Open Bigshare",
      liveStatus: decision.liveStatus,
      checkedAt,
      error: decision.explanation
    };
  }

  const applicantName = record.Name || undefined;
  const applicationNo = record.APPLICATION_NO || undefined;
  const decision = classifyOfficialResult({
    signal: "record",
    appliedQuantity,
    allottedQuantity,
    applicantName,
    applicationNo
  });

  return {
    ipoId: ipo.id,
    ipoName: ipo.name,
    pan,
    status: decision.status,
    appliedQuantity,
    allottedQuantity,
    applicantName,
    applicationNo,
    registrar: ipo.registrar,
    checkedAt,
    liveStatus: decision.liveStatus,
    error: decision.status === "unavailable" ? decision.explanation : undefined
  };
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const pan = normalizePan(body.pan ?? "");

  if (!body.ipoId) {
    return Response.json({ error: "IPO is required." }, { status: 400 });
  }

  if (!isValidPan(pan)) {
    return Response.json({ error: "Valid PAN is required." }, { status: 400 });
  }

  if (!body.captchaToken || !body.captchaAnswer) {
    return Response.json({ error: "CAPTCHA answer is required." }, { status: 400 });
  }

  let ipo: Ipo | undefined;

  try {
    ipo = (await getIpoDataProvider().listRecentIpos()).find(
      (item) => item.id === body.ipoId
    );
  } catch {
    return Response.json(
      {
        error: "Could not load the recent IPO list. Please retry shortly."
      },
      { status: 502 }
    );
  }

  if (!ipo) {
    return Response.json({ error: "IPO not found." }, { status: 404 });
  }

  if (!ipo.registrar.toLowerCase().includes("bigshare")) {
    return Response.json(
      { error: "This CAPTCHA route currently supports Bigshare only." },
      { status: 400 }
    );
  }

  let companyId: string | undefined;

  try {
    companyId = await bigshareCompanyId(ipo);
  } catch {
    return Response.json(
      {
        error: "Could not load Bigshare's current IPO list. Please retry shortly."
      },
      { status: 502 }
    );
  }

  if (!companyId) {
    return Response.json(
      { error: "This IPO is not available in Bigshare's active company list yet." },
      { status: 404 }
    );
  }

  let response: Response;

  try {
    response = await fetch("https://ipo.bigshareonline.com/Data.aspx/FetchIpodetails", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        Applicationno: "",
        Company: companyId,
        SelectionType: "PN",
        PanNo: pan,
        txtcsdl: "",
        txtDPID: "",
        txtClId: "",
        ddlType: "0",
        lang: "en",
        CaptchaToken: body.captchaToken,
        CaptchaAnswer: body.captchaAnswer,
        ResultToken: ""
      }),
      cache: "no-store"
    });
  } catch {
    return Response.json(
      {
        error: "Bigshare could not complete the request. Please retry with a fresh CAPTCHA."
      },
      { status: 502 }
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Bigshare is temporarily unavailable. Please retry shortly." },
      { status: 502 }
    );
  }

  try {
    const payload = (await response.json()) as {
      d: Parameters<typeof resultFromBigsharePayload>[2];
    };
    return Response.json({ result: resultFromBigsharePayload(ipo, pan, payload.d) });
  } catch {
    return Response.json(
      { error: "Bigshare returned an unreadable response." },
      { status: 502 }
    );
  }
}
