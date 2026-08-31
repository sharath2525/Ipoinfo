"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import closedIpoSeed from "@/data/closed-ipo-backup.json";
import { isValidPan, normalizePan } from "@/lib/pan";
import type { AllotmentResult, BatchCheckResponse, GmpRow, Ipo } from "@/lib/types";

const gmpFilters = ["open", "upcoming", "closed"] as const;
const gmpViewModes = [
  "mainboard_first",
  "sme_first",
  "mainboard_only",
  "sme_only",
  "date_priority"
] as const;
const closedPageSizes = [25, 50, 100] as const;
const REMEMBERED_PAN_KEY = "ipo-fast-check:remembered-pan";
const PUBLIC_FEED_CACHE_KEY = "ipo-fast-check:public-feed-v1";
const PUBLIC_FEED_CACHE_MAX_AGE = 6 * 60 * 60 * 1000;

type PublicFeed = {
  ipos: Ipo[];
  gmp: GmpRow[];
};

type StoredPublicFeed = PublicFeed & {
  cachedAt: number;
};

type CaptchaState = {
  token?: string;
  image?: string;
  answer: string;
  loading?: boolean;
  error?: string;
};

function rupee(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function priceBand(ipo: Ipo) {
  const minimum = ipo.issuePriceMin ?? ipo.issuePriceMax;
  if (!minimum && !ipo.issuePriceMax) return "TBA";
  if (minimum === ipo.issuePriceMax) return rupee(ipo.issuePriceMax);
  return `${rupee(minimum)} - ${rupee(ipo.issuePriceMax)}`;
}

function timeLabel(value?: string) {
  if (!value) return "Not updated";

  const dayTimeMatch = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{1,2}):(\d{2})$/);
  if (dayTimeMatch) {
    const [, day, month, hour, minute] = dayTimeMatch;
    return `${day} ${month}, ${hour}:${minute}`;
  }

  const dayMonthMatch = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (dayMonthMatch) {
    const [, day, month] = dayMonthMatch;
    return `${day} ${month}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function dateLabel(value?: string) {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium"
  }).format(date);
}

function statusLabel(value: string) {
  if (value === "allotment_out") return "Allotment Result Out";
  if (value === "available") return "Allotment Out";
  if (value === "expected_soon") return "Expected Soon";
  if (value === "captcha_required") return "CAPTCHA Required";
  if (value === "not_applied") return "Not Applied";
  if (value === "unavailable") return "Could Not Verify";
  if (value === "error") return "Check Failed";

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(value: string) {
  if (
    value === "allotted" ||
    value === "allotment_out" ||
    value === "available" ||
    value === "open"
  ) {
    return "good";
  }

  if (value === "not_allotted") return "bad";
  if (
    value === "not_applied" ||
    value === "unavailable" ||
    value === "pending" ||
    value === "expected_soon" ||
    value === "captcha_required"
  ) {
    return "warn";
  }
  return "warn";
}

function hasResultFacts(result: AllotmentResult) {
  return Boolean(
    result.status === "allotted" ||
      result.status === "not_allotted" ||
      result.appliedQuantity !== undefined ||
      result.allottedQuantity !== undefined ||
      result.applicationNo ||
      result.applicantName
  );
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateTime(value?: string) {
  return parseDate(value)?.getTime() ?? 0;
}

function sortGmpRows(rows: GmpRow[]) {
  return [...rows].sort((first, second) => {
    if (first.status === "upcoming") {
      return dateTime(first.openDate) - dateTime(second.openDate);
    }

    return (
      dateTime(second.closeDate) - dateTime(first.closeDate) ||
      dateTime(second.listingDate) - dateTime(first.listingDate)
    );
  });
}

function gmpGroup(row: GmpRow): "open" | "upcoming" | "closed" {
  if (row.status === "open") return "open";
  if (row.status === "upcoming") return "upcoming";
  return "closed";
}

function gmpViewModeLabel(
  mode: (typeof gmpViewModes)[number],
  filter: "open" | "upcoming" | "closed"
) {
  if (mode === "mainboard_first") return "Mainboard first";
  if (mode === "sme_first") return "SME first";
  if (mode === "mainboard_only") return "Mainboard only";
  if (mode === "sme_only") return "SME only";
  return filter === "upcoming" ? "Opening soon" : "Closing soon";
}

function sortCurrentGmpRows(
  rows: GmpRow[],
  filter: "open" | "upcoming",
  mode: (typeof gmpViewModes)[number]
) {
  const relevantTime = (row: GmpRow) =>
    dateTime(filter === "upcoming" ? row.openDate : row.closeDate);
  const byRelevantDate = (first: GmpRow, second: GmpRow) =>
    relevantTime(first) - relevantTime(second) || first.name.localeCompare(second.name);

  if (mode === "mainboard_only") {
    return rows.filter((row) => row.marketType !== "SME").sort(byRelevantDate);
  }
  if (mode === "sme_only") {
    return rows.filter((row) => row.marketType === "SME").sort(byRelevantDate);
  }
  if (mode === "date_priority") return [...rows].sort(byRelevantDate);

  const preferredMarket = mode === "sme_first" ? "SME" : "Mainboard";
  return [...rows].sort((first, second) => {
    const firstMarket = (first.marketType ?? "Mainboard") === preferredMarket ? 0 : 1;
    const secondMarket = (second.marketType ?? "Mainboard") === preferredMarket ? 0 : 1;
    return firstMarket - secondMarket || byRelevantDate(first, second);
  });
}

function isCompletedIpo(ipo: Ipo) {
  const closeDate = parseDate(ipo.closeDate);
  return (
    ipo.status === "closed" ||
    ipo.status === "listing_soon" ||
    ipo.status === "listed" ||
    (closeDate ? closeDate < new Date() : false)
  );
}

function isLastOrThisMonthResult(ipo: Ipo) {
  const referenceDate = parseDate(ipo.allotmentDate) ?? parseDate(ipo.closeDate);
  if (!referenceDate || !isCompletedIpo(ipo)) return false;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return referenceDate >= start && referenceDate < end;
}

function recentResultsFirst(ipos: Ipo[]) {
  return [...ipos].sort((first, second) => {
    const firstTime =
      parseDate(first.closeDate)?.getTime() ??
      parseDate(first.allotmentDate)?.getTime() ??
      0;
    const secondTime =
      parseDate(second.closeDate)?.getTime() ??
      parseDate(second.allotmentDate)?.getTime() ??
      0;

    return secondTime - firstTime;
  });
}

function paginationWindow(currentPage: number, totalPages: number) {
  const visibleCount = Math.min(3, totalPages);
  const start = Math.max(1, Math.min(currentPage - 1, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

const bundledAllotmentIpos = recentResultsFirst(
  (closedIpoSeed as Ipo[]).filter(isLastOrThisMonthResult)
);

export default function Home() {
  const [activeTab, setActiveTab] = useState<"allotment" | "gmp">("allotment");
  const [ipos, setIpos] = useState<Ipo[]>(bundledAllotmentIpos);
  const [gmpRows, setGmpRows] = useState<GmpRow[]>([]);
  const [selectedIpoId, setSelectedIpoId] = useState(
    bundledAllotmentIpos[0]?.id ?? ""
  );
  const [panInput, setPanInput] = useState("");
  const [panError, setPanError] = useState("");
  const [rememberPan, setRememberPan] = useState(false);
  const [restoredPan, setRestoredPan] = useState(false);
  const [panCopied, setPanCopied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<BatchCheckResponse | null>(null);
  const [captchas, setCaptchas] = useState<Record<string, CaptchaState>>({});
  const [gmpSearch, setGmpSearch] = useState("");
  const [gmpFilter, setGmpFilter] = useState<(typeof gmpFilters)[number]>("open");
  const [gmpViewModeIndex, setGmpViewModeIndex] = useState(0);
  const [closedGmpRows, setClosedGmpRows] = useState<GmpRow[]>([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [closedPage, setClosedPage] = useState(1);
  const [closedPageSize, setClosedPageSize] = useState<(typeof closedPageSizes)[number]>(25);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState("");
  const closedRequestId = useRef(0);
  const gmpResultsTop = useRef<HTMLDivElement>(null);
  const ipoSelectElement = useRef<HTMLSelectElement>(null);
  const panInputElement = useRef<HTMLInputElement>(null);
  const autoCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckKey = useRef("");
  const selectedIpoName = useRef(bundledAllotmentIpos[0]?.name ?? "");

  useEffect(() => {
    try {
      const savedPan = normalizePan(localStorage.getItem(REMEMBERED_PAN_KEY) ?? "");
      if (isValidPan(savedPan)) {
        setPanInput(savedPan);
        setRememberPan(true);
        setRestoredPan(true);
      }
    } catch {
      // Browser storage can be unavailable in private or restricted modes.
    }

    return () => {
      if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    };
  }, []);

  useEffect(() => {
    function applyPublicFeed(data: PublicFeed) {
      if (!Array.isArray(data.ipos) || !Array.isArray(data.gmp)) return false;

      const allotmentChoices = recentResultsFirst(
        data.ipos.filter(isLastOrThisMonthResult)
      );
      const nextChoice =
        allotmentChoices.find((ipo) => ipo.name === selectedIpoName.current) ??
        allotmentChoices[0];

      setIpos(data.ipos);
      setSelectedIpoId(nextChoice?.id ?? "");
      selectedIpoName.current = nextChoice?.name ?? "";
      setGmpRows(data.gmp);
      setLoadError("");
      return data.ipos.length > 0;
    }

    async function loadData() {
      let hasUsableFeed = bundledAllotmentIpos.length > 0;

      try {
        const stored = JSON.parse(
          localStorage.getItem(PUBLIC_FEED_CACHE_KEY) ?? "null"
        ) as StoredPublicFeed | null;
        if (
          stored &&
          Number.isFinite(stored.cachedAt) &&
          Date.now() - stored.cachedAt <= PUBLIC_FEED_CACHE_MAX_AGE
        ) {
          hasUsableFeed = applyPublicFeed(stored) || hasUsableFeed;
        }
      } catch {
        // The bundled list still makes the first screen usable without storage.
      }

      try {
        const response = await fetch("/api/feed");
        const data = (await response.json()) as PublicFeed;

        if (!response.ok) {
          throw new Error("IPO data is temporarily unavailable.");
        }

        hasUsableFeed = applyPublicFeed(data) || hasUsableFeed;
        try {
          localStorage.setItem(
            PUBLIC_FEED_CACHE_KEY,
            JSON.stringify({ ...data, cachedAt: Date.now() } satisfies StoredPublicFeed)
          );
        } catch {
          // Public-feed caching is an optional speed enhancement.
        }
      } catch (error) {
        if (!hasUsableFeed) {
          setLoadError(error instanceof Error ? error.message : "Could not load IPO data.");
        }
      }
    }

    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === "gmp" && gmpFilter === "closed") {
      void loadClosedHistory(closedPage, closedPageSize);
    }
  }, [activeTab, closedPage, closedPageSize, gmpFilter]);

  const filteredGmp = useMemo(() => {
    const sourceRows = gmpFilter === "closed" ? closedGmpRows : gmpRows;
    const matchingRows = sourceRows.filter((row) => {
      const matchesFilter = gmpGroup(row) === gmpFilter;
      const matchesSearch = row.name
        .toLowerCase()
        .includes(gmpSearch.trim().toLowerCase());
      return matchesFilter && matchesSearch;
    });

    if (gmpFilter === "closed") return sortGmpRows(matchingRows);
    return sortCurrentGmpRows(
      matchingRows,
      gmpFilter,
      gmpViewModes[gmpViewModeIndex]
    );
  }, [closedGmpRows, gmpFilter, gmpRows, gmpSearch, gmpViewModeIndex]);

  const selectedIpo = ipos.find((ipo) => ipo.id === selectedIpoId);
  const allotmentIpos = useMemo(
    () => recentResultsFirst(ipos.filter(isLastOrThisMonthResult)),
    [ipos]
  );
  const currentResult = results?.results[0];
  const currentCaptcha = currentResult ? captchas[resultKey(currentResult)] : undefined;
  const closedTotalPages = Math.max(1, Math.ceil(closedTotal / closedPageSize));
  const closedPageNumbers = paginationWindow(closedPage, closedTotalPages);
  const closedRangeStart = closedTotal ? (closedPage - 1) * closedPageSize + 1 : 0;
  const closedRangeEnd = Math.min(closedPage * closedPageSize, closedTotal);

  function resultKey(result: AllotmentResult) {
    return `${result.ipoId}:${result.pan}`;
  }

  function replaceResult(nextResult: AllotmentResult) {
    setResults((current) => {
      if (!current) return current;
      const nextResults = current.results.map((item) =>
        item.ipoId === nextResult.ipoId && item.pan === nextResult.pan ? nextResult : item
      );
      const successfulChecks = nextResults.filter(
        (item) =>
          item.status === "allotted" ||
          item.status === "not_allotted" ||
          item.status === "not_applied"
      ).length;
      const failedChecks = nextResults.filter((item) => item.status === "error").length;

      return {
        ...current,
        results: nextResults,
        successfulChecks,
        failedChecks,
        unavailableChecks: nextResults.length - successfulChecks - failedChecks
      };
    });
  }

  function selectAllotmentIpo(ipo: Ipo) {
    selectedIpoName.current = ipo.name;
    setSelectedIpoId(ipo.id);
    setResults(null);
    setCaptchas({});
    setCheckError("");
    scheduleAutoCheck(panInput, ipo.id);
    requestAnimationFrame(() => panInputElement.current?.focus());
  }

  function scheduleAutoCheck(panValue: string, ipoId: string) {
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    const pan = normalizePan(panValue);
    if (!ipoId || !isValidPan(pan)) return;

    autoCheckTimer.current = setTimeout(() => {
      void checkAllotment(pan, ipoId);
    }, 100);
  }

  async function loadClosedHistory(page: number, pageSize: number) {
    const requestId = ++closedRequestId.current;
    setClosedLoading(true);
    setClosedLoaded(false);
    setClosedError("");
    setClosedGmpRows([]);
    const offset = (page - 1) * pageSize;

    try {
      const response = await fetch(`/api/gmp/history?offset=${offset}&limit=${pageSize}`);
      const data = (await response.json()) as {
        gmp?: GmpRow[];
        total?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Closed IPO history is temporarily unavailable.");
      }

      if (requestId !== closedRequestId.current) return;

      setClosedGmpRows(sortGmpRows(data.gmp ?? []));
      setClosedTotal(data.total ?? 0);
      setClosedLoaded(true);
      if (page > 1) {
        requestAnimationFrame(() => {
          gmpResultsTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (error) {
      if (requestId !== closedRequestId.current) return;
      setClosedError(
        error instanceof Error ? error.message : "Closed IPO history is temporarily unavailable."
      );
    } finally {
      if (requestId === closedRequestId.current) setClosedLoading(false);
    }
  }

  async function checkAllotment(
    panValue = panInput,
    ipoId = selectedIpoId,
    force = false
  ) {
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    setCheckError("");
    setPanError("");
    setResults(null);
    setCaptchas({});

    const pan = normalizePan(panValue);
    const checkKey = `${ipoId}:${pan}`;

    if (!ipoId) {
      setCheckError("Select one IPO.");
      return;
    }

    if (!pan) {
      setPanError("Enter PAN number.");
      return;
    }

    if (!isValidPan(pan)) {
      setPanError("PAN format should be 5 letters, 4 digits, 1 letter.");
      return;
    }

    if (checking || (!force && lastCheckKey.current === checkKey)) return;

    setPanInput(pan);
    setRestoredPan(false);
    setChecking(true);
    lastCheckKey.current = checkKey;
    const ipoReference = ipos.find((ipo) => ipo.id === ipoId);

    try {
      const response = await fetch("/api/allotment/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pans: [pan],
          ipoIds: [ipoId],
          ipoRefs: ipoReference
            ? [
                {
                  id: ipoReference.id,
                  name: ipoReference.name,
                  closeDate: ipoReference.closeDate
                }
              ]
            : undefined
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Allotment check failed.");
      }

      setResults(data as BatchCheckResponse);
      if (rememberPan) {
        try {
          localStorage.setItem(REMEMBERED_PAN_KEY, pan);
        } catch {
          // Remembering PAN is optional and may be blocked by the browser.
        }
      }
    } catch (error) {
      lastCheckKey.current = "";
      setCheckError(error instanceof Error ? error.message : "Unable to complete this check.");
    } finally {
      setChecking(false);
    }
  }

  function updatePan(nextValue: string) {
    const pan = normalizePan(nextValue).replace(/[^A-Z0-9]/g, "").slice(0, 10);
    setPanInput(pan);
    setPanError("");
    setPanCopied(false);
    setRestoredPan(false);
    setResults(null);
    lastCheckKey.current = "";
    scheduleAutoCheck(pan, selectedIpoId);
  }

  function updateRememberPan(enabled: boolean) {
    setRememberPan(enabled);
    if (!enabled) {
      setRestoredPan(false);
      try {
        localStorage.removeItem(REMEMBERED_PAN_KEY);
      } catch {
        // The browser may block local storage.
      }
    } else if (isValidPan(panInput)) {
      try {
        localStorage.setItem(REMEMBERED_PAN_KEY, normalizePan(panInput));
      } catch {
        // The browser may block local storage.
      }
    }
  }

  async function copyPan() {
    if (!isValidPan(panInput)) return;
    try {
      await navigator.clipboard.writeText(normalizePan(panInput));
      setPanCopied(true);
      setTimeout(() => setPanCopied(false), 1800);
    } catch {
      setCheckError("Your browser did not allow clipboard access.");
    }
  }

  function checkAnotherIpo() {
    setResults(null);
    setCaptchas({});
    setCheckError("");
    lastCheckKey.current = "";
    requestAnimationFrame(() => ipoSelectElement.current?.focus());
  }

  async function loadCaptcha(result: AllotmentResult) {
    const key = resultKey(result);
    setCaptchas((current) => ({
      ...current,
      [key]: { ...current[key], answer: current[key]?.answer ?? "", loading: true, error: "" }
    }));

    try {
      const response = await fetch(
        `/api/allotment/captcha?registrar=${encodeURIComponent(result.registrar)}`
      );
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "Could not load CAPTCHA.");

      setCaptchas((current) => ({
        ...current,
        [key]: {
          token: data.token,
          image: data.image,
          answer: "",
          loading: false,
          error: ""
        }
      }));
    } catch (error) {
      setCaptchas((current) => ({
        ...current,
        [key]: {
          ...current[key],
          answer: current[key]?.answer ?? "",
          loading: false,
          error: error instanceof Error ? error.message : "Could not load CAPTCHA."
        }
      }));
    }
  }

  async function submitCaptcha(result: AllotmentResult) {
    const key = resultKey(result);
    const captcha = captchas[key];

    if (!captcha?.token || !captcha.answer.trim()) {
      setCaptchas((current) => ({
        ...current,
        [key]: {
          ...current[key],
          answer: current[key]?.answer ?? "",
          error: "Enter the CAPTCHA shown above."
        }
      }));
      return;
    }

    setCaptchas((current) => ({
      ...current,
      [key]: { ...current[key], loading: true, error: "" }
    }));

    try {
      const response = await fetch("/api/allotment/captcha/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipoId: result.ipoId,
          ipoName: result.ipoName,
          pan: result.pan,
          captchaToken: captcha.token,
          captchaAnswer: captcha.answer
        })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "CAPTCHA check failed.");

      replaceResult(data.result as AllotmentResult);
      setCaptchas((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      setCaptchas((current) => ({
        ...current,
        [key]: {
          ...current[key],
          loading: false,
          error: error instanceof Error ? error.message : "CAPTCHA check failed."
        }
      }));
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="mark">IPO</div>
            <div>
              <h1>IPO Fast Check</h1>
              <p>One IPO, one PAN, quick allotment result.</p>
            </div>
          </div>

          <nav className="tabs" aria-label="Primary">
            <button
              className={`tab ${activeTab === "allotment" ? "active" : ""}`}
              onClick={() => setActiveTab("allotment")}
              type="button"
            >
              IPO Allotment
            </button>
            <button
              className={`tab ${activeTab === "gmp" ? "active" : ""}`}
              onClick={() => setActiveTab("gmp")}
              type="button"
            >
              GMP
            </button>
          </nav>
        </header>

        {activeTab === "allotment" ? (
          <section className="workspace single-check" aria-label="IPO allotment checker">
            <div className="panel">
              <div className="panel-header">
                <p className="eyebrow">IPO Allotment</p>
                <h2>Check one PAN</h2>
              </div>

              <div className="panel-body stack">
                <div>
                  <div className="section-title">
                    <h3>Select IPO</h3>
                  </div>

                  {loadError ? <p className="error-text">{loadError}</p> : null}

                  <div className="selector-block">
                    <select
                      ref={ipoSelectElement}
                      className="select-input ipo-select"
                      value={selectedIpoId}
                      onChange={(event) => {
                        const ipo = allotmentIpos.find(
                          (item) => item.id === event.target.value
                        );
                        if (ipo) selectAllotmentIpo(ipo);
                      }}
                      aria-label="Select a recently closed IPO"
                    >
                      {!allotmentIpos.length ? (
                        <option value="">No recent completed IPOs available</option>
                      ) : null}
                      {allotmentIpos.map((ipo) => (
                        <option key={ipo.id} value={ipo.id}>
                          {ipo.name} - Closed {dateLabel(ipo.closeDate)}
                        </option>
                      ))}
                    </select>

                    {selectedIpo ? (
                      <div className="selected-box">
                        <strong>{selectedIpo.name}</strong>
                        <span>
                          {selectedIpo.registrar} • Allotment{" "}
                          {dateLabel(selectedIpo.allotmentDate)}
                        </span>
                        <span>
                          Live update:{" "}
                          {selectedIpo.allotmentStatusText ||
                            statusLabel(selectedIpo.allotmentAvailability)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="section-title">
                    <h3>PAN</h3>
                  </div>
                  <div className="pan-control">
                    <input
                      ref={panInputElement}
                      className={`text-input pan-input ${
                        isValidPan(panInput)
                          ? "valid"
                          : panInput.length === 10
                            ? "invalid"
                            : ""
                      }`}
                      value={panInput}
                      maxLength={10}
                      onChange={(event) => updatePan(event.target.value)}
                      onPaste={(event) => {
                        const pastedPan = event.clipboardData.getData("text");
                        if (pastedPan) {
                          event.preventDefault();
                          updatePan(pastedPan);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void checkAllotment(panInput, selectedIpoId, true);
                        }
                      }}
                      placeholder="ABCDE1234F"
                      aria-label="PAN number"
                      aria-invalid={panInput.length === 10 && !isValidPan(panInput)}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      inputMode="text"
                      spellCheck={false}
                    />
                    <button
                      className="secondary copy-pan-button"
                      disabled={!isValidPan(panInput)}
                      onClick={() => void copyPan()}
                      title="Copy PAN"
                      type="button"
                    >
                      {panCopied ? "Copied" : "Copy PAN"}
                    </button>
                  </div>
                  {panError ? <p className="error-text">{panError}</p> : null}

                  <div className="pan-options">
                    <label className="remember-pan">
                      <input
                        checked={rememberPan}
                        onChange={(event) => updateRememberPan(event.target.checked)}
                        type="checkbox"
                      />
                      Remember PAN on this device
                    </label>
                    {restoredPan ? (
                      <button
                        className="text-command"
                        onClick={() => {
                          lastCheckKey.current = "";
                          scheduleAutoCheck(panInput, selectedIpoId);
                          setRestoredPan(false);
                        }}
                        type="button"
                      >
                        Re-check saved PAN
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="primary"
                    disabled={checking || !ipos.length}
                    onClick={() => void checkAllotment(panInput, selectedIpoId, true)}
                    type="button"
                  >
                    {checking ? "Checking registrar..." : "Check now"}
                  </button>
                  <span className="auto-check-note">Auto-checks when PAN is complete</span>
                </div>
                <div className="privacy-badge">
                  <span className="lock-mark" aria-hidden="true" />
                  <span>
                    {rememberPan
                      ? "Saved only in this browser by your choice. Never stored on our server."
                      : "Sent securely to the official registrar for this check. Never stored on our server."}
                  </span>
                </div>
                {checkError ? <p className="error-text">{checkError}</p> : null}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <p className="eyebrow">Result</p>
                <h2>Allotment status</h2>
              </div>

              <div className="panel-body stack">
                {checking ? (
                  <div className="checking-state" role="status" aria-live="polite">
                    <span className="spinner" aria-hidden="true" />
                    <div>
                      <strong>Checking registrar database...</strong>
                      <span>This usually takes only a few seconds.</span>
                    </div>
                  </div>
                ) : currentResult ? (
                  <div className={`single-result ${statusTone(currentResult.status)}`}>
                    <div className="single-result-head">
                      <div>
                        <h3>{currentResult.ipoName}</h3>
                        <p>Data sourced from {currentResult.registrar}</p>
                      </div>
                      <span className={`status-pill ${statusTone(currentResult.status)}`}>
                        {statusLabel(currentResult.status)}
                      </span>
                    </div>

                    {currentResult.status === "allotted" ? (
                      <div className="allotted-celebration">
                        <span className="result-check" aria-hidden="true">✓</span>
                        <div>
                          <strong>Congratulations!</strong>
                          <span>Your application received an allotment.</span>
                        </div>
                      </div>
                    ) : null}

                    <div className="result-status-line">
                      <strong>{currentResult.liveStatus || statusLabel(currentResult.status)}</strong>
                      <span>
                        PAN: <strong>{currentResult.pan}</strong>
                      </span>
                    </div>

                    {currentResult.error ? (
                      <p className={`result-guidance ${statusTone(currentResult.status)}`}>
                        {currentResult.error}
                      </p>
                    ) : null}

                    {hasResultFacts(currentResult) ? (
                      <div className="result-facts">
                        <div>
                          <span>Applied</span>
                          <strong>{currentResult.appliedQuantity ?? "-"}</strong>
                        </div>
                        <div>
                          <span>Allotted</span>
                          <strong>{currentResult.allottedQuantity ?? "-"}</strong>
                        </div>
                        <div>
                          <span>Application</span>
                          <strong>{currentResult.applicationNo || "-"}</strong>
                        </div>
                        <div>
                          <span>Name</span>
                          <strong>{currentResult.applicantName || "-"}</strong>
                        </div>
                        {currentResult.refundAmount !== undefined ? (
                          <div>
                            <span>Refund amount</span>
                            <strong>{rupee(currentResult.refundAmount)}</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {currentResult.status === "captcha_required" &&
                    currentResult.registrar.toLowerCase().includes("bigshare") ? (
                      <div className="captcha-box large">
                        {currentCaptcha?.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt="Bigshare CAPTCHA"
                            className="captcha-image"
                            src={currentCaptcha.image}
                          />
                        ) : null}
                        {currentCaptcha?.image ? (
                          <div className="captcha-row">
                            <input
                              className="captcha-input"
                              value={currentCaptcha.answer}
                              onChange={(event) =>
                                setCaptchas((current) => ({
                                  ...current,
                                  [resultKey(currentResult)]: {
                                    ...current[resultKey(currentResult)],
                                    answer: event.target.value
                                  }
                                }))
                              }
                              placeholder="CAPTCHA"
                              aria-label={`CAPTCHA for ${currentResult.ipoName}`}
                            />
                            <button
                              className="secondary compact-button"
                              disabled={currentCaptcha.loading}
                              onClick={() => submitCaptcha(currentResult)}
                              type="button"
                            >
                              Submit
                            </button>
                          </div>
                        ) : (
                          <button
                            className="secondary"
                            disabled={currentCaptcha?.loading}
                            onClick={() => loadCaptcha(currentResult)}
                            type="button"
                          >
                            Load Bigshare CAPTCHA
                          </button>
                        )}
                        {currentCaptcha?.image ? (
                          <button
                            className="ghost compact-button"
                            disabled={currentCaptcha.loading}
                            onClick={() => loadCaptcha(currentResult)}
                            type="button"
                          >
                            Refresh CAPTCHA
                          </button>
                        ) : null}
                        {currentCaptcha?.error ? (
                          <span className="captcha-error">{currentCaptcha.error}</span>
                        ) : null}
                      </div>
                    ) : currentResult.actionUrl ? (
                      <a
                        className="result-link"
                        href={currentResult.actionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {currentResult.actionLabel || `Open ${currentResult.registrar}`}
                      </a>
                    ) : currentResult.error ? null : (
                      <p className="small-note">Check complete.</p>
                    )}

                    <button
                      className="secondary result-reset"
                      onClick={checkAnotherIpo}
                      type="button"
                    >
                      Check Another IPO
                    </button>
                  </div>
                ) : (
                  <div className="empty">
                    Select one IPO, enter one PAN, then check allotment.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="panel" aria-label="IPO GMP">
            <div className="panel-header">
              <p className="eyebrow">GMP</p>
              <h2>Current IPO GMP</h2>
            </div>
            <div className="panel-body">
              <div className="gmp-tools">
                <input
                  className="text-input"
                  value={gmpSearch}
                  onChange={(event) => setGmpSearch(event.target.value)}
                  placeholder="Search IPO"
                  aria-label="Search IPO"
                />
                <div className="filters" aria-label="GMP filters">
                  {gmpFilters.map((filter) => (
                    <button
                      className={`filter ${gmpFilter === filter ? "active" : ""}`}
                      key={filter}
                      onClick={() => setGmpFilter(filter)}
                      type="button"
                    >
                      {statusLabel(filter)}
                    </button>
                  ))}
                </div>
              </div>

              {gmpFilter !== "closed" ? (
                <div className="gmp-view-stepper" aria-label="IPO market and date order">
                  <button
                    className="gmp-view-arrow"
                    disabled={gmpViewModeIndex === 0}
                    onClick={() =>
                      setGmpViewModeIndex((index) => Math.max(0, index - 1))
                    }
                    title="Previous order"
                    type="button"
                    aria-label="Previous IPO order"
                  >
                    &#8592;
                  </button>
                  <div className="gmp-view-label" aria-live="polite">
                    <span>View</span>
                    <strong>
                      {gmpViewModeLabel(gmpViewModes[gmpViewModeIndex], gmpFilter)}
                    </strong>
                  </div>
                  <button
                    className="gmp-view-arrow"
                    disabled={gmpViewModeIndex === gmpViewModes.length - 1}
                    onClick={() =>
                      setGmpViewModeIndex((index) =>
                        Math.min(gmpViewModes.length - 1, index + 1)
                      )
                    }
                    title="Next order"
                    type="button"
                    aria-label="Next IPO order"
                  >
                    &#8594;
                  </button>
                </div>
              ) : null}

              <div className="gmp-results-anchor" ref={gmpResultsTop} />

              {filteredGmp.length ? (
                <div className="gmp-list">
                  {filteredGmp.map((row) => (
                    <article className="gmp-card" key={row.id}>
                      <div className="gmp-name">
                        <div className="gmp-title-line">
                          <strong>{row.name}</strong>
                          <span
                            className={`market-tag ${
                              row.marketType === "SME" ? "sme" : "mainboard"
                            }`}
                          >
                            {row.marketType ?? "Mainboard"}
                          </span>
                        </div>
                        <p>
                          {statusLabel(gmpGroup(row))} • Updated{" "}
                          {timeLabel(row.gmpLastUpdated)}
                        </p>
                        <div className="date-strip">
                          <span>Open {dateLabel(row.openDate)}</span>
                          <span>Close {dateLabel(row.closeDate)}</span>
                          <span>Allot {dateLabel(row.allotmentDate)}</span>
                          <span>List {dateLabel(row.listingDate)}</span>
                        </div>
                      </div>
                      <div className="gmp-cell">
                        <span>Price Band</span>
                        <strong>{priceBand(row)}</strong>
                      </div>
                      <div className="gmp-cell">
                        <span>Lot Size</span>
                        <strong>
                          {row.lotSize ? row.lotSize.toLocaleString("en-IN") : "TBA"}
                        </strong>
                      </div>
                      <div className="gmp-cell">
                        <span>GMP</span>
                        <strong className={row.gmp >= 0 ? "positive" : ""}>
                          {rupee(row.gmp)}
                        </strong>
                      </div>
                      <div className="gmp-cell">
                        <span>GMP %</span>
                        <strong className={row.gmpPercent >= 0 ? "positive" : ""}>
                          {row.gmpPercent >= 0 ? "+" : ""}
                          {row.gmpPercent.toFixed(1)}%
                        </strong>
                      </div>
                      <div className="gmp-cell">
                        <span>Est. Listing</span>
                        <strong>{rupee(row.estimatedListingPrice)}</strong>
                      </div>
                    </article>
                  ))}
                  {gmpFilter === "closed" && closedLoaded ? (
                    <div className="history-footer">
                      <div className="history-summary">
                        <span>
                          {closedRangeStart.toLocaleString("en-IN")}-
                          {closedRangeEnd.toLocaleString("en-IN")} of{" "}
                          {closedTotal.toLocaleString("en-IN")}
                        </span>
                        <label className="page-size-control">
                          <span>Rows</span>
                          <select
                            aria-label="Closed IPOs per page"
                            value={closedPageSize}
                            onChange={(event) => {
                              setClosedPage(1);
                              setClosedPageSize(
                                Number(event.target.value) as (typeof closedPageSizes)[number]
                              );
                            }}
                          >
                            {closedPageSizes.map((size) => (
                              <option key={size} value={size}>
                                {size}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <nav className="pagination" aria-label="Closed IPO history pages">
                        <button
                          aria-label="Previous closed IPO page"
                          className="page-button page-direction"
                          disabled={closedLoading || closedPage === 1}
                          onClick={() => setClosedPage((page) => Math.max(1, page - 1))}
                          type="button"
                        >
                          Previous
                        </button>
                        {closedPageNumbers.map((page) => (
                          <button
                            aria-current={closedPage === page ? "page" : undefined}
                            className={`page-button ${closedPage === page ? "active" : ""}`}
                            disabled={closedLoading}
                            key={page}
                            onClick={() => setClosedPage(page)}
                            type="button"
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          aria-label="Next closed IPO page"
                          className="page-button page-direction"
                          disabled={closedLoading || closedPage >= closedTotalPages}
                          onClick={() =>
                            setClosedPage((page) => Math.min(closedTotalPages, page + 1))
                          }
                          type="button"
                        >
                          Next
                        </button>
                      </nav>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty">
                  {closedLoading ? "Loading closed IPO history..." : "No GMP rows match this view."}
                </div>
              )}

              {closedError && gmpFilter === "closed" ? (
                <p className="error-text">{closedError}</p>
              ) : null}

              <div className="disclaimer">
                GMP is unofficial market information and does not guarantee listing price or return.
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
