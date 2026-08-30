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
      liveStatus: "No application record found",
      explanation:
        message || "The official registrar explicitly returned no application record for this PAN and IPO.",
    };
  }

  if (signal === "unavailable") {
    return {
      status: "unavailable",
      liveStatus: "Could not confirm status",
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
      liveStatus: "Could not confirm status",
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
  return /\b(no\s+(?:application\s+)?records?|no\s+application|application\s+(?:record\s+)?not\s+found|record\s+not\s+found)\b/i.test(
    message,
  );
}
