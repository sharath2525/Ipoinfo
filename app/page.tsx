"use client";

import { useEffect, useMemo, useState } from "react";
import { isValidPan, normalizePan } from "@/lib/pan";
import type { AllotmentResult, BatchCheckResponse, GmpRow, Ipo } from "@/lib/types";

const gmpFilters = ["all", "upcoming", "open", "closed", "listing_soon", "listed"] as const;

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
  const statusPriority: Record<string, number> = {
    open: 0,
    upcoming: 1,
    closed: 2,
    listing_soon: 3,
    listed: 4
  };

  return [...rows].sort((first, second) => {
    const priority =
      (statusPriority[first.status] ?? 5) - (statusPriority[second.status] ?? 5);

    if (priority !== 0) return priority;

    if (first.status === "upcoming") {
      return dateTime(first.openDate) - dateTime(second.openDate);
    }

    return (
      dateTime(second.closeDate) - dateTime(first.closeDate) ||
      dateTime(second.listingDate) - dateTime(first.listingDate)
    );
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
  const [gmpFilter, setGmpFilter] = useState<(typeof gmpFilters)[number]>("all");

  useEffect(() => {
    async function loadData() {
      try {
        const [ipoResponse, gmpResponse] = await Promise.all([
          fetch("/api/ipos"),
          fetch("/api/gmp")
        ]);
        const ipoData = (await ipoResponse.json()) as { ipos: Ipo[] };
        const gmpData = (await gmpResponse.json()) as { gmp: GmpRow[] };

        if (!ipoResponse.ok || !gmpResponse.ok) {
          throw new Error("IPO data is temporarily unavailable.");
        }

        setIpos(ipoData.ipos);
        const allotmentChoices = recentResultsFirst(
          ipoData.ipos.filter(isLastOrThisMonthResult)
        );
        setSelectedIpoId(allotmentChoices[0]?.id ?? "");
        setGmpRows(gmpData.gmp);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load IPO data.");
      }
    }

    loadData();
  }, []);

  const filteredGmp = useMemo(() => {
    return sortGmpRows(gmpRows.filter((row) => {
      const matchesFilter = gmpFilter === "all" || row.status === gmpFilter;
      const matchesSearch = row.name
        .toLowerCase()
        .includes(gmpSearch.trim().toLowerCase());
      return matchesFilter && matchesSearch;
    }));
  }, [gmpFilter, gmpRows, gmpSearch]);

  const selectedIpo = ipos.find((ipo) => ipo.id === selectedIpoId);
  const allotmentIpos = useMemo(
    () => recentResultsFirst(ipos.filter(isLastOrThisMonthResult)),
    [ipos]
  );
  const currentResult = results?.results[0];
  const currentCaptcha = currentResult ? captchas[resultKey(currentResult)] : undefined;

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

              {filteredGmp.length ? (
                <div className="gmp-list">
                  {filteredGmp.map((row) => (
                    <article className="gmp-card" key={row.id}>
                      <div className="gmp-name">
                        <strong>{row.name}</strong>
                        <p>
                          {statusLabel(row.status)} • Updated {timeLabel(row.gmpLastUpdated)}
                        </p>
                        <div className="date-strip">
                          <span>Open {dateLabel(row.openDate)}</span>
                          <span>Close {dateLabel(row.closeDate)}</span>
                          <span>List {dateLabel(row.listingDate)}</span>
                        </div>
                      </div>
                      <div className="gmp-cell">
                        <span>Price</span>
                        <strong>{rupee(row.issuePriceMax)}</strong>
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
                </div>
              ) : (
                <div className="empty">No GMP rows match this view.</div>
              )}

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
