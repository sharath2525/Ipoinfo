import type { AllotmentStatus } from "@/lib/types";

export type OfficialResultSignal =
  | "record"
  | "not_found"
  | "captcha"
  | "pending"
  | "unavailable";

type OfficialResultInput = {
  signal: OfficialResultSignal;
  appliedQuantity?: number;
  allottedQuantity?: number;
  applicationNo?: string;
  applicantName?: string;
  message?: string;
};

export type OfficialResultDecision = {
  status: AllotmentStatus;
  liveStatus: string;
  explanation: string;
};

export function classifyOfficialResult({
  signal,
  appliedQuantity = 0,
  allottedQuantity = 0,
  applicationNo,
  applicantName,
  message,
}: OfficialResultInput): OfficialResultDecision {
  if (signal === "captcha") {
    return {
      status: "captcha_required",
      liveStatus: "Official CAPTCHA required",
      explanation: message || "Complete the registrar CAPTCHA to continue this check.",
    };
  }

  if (signal === "pending") {
    return {
      status: "pending",
      liveStatus: "Result pending",
      explanation: message || "The registrar has not published a final result yet. Please retry later.",
    };
  }

  if (signal === "not_found") {
    return {
      status: "not_applied",
      liveStatus: "Not applied",
      explanation:
        message || "The official registrar explicitly confirmed that no application exists for this PAN and IPO.",
    };
  }

  if (signal === "unavailable") {
    return {
      status: "unavailable",
      liveStatus: "Application could not be verified",
      explanation:
        message || "The registrar did not return enough information to confirm your application. Please retry.",
    };
  }

  const hasApplicationEvidence = Boolean(
    appliedQuantity > 0 || allottedQuantity > 0 || applicationNo?.trim() || applicantName?.trim(),
  );

  if (!hasApplicationEvidence) {
    return {
      status: "unavailable",
      liveStatus: "Application could not be verified",
      explanation:
        "The registrar response was incomplete, so the app did not guess whether you applied. Please retry.",
    };
  }

  if (allottedQuantity > 0) {
    return {
      status: "allotted",
      liveStatus: "Shares allotted",
      explanation: message || "The official registrar returned an allotted quantity.",
    };
  }

  return {
    status: "not_allotted",
    liveStatus: "Not allotted",
    explanation: message || "The application was found, but the allotted quantity is zero.",
  };
}

export function containsExplicitNoRecord(message: string | undefined) {
  if (!message) return false;
  const normalized = message.replace(/\s+/g, " ").trim();

  // A generic "record not found" can also mean a stale issue, session or parser.
  // Only wording tied explicitly to this PAN/application may prove Not Applied.
  return /\b(?:no\s+application(?:\s+record)?\s+(?:exists|found)\s+for\s+(?:this\s+)?pan|application(?:\s+record)?\s+for\s+(?:this\s+)?pan\s+(?:was\s+)?not\s+found|pan\s+(?:number\s+)?(?:was\s+)?not\s+found)\b/i.test(
    normalized
  );
}
