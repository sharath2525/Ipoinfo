"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isValidPan, normalizePan } from "@/lib/pan";
import type { AllotmentResult, BatchCheckResponse, GmpRow, Ipo } from "@/lib/types";

const gmpFilters = ["open", "upcoming", "closed"] as const;
const closedPageSizes = [25, 50, 100] as const;

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
  if (value === "unavailable") return "Official Check";

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

  if (value === "not_allotted" || value === "error") return "bad";
  if (value === "not_applied" || value === "unavailable") return "neutral";
  return "warn";
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
      parseDate(first.allotmentDate)?.getTime() ??
      parseDate(first.closeDate)?.getTime() ??
      0;
    const secondTime =
      parseDate(second.allotmentDate)?.getTime() ??
      parseDate(second.closeDate)?.getTime() ??
      0;

    return secondTime - firstTime;
  });
}

function paginationWindow(currentPage: number, totalPages: number) {
  const visibleCount = Math.min(3, totalPages);
  const start = Math.max(1, Math.min(currentPage - 1, totalPages - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"allotment" | "gmp">("allotment");
  const [ipos, setIpos] = useState<Ipo[]>([]);
  const [gmpRows, setGmpRows] = useState<GmpRow[]>([]);
  const [selectedIpoId, setSelectedIpoId] = useState("");
  const [panInput, setPanInput] = useState("");
  const [panError, setPanError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<BatchCheckResponse | null>(null);
  const [captchas, setCaptchas] = useState<Record<string, CaptchaState>>({});
  const [gmpSearch, setGmpSearch] = useState("");
  const [gmpFilter, setGmpFilter] = useState<(typeof gmpFilters)[number]>("open");
  const [closedGmpRows, setClosedGmpRows] = useState<GmpRow[]>([]);
  const [closedTotal, setClosedTotal] = useState(0);
  const [closedPage, setClosedPage] = useState(1);
  const [closedPageSize, setClosedPageSize] = useState<(typeof closedPageSizes)[number]>(25);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState("");
  const closedRequestId = useRef(0);
  const gmpResultsTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch("/api/feed");
        const data = (await response.json()) as { ipos: Ipo[]; gmp: GmpRow[] };

        if (!response.ok) {
          throw new Error("IPO data is temporarily unavailable.");
        }

        setIpos(data.ipos);
        const allotmentChoices = recentResultsFirst(
          data.ipos.filter(isLastOrThisMonthResult)
        );
        setSelectedIpoId(allotmentChoices[0]?.id ?? "");
        setGmpRows(data.gmp);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load IPO data.");
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

    return sortGmpRows(sourceRows.filter((row) => {
      const matchesFilter = gmpGroup(row) === gmpFilter;
      const matchesSearch = row.name
        .toLowerCase()
        .includes(gmpSearch.trim().toLowerCase());
      return matchesFilter && matchesSearch;
    }));
  }, [closedGmpRows, gmpFilter, gmpRows, gmpSearch]);

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

  async function checkAllotment() {
    setCheckError("");
    setPanError("");
    setResults(null);
    setCaptchas({});

    const pan = normalizePan(panInput);

    if (!selectedIpoId) {
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

    setPanInput(pan);
    setChecking(true);

    try {
      const response = await fetch("/api/allotment/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pans: [pan], ipoIds: [selectedIpoId] })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Allotment check failed.");
      }

      setResults(data as BatchCheckResponse);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Unable to complete this check.");
    } finally {
      setChecking(false);
    }
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
                      className="select-input"
                      value={selectedIpoId}
                      onChange={(event) => {
                        setSelectedIpoId(event.target.value);
                        setResults(null);
                        setCaptchas({});
                      }}
                      aria-label="Select IPO"
                    >
                      <option value="">Select IPO</option>
                      {allotmentIpos.map((ipo) => (
                        <option key={ipo.id} value={ipo.id}>
                          {ipo.name} - {ipo.allotmentStatusText || statusLabel(ipo.allotmentAvailability)}
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
                  <input
                    className="text-input"
                    value={panInput}
                    maxLength={10}
                    onChange={(event) => {
                      setPanInput(normalizePan(event.target.value));
                      setResults(null);
                    }}
                    placeholder="ABCDE1234F"
                    aria-label="PAN number"
                  />
                  {panError ? <p className="error-text">{panError}</p> : null}
                </div>

                <div className="actions">
                  <button
                    className="primary"
                    disabled={checking || !ipos.length}
                    onClick={checkAllotment}
                    type="button"
                  >
                    {checking ? "Checking..." : "Check Allotment"}
                  </button>
                  <span className="small-note">PAN is used only for this check.</span>
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
                {currentResult ? (
                  <div className={`single-result ${statusTone(currentResult.status)}`}>
                    <div className="single-result-head">
                      <div>
                        <h3>{currentResult.ipoName}</h3>
                        <p>{currentResult.registrar}</p>
                      </div>
                      <span className={`status-pill ${statusTone(currentResult.status)}`}>
                        {statusLabel(currentResult.status)}
                      </span>
                    </div>

                    <div className="result-status-line">
                      <strong>{currentResult.liveStatus || statusLabel(currentResult.status)}</strong>
                      <span>
                        PAN: <strong>{currentResult.pan}</strong>
                      </span>
                    </div>

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
                    </div>

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
                    ) : (
                      <p className="small-note">{currentResult.error ?? "Check complete."}</p>
                    )}

                    <button className="secondary" onClick={checkAllotment} type="button">
                      Check Again
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
