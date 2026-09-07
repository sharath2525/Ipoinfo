"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import currentIpoSeed from "@/data/current-ipo-backup.json";
import ipoSnapshotMeta from "@/data/ipo-snapshot-meta.json";
import { refreshedCaptchaState } from "@/lib/captcha-state";
import {
  gmpTimingLabel,
  paginationWindow,
  parseGmpViewHash,
  serializeGmpViewHash,
  sortAndFilterGmpRows,
  type GmpMarketFilter,
  type GmpSort
} from "@/lib/gmp-view";
import {
  cleanIpoName,
  effectiveIpoStatus,
  indiaDate,
  ipoNameKey,
  sanitizeIpoDates
} from "@/lib/ipo-normalization";
import { isValidPan, normalizePan } from "@/lib/pan";
import { officialAllotmentUrl } from "@/lib/providers/official-registrar";
import type { AllotmentResult, BatchCheckResponse, GmpRow, Ipo } from "@/lib/types";

const gmpFilters = ["open", "upcoming", "closed"] as const;
const closedPageSizes = [25, 50, 100] as const;
const REMEMBERED_PAN_KEY = "ipo-fast-check:remembered-pan";
const PUBLIC_FEED_CACHE_KEY = "ipo-fast-check:public-feed-v7";
const PUBLIC_FEED_REFRESH_INTERVAL = 60 * 1000;
const PUBLIC_FEED_RETRY_INTERVAL = 15 * 1000;

type PublicFeed = {
  ipos: Ipo[];
  gmp: GmpRow[];
  meta?: {
    isLive: boolean;
    dataState?: "live" | "cached" | "unavailable";
    fetchedAt?: string;
    cachedAt?: string;
    message?: string;
  };
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

type FeedDisplayState = {
  state: "live" | "cached" | "unavailable";
  updatedAt?: string;
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

function maskPan(value: string) {
  const pan = normalizePan(value);
  return isValidPan(pan) ? `${pan.slice(0, 5)}****${pan.slice(-1)}` : "";
}

function allotmentReleaseLabel(ipo: Ipo) {
  const sourceLabel = ipo.allotmentStatusText?.trim();
  const allotmentDate = parseDate(ipo.allotmentDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (
    sourceLabel &&
    /\b(?:due|expected)\s+today\b/i.test(sourceLabel) &&
    allotmentDate &&
    allotmentDate < today
  ) {
    return "Awaiting registrar confirmation";
  }

  return sourceLabel || statusLabel(ipo.allotmentAvailability);
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
  if (value === "unavailable" || value === "error") return "neutral";
  if (
    value === "not_applied" ||
    value === "pending" ||
    value === "expected_soon" ||
    value === "captcha_required"
  ) {
    return "warn";
  }
  return "warn";
}

function statusSymbol(value: string) {
  if (value === "allotted" || value === "available" || value === "allotment_out") {
    return "\u2713";
  }
  if (value === "not_allotted") return "\u00d7";
  if (value === "unavailable" || value === "error") return "?";
  return "!";
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

function normalizedIpoName(value: string) {
  return ipoNameKey(value);
}

function normalizeIposForDisplay(rows: Ipo[]) {
  const unique = new Map<string, Ipo>();
  const keyById = new Map<string, string>();

  for (const sourceRow of rows) {
    const row = sanitizeIpoDates({
      ...sourceRow,
      name: cleanIpoName(sourceRow.name),
      status: effectiveIpoStatus(sourceRow)
    });
    const nameKey = normalizedIpoName(row.name) || row.id;
    const key = keyById.get(row.id) ?? nameKey;
    const existing = unique.get(key);

    unique.set(key, existing ? { ...existing, ...row, id: existing.id || row.id } : row);
    keyById.set(row.id, key);
  }

  return [...unique.values()];
}

function normalizeGmpRowsForDisplay(rows: GmpRow[]) {
  const unique = new Map<string, GmpRow>();
  const keyById = new Map<string, string>();

  for (const sourceRow of rows) {
    const row = sanitizeIpoDates({
      ...sourceRow,
      name: cleanIpoName(sourceRow.name),
      status: effectiveIpoStatus(sourceRow)
    });
    const nameKey = normalizedIpoName(row.name) || row.id;
    const key = keyById.get(row.id) ?? nameKey;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, row);
      keyById.set(row.id, key);
      continue;
    }

    const existingTime = dateTime(existing.gmpLastUpdated);
    const rowTime = dateTime(row.gmpLastUpdated);
    const primary = rowTime >= existingTime ? row : existing;
    const secondary = primary === row ? existing : row;
    unique.set(key, {
      ...secondary,
      ...primary,
      id: existing.id || row.id,
      marketType: primary.marketType || secondary.marketType,
      issuePriceMin: primary.issuePriceMin || secondary.issuePriceMin,
      issuePriceMax: primary.issuePriceMax || secondary.issuePriceMax,
      lotSize: primary.lotSize || secondary.lotSize,
      openDate: primary.openDate || secondary.openDate,
      closeDate: primary.closeDate || secondary.closeDate,
      allotmentDate: primary.allotmentDate || secondary.allotmentDate,
      listingDate: primary.listingDate || secondary.listingDate,
      gmp: typeof primary.gmp === "number" ? primary.gmp : secondary.gmp,
      gmpPercent:
        typeof primary.gmpPercent === "number"
          ? primary.gmpPercent
          : secondary.gmpPercent,
      estimatedListingPrice:
        typeof primary.estimatedListingPrice === "number"
          ? primary.estimatedListingPrice
          : secondary.estimatedListingPrice,
      estimatedListingGain:
        typeof primary.estimatedListingGain === "number"
          ? primary.estimatedListingGain
          : secondary.estimatedListingGain,
      gmpLastUpdated: primary.gmpLastUpdated || secondary.gmpLastUpdated
    });
    keyById.set(row.id, key);
  }

  return [...unique.values()];
}

function gmpGroup(row: GmpRow): "open" | "upcoming" | "closed" {
  const status = effectiveIpoStatus(row);
  if (status === "open") return "open";
  if (status === "upcoming") return "upcoming";
  return "closed";
}

function isCompletedIpo(ipo: Ipo) {
  const status = effectiveIpoStatus(ipo);
  return status === "closed" || status === "listing_soon" || status === "listed";
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

    return (
      secondTime - firstTime ||
      dateTime(second.allotmentDate) - dateTime(first.allotmentDate) ||
      first.name.localeCompare(second.name)
    );
  });
}

const bundledAllotmentIpos = recentResultsFirst(
  (currentIpoSeed as Ipo[]).filter(isLastOrThisMonthResult)
);

const bundledGmpRows = normalizeGmpRowsForDisplay(currentIpoSeed as GmpRow[]);

export default function Home() {
  const [activeTab, setActiveTab] = useState<"allotment" | "gmp">("allotment");
  const [ipos, setIpos] = useState<Ipo[]>(bundledAllotmentIpos);
  const [gmpRows, setGmpRows] = useState<GmpRow[]>(bundledGmpRows);
  const [selectedIpoId, setSelectedIpoId] = useState(
    bundledAllotmentIpos[0]?.id ?? ""
  );
  const [panInput, setPanInput] = useState("");
  const [panError, setPanError] = useState("");
  const [rememberPan, setRememberPan] = useState(false);
  const [savedPan, setSavedPan] = useState("");
  const [panCopied, setPanCopied] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedState, setFeedState] = useState<FeedDisplayState>({ state: "live" });
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<BatchCheckResponse | null>(null);
  const [captchas, setCaptchas] = useState<Record<string, CaptchaState>>({});
  const [gmpSearch, setGmpSearch] = useState("");
  const [gmpFilter, setGmpFilter] = useState<(typeof gmpFilters)[number]>("open");
  const [gmpMarket, setGmpMarket] = useState<GmpMarketFilter>("all");
  const [gmpSort, setGmpSort] = useState<GmpSort>("date");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [closedGmpRows, setClosedGmpRows] = useState<GmpRow[]>([]);
  const [closedTotal, setClosedTotal] = useState(
    Number(ipoSnapshotMeta.closed) || 0
  );
  const [closedPage, setClosedPage] = useState(1);
  const [closedPageSize, setClosedPageSize] = useState<(typeof closedPageSizes)[number]>(25);
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState("");
  const [closedFeedState, setClosedFeedState] = useState<FeedDisplayState>({ state: "live" });
  const closedRequestId = useRef(0);
  const closedCountRequested = useRef(false);
  const gmpResultsTop = useRef<HTMLDivElement>(null);
  const ipoSelectElement = useRef<HTMLSelectElement>(null);
  const panInputElement = useRef<HTMLInputElement>(null);
  const autoCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allotmentRequestId = useRef(0);
  const allotmentController = useRef<AbortController | null>(null);
  const activeCheckKey = useRef("");
  const captchaRequestId = useRef(0);
  const captchaController = useRef<AbortController | null>(null);
  const lastCheckKey = useRef("");
  const selectedIpoName = useRef(bundledAllotmentIpos[0]?.name ?? "");
  const allotmentSelectionLocked = useRef(false);

  useEffect(() => {
    const restoreViewFromHash = () => {
      const restored = parseGmpViewHash(window.location.hash);
      if (!restored) {
        setActiveTab("allotment");
        return;
      }

      setActiveTab("gmp");
      setGmpFilter(restored.category);
      setGmpMarket(restored.category === "closed" ? "all" : restored.market);
      setGmpSort(restored.category === "closed" ? "date" : restored.sort);
      setClosedPage(restored.page);
      setClosedPageSize(restored.pageSize);
    };

    restoreViewFromHash();
    window.addEventListener("hashchange", restoreViewFromHash);
    return () => window.removeEventListener("hashchange", restoreViewFromHash);
  }, []);

  useEffect(() => {
    try {
      const savedPan = normalizePan(localStorage.getItem(REMEMBERED_PAN_KEY) ?? "");
      if (isValidPan(savedPan)) {
        setSavedPan(savedPan);
      }
    } catch {
      // Browser storage can be unavailable in private or restricted modes.
    }

    return () => {
      if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
      allotmentController.current?.abort();
      captchaController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let requestInFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let latestIpos = normalizeIposForDisplay(bundledAllotmentIpos);
    let latestGmp: GmpRow[] = bundledGmpRows;

    function applyPublicFeed(
      data: PublicFeed,
      origin: "network" | "browser-cache" = "network",
      browserCachedAt?: number
    ) {
      if (!Array.isArray(data.ipos) || !Array.isArray(data.gmp)) return;

      let normalizedIpos = normalizeIposForDisplay(data.ipos);
      let normalizedGmp = normalizeGmpRowsForDisplay(data.gmp);
      const state =
        origin === "browser-cache" ? "cached" : (data.meta?.dataState ?? "live");

      if (origin === "network" && state !== "live") {
        normalizedIpos = normalizeIposForDisplay([...latestIpos, ...normalizedIpos]);
        const presentGroups = new Set(normalizedGmp.map(gmpGroup));
        normalizedGmp = normalizeGmpRowsForDisplay([
          ...latestGmp.filter((row) => !presentGroups.has(gmpGroup(row))),
          ...normalizedGmp
        ]);
      }

      if (normalizedIpos.length) latestIpos = normalizedIpos;
      if (normalizedGmp.length) latestGmp = normalizedGmp;

      if (normalizedIpos.length) {
        const allotmentChoices = recentResultsFirst(
          normalizedIpos.filter(isLastOrThisMonthResult)
        );
        const selectedName = normalizedIpoName(selectedIpoName.current);
        const preservedChoice = allotmentSelectionLocked.current
          ? allotmentChoices.find(
              (ipo) => normalizedIpoName(ipo.name) === selectedName
            )
          : undefined;
        const nextChoice = preservedChoice ?? allotmentChoices[0];

        setIpos(normalizedIpos);
        setSelectedIpoId(nextChoice?.id ?? "");
        selectedIpoName.current = nextChoice?.name ?? "";
      }
      if (normalizedGmp.length) setGmpRows(normalizedGmp);
      const updatedAt =
        data.meta?.cachedAt ??
        data.meta?.fetchedAt ??
        (browserCachedAt ? new Date(browserCachedAt).toISOString() : undefined);
      setFeedState({ state, updatedAt });
      setFeedLoading(false);
      hasUsableGmp = normalizedGmp.length > 0 || hasUsableGmp;
    }

    let hasUsableGmp = false;
    function loadCachedFeed() {
      for (const cacheKey of [PUBLIC_FEED_CACHE_KEY]) {
        try {
          const stored = JSON.parse(
            localStorage.getItem(cacheKey) ?? "null"
          ) as StoredPublicFeed | null;
          if (
            stored &&
            Number.isFinite(stored.cachedAt)
          ) {
            applyPublicFeed(stored, "browser-cache", stored.cachedAt);
            break;
          }
        } catch {
          // Ignore a damaged entry and continue with the next cache version.
        }
      }
    }

    async function loadData() {
      if (stopped || requestInFlight) return;
      requestInFlight = true;
      if (!hasUsableGmp) setFeedLoading(true);

      try {
        const response = await fetch("/api/feed", { cache: "no-store" });
        const data = (await response.json()) as PublicFeed;

        if (!response.ok) {
          throw new Error("IPO data is temporarily unavailable.");
        }
        if (!Array.isArray(data.ipos) || !Array.isArray(data.gmp) || !data.gmp.length) {
          throw new Error("The live IPO feed returned an incomplete update.");
        }

        if (stopped) return;
        applyPublicFeed(data);
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        try {
          const successfulAt =
            data.meta?.dataState === "cached"
              ? new Date(data.meta.cachedAt ?? data.meta.fetchedAt ?? Date.now()).getTime()
              : Date.now();
          localStorage.setItem(
            PUBLIC_FEED_CACHE_KEY,
            JSON.stringify({ ...data, cachedAt: successfulAt } satisfies StoredPublicFeed)
          );
        } catch {
          // Public-feed caching is an optional speed enhancement.
        }
      } catch {
        if (stopped) return;
        setFeedState((current) => ({
          state: hasUsableGmp ? "cached" : "unavailable",
          updatedAt: current.updatedAt
        }));
        if (!hasUsableGmp && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void loadData();
          }, PUBLIC_FEED_RETRY_INTERVAL);
        }
      } finally {
        requestInFlight = false;
        if (!stopped) setFeedLoading(false);
      }
    }

    loadCachedFeed();
    void loadData();
    const refreshInterval = setInterval(() => {
      void loadData();
    }, PUBLIC_FEED_REFRESH_INTERVAL);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadData();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      stopped = true;
      clearInterval(refreshInterval);
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "gmp") return;
    if (gmpFilter === "closed") {
      void loadClosedHistory(closedPage, closedPageSize);
      return;
    }
    if (!closedCountRequested.current) void loadClosedCount();
  }, [activeTab, closedPage, closedPageSize, gmpFilter]);

  useEffect(() => {
    if (!filterSheetOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterSheetOpen(false);
    };
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterSheetOpen]);

  const filteredGmp = useMemo(() => {
    const sourceRows = normalizeGmpRowsForDisplay(
      gmpFilter === "closed" ? closedGmpRows : gmpRows
    );
    const matchingRows = sourceRows.filter((row) => {
      const matchesFilter = gmpGroup(row) === gmpFilter;
      const matchesSearch = row.name
        .toLowerCase()
        .includes(gmpSearch.trim().toLowerCase());
      return matchesFilter && matchesSearch;
    });

    return sortAndFilterGmpRows(
      matchingRows,
      gmpFilter,
      gmpFilter === "closed" ? "all" : gmpMarket,
      gmpFilter === "closed" ? "date" : gmpSort
    );
  }, [closedGmpRows, gmpFilter, gmpMarket, gmpRows, gmpSearch, gmpSort]);

  const gmpCounts = useMemo(() => {
    const counts = { open: 0, upcoming: 0, closed: 0 };
    for (const row of normalizeGmpRowsForDisplay(gmpRows)) counts[gmpGroup(row)] += 1;
    counts.closed = Math.max(counts.closed, closedTotal);
    return counts;
  }, [closedTotal, gmpRows]);

  const selectedIpo = ipos.find((ipo) => ipo.id === selectedIpoId);
  const allotmentIpos = useMemo(
    () => recentResultsFirst(ipos.filter(isLastOrThisMonthResult)),
    [ipos]
  );
  const currentResult = results?.results[0];
  const currentCaptcha = currentResult ? captchas[resultKey(currentResult)] : undefined;
  const hasEnteredCaptcha = Boolean(currentCaptcha?.image && currentCaptcha.answer.trim());
  const closedTotalPages = Math.max(1, Math.ceil(closedTotal / closedPageSize));
  const closedPageNumbers = paginationWindow(closedPage, closedTotalPages);
  const closedRangeStart = closedTotal ? (closedPage - 1) * closedPageSize + 1 : 0;
  const closedRangeEnd = Math.min(closedPage * closedPageSize, closedTotal);
  const showGmpSkeleton =
    !filteredGmp.length &&
    (gmpFilter === "closed" ? closedLoading : feedLoading);

  useEffect(() => {
    if (!hasEnteredCaptcha) return;

    const protectEnteredCaptcha = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", protectEnteredCaptcha);
    return () => window.removeEventListener("beforeunload", protectEnteredCaptcha);
  }, [hasEnteredCaptcha]);

  function resultKey(result: AllotmentResult) {
    return `${result.ipoId}:${result.pan}`;
  }

  function updateViewHash(
    tab: "allotment" | "gmp",
    overrides: Partial<{
      category: (typeof gmpFilters)[number];
      market: GmpMarketFilter;
      sort: GmpSort;
      page: number;
      pageSize: 25 | 50 | 100;
    }> = {}
  ) {
    const category = overrides.category ?? gmpFilter;
    const hash =
      tab === "allotment"
        ? "#allotment"
        : serializeGmpViewHash({
            category,
            market: category === "closed" ? "all" : overrides.market ?? gmpMarket,
            sort: category === "closed" ? "date" : overrides.sort ?? gmpSort,
            page: category === "closed" ? overrides.page ?? closedPage : 1,
            pageSize: overrides.pageSize ?? closedPageSize
          });
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`
    );
  }

  function selectPrimaryTab(tab: "allotment" | "gmp") {
    setActiveTab(tab);
    updateViewHash(tab);
  }

  function selectGmpFilter(filter: (typeof gmpFilters)[number]) {
    setGmpFilter(filter);
    setClosedPage(1);
    if (filter === "closed") {
      setGmpMarket("all");
      setGmpSort("date");
    }
    updateViewHash("gmp", { category: filter, page: 1 });
  }

  function updateGmpMarket(market: GmpMarketFilter) {
    setGmpMarket(market);
    updateViewHash("gmp", { market });
  }

  function updateGmpSort(sort: GmpSort) {
    setGmpSort(sort);
    updateViewHash("gmp", { sort });
  }

  function replaceResult(nextResult: AllotmentResult) {
    setResults((current) => {
      if (!current) return current;
      const nextResults = current.results.map((item) =>
        item.pan === nextResult.pan &&
        (item.ipoId === nextResult.ipoId ||
          item.ipoName.trim().toLowerCase() === nextResult.ipoName.trim().toLowerCase())
          ? nextResult
          : item
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

  function cancelAllotmentRequest() {
    allotmentRequestId.current += 1;
    allotmentController.current?.abort();
    allotmentController.current = null;
    activeCheckKey.current = "";
    setChecking(false);
  }

  function cancelCaptchaRequest() {
    captchaRequestId.current += 1;
    captchaController.current?.abort();
    captchaController.current = null;
  }

  function selectAllotmentIpo(ipo: Ipo) {
    cancelAllotmentRequest();
    cancelCaptchaRequest();
    allotmentSelectionLocked.current = true;
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

  async function loadClosedCount() {
    closedCountRequested.current = true;
    try {
      const response = await fetch("/api/gmp/history?offset=0&limit=1", {
        cache: "no-store"
      });
      const data = (await response.json()) as { total?: number };
      if (response.ok && typeof data.total === "number") setClosedTotal(data.total);

      void fetch("/api/gmp/history?offset=0&limit=1&refresh=1", {
        cache: "no-store"
      })
        .then(async (liveResponse) => {
          const liveData = (await liveResponse.json()) as { total?: number };
          if (liveResponse.ok && typeof liveData.total === "number") {
            setClosedTotal(liveData.total);
          }
        })
        .catch(() => undefined);
    } catch {
      closedCountRequested.current = false;
    }
  }

  async function loadClosedHistory(page: number, pageSize: number) {
    const requestId = ++closedRequestId.current;
    setClosedLoading(true);
    setClosedLoaded(false);
    setClosedError("");
    const offset = (page - 1) * pageSize;

    async function requestHistory(refresh = false) {
      const response = await fetch(
        `/api/gmp/history?offset=${offset}&limit=${pageSize}${refresh ? "&refresh=1" : ""}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as {
        gmp?: GmpRow[];
        total?: number;
        error?: string;
        dataState?: "live" | "cached" | "unavailable";
        fetchedAt?: string;
        cachedAt?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Closed IPO history is temporarily unavailable.");
      }

      return data;
    }

    function applyHistory(data: Awaited<ReturnType<typeof requestHistory>>) {
      if (requestId !== closedRequestId.current) return;

      const total = data.total ?? 0;
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      if (page > lastPage) {
        setClosedTotal(total);
        setClosedPage(lastPage);
        updateViewHash("gmp", { page: lastPage });
        return;
      }

      setClosedGmpRows(
        sortAndFilterGmpRows(
          normalizeGmpRowsForDisplay(data.gmp ?? []),
          "closed",
          "all",
          "date"
        )
      );
      setClosedTotal(total);
      setClosedLoaded(true);
      setClosedFeedState({
        state: data.dataState ?? "live",
        updatedAt: data.cachedAt ?? data.fetchedAt
      });
      if (page > 1) {
        requestAnimationFrame(() => {
          gmpResultsTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }

    try {
      const cachedData = await requestHistory();
      applyHistory(cachedData);
      if (requestId === closedRequestId.current) setClosedLoading(false);

      try {
        const liveData = await requestHistory(true);
        applyHistory(liveData);
      } catch {
        // The saved page remains visible when the live source is unavailable.
      }
    } catch (error) {
      if (requestId !== closedRequestId.current) return;
      setClosedFeedState((current) => ({ ...current, state: "unavailable" }));
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

    if (activeCheckKey.current === checkKey) return;
    if (!force && lastCheckKey.current === checkKey) return;

    cancelAllotmentRequest();
    cancelCaptchaRequest();
    const requestId = ++allotmentRequestId.current;
    const controller = new AbortController();
    allotmentController.current = controller;
    activeCheckKey.current = checkKey;

    setPanInput(pan);
    setResults(null);
    setCaptchas({});
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
        }),
        signal: controller.signal
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Allotment check failed.");
      }

      if (requestId !== allotmentRequestId.current) return;

      setResults(data as BatchCheckResponse);
      if (rememberPan) {
        try {
          localStorage.setItem(REMEMBERED_PAN_KEY, pan);
          setSavedPan(pan);
        } catch {
          // Remembering PAN is optional and may be blocked by the browser.
        }
      }
    } catch (error) {
      if (controller.signal.aborted || requestId !== allotmentRequestId.current) return;
      lastCheckKey.current = "";
      setCheckError(error instanceof Error ? error.message : "Unable to complete this check.");
    } finally {
      if (requestId === allotmentRequestId.current) {
        allotmentController.current = null;
        activeCheckKey.current = "";
        setChecking(false);
      }
    }
  }

  function updatePan(nextValue: string) {
    const pan = normalizePan(nextValue).replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (pan) allotmentSelectionLocked.current = true;
    cancelAllotmentRequest();
    cancelCaptchaRequest();
    setPanInput(pan);
    setPanError("");
    setPanCopied(false);
    setResults(null);
    setCaptchas({});
    lastCheckKey.current = "";
    scheduleAutoCheck(pan, selectedIpoId);
  }

  function updateRememberPan(enabled: boolean) {
    setRememberPan(enabled);
    if (!enabled) {
      setSavedPan("");
      try {
        localStorage.removeItem(REMEMBERED_PAN_KEY);
      } catch {
        // The browser may block local storage.
      }
    } else if (isValidPan(panInput)) {
      try {
        const pan = normalizePan(panInput);
        localStorage.setItem(REMEMBERED_PAN_KEY, pan);
        setSavedPan(pan);
      } catch {
        // The browser may block local storage.
      }
    }
  }

  function useSavedPan() {
    if (!isValidPan(savedPan)) return;
    lastCheckKey.current = "";
    updatePan(savedPan);
    requestAnimationFrame(() => panInputElement.current?.focus());
  }

  function forgetSavedPan() {
    setRememberPan(false);
    setSavedPan("");
    try {
      localStorage.removeItem(REMEMBERED_PAN_KEY);
    } catch {
      // The browser may block local storage.
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
    cancelAllotmentRequest();
    cancelCaptchaRequest();
    setResults(null);
    setCaptchas({});
    setCheckError("");
    lastCheckKey.current = "";
    requestAnimationFrame(() => ipoSelectElement.current?.focus());
  }

  async function loadCaptcha(result: AllotmentResult, notice = "") {
    const key = resultKey(result);
    cancelCaptchaRequest();
    const requestId = ++captchaRequestId.current;
    const controller = new AbortController();
    captchaController.current = controller;
    setCaptchas((current) => ({
      ...current,
      [key]: { ...current[key], answer: current[key]?.answer ?? "", loading: true, error: "" }
    }));

    try {
      const response = await fetch(
        `/api/allotment/captcha?registrar=${encodeURIComponent(result.registrar)}`,
        { signal: controller.signal }
      );
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "Could not load CAPTCHA.");
      if (requestId !== captchaRequestId.current) return;

      setCaptchas((current) => ({
        ...current,
        [key]: refreshedCaptchaState(
          { token: data.token, image: data.image },
          notice
        )
      }));
    } catch (error) {
      if (controller.signal.aborted || requestId !== captchaRequestId.current) return;
      setCaptchas((current) => ({
        ...current,
        [key]: {
          ...current[key],
          answer: current[key]?.answer ?? "",
          loading: false,
          error: error instanceof Error ? error.message : "Could not load CAPTCHA."
        }
      }));
    } finally {
      if (requestId === captchaRequestId.current) captchaController.current = null;
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

    if (captchaController.current) return;

    const requestId = ++captchaRequestId.current;
    const controller = new AbortController();
    captchaController.current = controller;

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
        }),
        signal: controller.signal
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "CAPTCHA check failed.");
      if (requestId !== captchaRequestId.current) return;

      const nextResult = data.result as AllotmentResult;
      replaceResult(nextResult);

      if (nextResult.status === "captcha_required") {
        captchaController.current = null;
        await loadCaptcha(
          nextResult,
          nextResult.error ?? "The CAPTCHA was rejected. A fresh challenge was loaded."
        );
        return;
      }

      setCaptchas((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      if (controller.signal.aborted || requestId !== captchaRequestId.current) return;
      setCaptchas((current) => ({
        ...current,
        [key]: {
          ...current[key],
          loading: false,
          error: error instanceof Error ? error.message : "CAPTCHA check failed."
        }
      }));
    } finally {
      if (requestId === captchaRequestId.current) captchaController.current = null;
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
              onClick={() => selectPrimaryTab("allotment")}
              type="button"
            >
              IPO Allotment
            </button>
            <button
              className={`tab ${activeTab === "gmp" ? "active" : ""}`}
              onClick={() => selectPrimaryTab("gmp")}
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

                  {feedState.state === "cached" ? (
                    <div className="feed-state cached compact-feed-state" role="status">
                      <strong>Cached IPO list</strong>
                      <span>Updated {timeLabel(feedState.updatedAt)}</span>
                    </div>
                  ) : feedState.state === "unavailable" ? (
                    <div className="feed-state unavailable compact-feed-state" role="status">
                      <strong>Live IPO list temporarily unavailable</strong>
                      <span>Showing saved recent IPOs while refresh retries.</span>
                    </div>
                  ) : null}

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
                          Live update: {allotmentReleaseLabel(selectedIpo)}
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
                  </div>
                  {savedPan ? (
                    <div className="saved-pan-row">
                      <span>
                        Saved PAN <strong>{maskPan(savedPan)}</strong>
                      </span>
                      <div>
                        <button className="text-command" onClick={useSavedPan} type="button">
                          Use saved PAN
                        </button>
                        <button className="text-command danger-command" onClick={forgetSavedPan} type="button">
                          Forget
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="actions">
                  <button
                    className="primary"
                    disabled={checking || !selectedIpo || !allotmentIpos.length}
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
                {checkError ? (
                  <div className="request-error-box">
                    <p className="error-text">{checkError}</p>
                    {selectedIpo ? (
                      <a
                        className="result-link"
                        href={officialAllotmentUrl(selectedIpo)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Check on official registrar
                      </a>
                    ) : null}
                  </div>
                ) : null}
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
                        <span className="status-icon" aria-hidden="true">
                          {statusSymbol(currentResult.status)}
                        </span>
                        {statusLabel(currentResult.status)}
                      </span>
                    </div>

                    {currentResult.status === "allotted" ? (
                      <div className="allotted-celebration">
                        <span className="result-check" aria-hidden="true">&#10003;</span>
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
                          <div className="captcha-visual">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt="Bigshare CAPTCHA"
                              className="captcha-image"
                              src={currentCaptcha.image}
                            />
                            <button
                              aria-label="Refresh CAPTCHA"
                              className="captcha-refresh"
                              disabled={currentCaptcha.loading}
                              onClick={() => loadCaptcha(currentResult)}
                              title="Refresh CAPTCHA"
                              type="button"
                            >
                              <span aria-hidden="true">&#8635;</span>
                            </button>
                          </div>
                        ) : null}
                        {currentCaptcha?.image ? (
                          <div className="captcha-row">
                            <input
                              className="captcha-input"
                              value={currentCaptcha.answer}
                              onChange={(event) => {
                                const answer = event.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z0-9]/g, "")
                                  .slice(0, 20);
                                setCaptchas((current) => ({
                                  ...current,
                                  [resultKey(currentResult)]: {
                                    ...current[resultKey(currentResult)],
                                    answer
                                  }
                                }));
                              }}
                              maxLength={20}
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
                        {currentCaptcha?.error ? (
                          <span className="captcha-error">{currentCaptcha.error}</span>
                        ) : null}
                      </div>
                    ) : !currentResult.actionUrl && !currentResult.error ? (
                      <p className="small-note">Check complete.</p>
                    ) : null}

                    {currentResult.actionUrl ? (
                      <a
                        className="result-link"
                        href={currentResult.actionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Check on official registrar
                      </a>
                    ) : null}

                    <button
                      className={`secondary result-reset${
                        currentResult.status === "captcha_required"
                          ? " captcha-result-reset"
                          : ""
                      }`}
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
              <h2>Latest available GMP</h2>
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
                      onClick={() => selectGmpFilter(filter)}
                      type="button"
                    >
                      <span>{statusLabel(filter)}</span>
                      <span className="filter-count">
                        {gmpCounts[filter].toLocaleString("en-IN")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {gmpFilter !== "closed" ? (
                <div className="gmp-sort-row">
                  <button
                    className="gmp-sort-trigger"
                    onClick={() => setFilterSheetOpen(true)}
                    type="button"
                    aria-haspopup="dialog"
                  >
                    <span aria-hidden="true">&#9776;</span>
                    <span>Sort &amp; Filter</span>
                    <small>
                      {gmpMarket === "all"
                        ? gmpSort === "date"
                          ? gmpFilter === "open"
                            ? "Closing soon"
                            : "Opening soon"
                          : gmpSort === "mainboard_first"
                            ? "Mainboard first"
                            : "SME first"
                        : gmpMarket === "mainboard"
                          ? "Mainboard only"
                          : "SME only"}
                    </small>
                  </button>
                </div>
              ) : null}

              {filterSheetOpen ? (
                <div
                  className="filter-sheet-backdrop"
                  onMouseDown={() => setFilterSheetOpen(false)}
                  role="presentation"
                >
                  <section
                    aria-labelledby="filter-sheet-title"
                    aria-modal="true"
                    className="filter-sheet"
                    onMouseDown={(event) => event.stopPropagation()}
                    role="dialog"
                  >
                    <div className="filter-sheet-head">
                      <div>
                        <p className="eyebrow">GMP view</p>
                        <h3 id="filter-sheet-title">Sort &amp; Filter</h3>
                      </div>
                      <button
                        aria-label="Close sort and filter"
                        className="sheet-close"
                        onClick={() => setFilterSheetOpen(false)}
                        title="Close"
                        type="button"
                      >
                        <span aria-hidden="true">&#215;</span>
                      </button>
                    </div>

                    <fieldset className="filter-fieldset">
                      <legend>Market</legend>
                      <div className="sheet-options">
                        {(["all", "mainboard", "sme"] as const).map((market) => (
                          <button
                            aria-pressed={gmpMarket === market}
                            className={gmpMarket === market ? "active" : ""}
                            key={market}
                            onClick={() => updateGmpMarket(market)}
                            type="button"
                          >
                            {market === "all"
                              ? "All IPOs"
                              : market === "mainboard"
                                ? "Mainboard"
                                : "SME"}
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <fieldset className="filter-fieldset">
                      <legend>Order</legend>
                      <div className="sheet-options vertical">
                        {(["date", "mainboard_first", "sme_first"] as const).map((sort) => (
                          <button
                            aria-pressed={gmpSort === sort}
                            className={gmpSort === sort ? "active" : ""}
                            key={sort}
                            onClick={() => updateGmpSort(sort)}
                            type="button"
                          >
                            {sort === "date"
                              ? gmpFilter === "open"
                                ? "Closing soon first"
                                : "Opening soon first"
                              : sort === "mainboard_first"
                                ? "Mainboard first"
                                : "SME first"}
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <button
                      className="primary sheet-done"
                      onClick={() => setFilterSheetOpen(false)}
                      type="button"
                    >
                      Done
                    </button>
                  </section>
                </div>
              ) : null}

              <div className="gmp-results-anchor" ref={gmpResultsTop} />

              {gmpFilter !== "closed" && feedState.state === "cached" ? (
                <div className="feed-state cached" role="status">
                  <strong>Cached data</strong>
                  <span>
                    Last successful update {timeLabel(feedState.updatedAt)}. Live refresh is retrying automatically.
                  </span>
                </div>
              ) : null}

              {gmpFilter !== "closed" && feedState.state === "unavailable" ? (
                <div className="feed-state unavailable" role="status">
                  <strong>Live source temporarily unavailable</strong>
                  <span>No current data was replaced or guessed. Retrying automatically.</span>
                </div>
              ) : null}

              {gmpFilter === "closed" && closedFeedState.state === "cached" ? (
                <div className="feed-state cached" role="status">
                  <strong>Cached history</strong>
                  <span>Last saved update {timeLabel(closedFeedState.updatedAt)}.</span>
                </div>
              ) : null}

              {gmpFilter === "closed" && closedFeedState.state === "unavailable" ? (
                <div className="feed-state unavailable" role="status">
                  <strong>Closed IPO history temporarily unavailable</strong>
                  <span>The last visible rows were not replaced.</span>
                </div>
              ) : null}

              {showGmpSkeleton ? (
                <div className="gmp-list" aria-label="Loading IPO data" aria-busy="true">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div className="gmp-card skeleton-card" key={index}>
                      <div className="skeleton-copy">
                        <span className="skeleton-line title" />
                        <span className="skeleton-line meta" />
                        <span className="skeleton-line dates" />
                      </div>
                      {Array.from({ length: 5 }, (__, cell) => (
                        <span className="skeleton-line value" key={cell} />
                      ))}
                    </div>
                  ))}
                </div>
              ) : filteredGmp.length ? (
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
                          {gmpTimingLabel(row, gmpFilter, indiaDate()) ? (
                            <span className="timing-tag">
                              {gmpTimingLabel(row, gmpFilter, indiaDate())}
                            </span>
                          ) : null}
                        </div>
                        <p>
                          {statusLabel(gmpGroup(row))} &bull;{" "}
                          {row.gmpLastUpdated
                            ? `GMP updated ${timeLabel(row.gmpLastUpdated)}`
                            : "GMP update unavailable"}
                        </p>
                        <div className="date-strip">
                          {row.openDate ? <span>Open {dateLabel(row.openDate)}</span> : null}
                          {row.closeDate ? <span>Close {dateLabel(row.closeDate)}</span> : null}
                          {row.allotmentDate ? (
                            <span>Allot {dateLabel(row.allotmentDate)}</span>
                          ) : null}
                          {row.listingDate ? <span>List {dateLabel(row.listingDate)}</span> : null}
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
                        <span>Latest GMP</span>
                        <strong
                          className={
                            typeof row.gmp === "number" && row.gmp >= 0 ? "positive" : ""
                          }
                        >
                          {typeof row.gmp === "number" ? rupee(row.gmp) : "Not available"}
                        </strong>
                      </div>
                      <div className="gmp-cell">
                        <span>GMP %</span>
                        <strong
                          className={
                            typeof row.gmpPercent === "number" && row.gmpPercent >= 0
                              ? "positive"
                              : ""
                          }
                        >
                          {typeof row.gmpPercent === "number"
                            ? `${row.gmpPercent >= 0 ? "+" : ""}${row.gmpPercent.toFixed(1)}%`
                            : "Not available"}
                        </strong>
                      </div>
                      <div className="gmp-cell">
                        <span>Est. Listing</span>
                        <strong>
                          {typeof row.estimatedListingPrice === "number"
                            ? rupee(row.estimatedListingPrice)
                            : "Not available"}
                        </strong>
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
                              const pageSize = Number(event.target.value) as (typeof closedPageSizes)[number];
                              setClosedPage(1);
                              setClosedPageSize(pageSize);
                              updateViewHash("gmp", { page: 1, pageSize });
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
                          onClick={() => {
                            const page = Math.max(1, closedPage - 1);
                            setClosedPage(page);
                            updateViewHash("gmp", { page });
                          }}
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
                            onClick={() => {
                              setClosedPage(page);
                              updateViewHash("gmp", { page });
                            }}
                            type="button"
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          aria-label="Next closed IPO page"
                          className="page-button page-direction"
                          disabled={closedLoading || closedPage >= closedTotalPages}
                          onClick={() => {
                            const page = Math.min(closedTotalPages, closedPage + 1);
                            setClosedPage(page);
                            updateViewHash("gmp", { page });
                          }}
                          type="button"
                        >
                          Next
                        </button>
                      </nav>
                    </div>
                  ) : null}
                </div>
              ) :
                (gmpFilter !== "closed" && feedState.state === "unavailable") ||
                  (gmpFilter === "closed" && closedFeedState.state === "unavailable") ? null : (
                <div className="empty">
                  {closedLoading
                    ? "Loading closed IPO history..."
                    : feedLoading && gmpFilter !== "closed"
                      ? "Loading current IPO data..."
                      : gmpSearch.trim()
                          ? "No IPOs match this search."
                          : gmpFilter === "open"
                            ? feedState.state === "cached"
                              ? "No open IPO appears in this cached update."
                              : "No IPO is currently open."
                            : feedState.state === "cached" && gmpFilter === "upcoming"
                              ? "No upcoming IPO appears in this cached update."
                              : `No ${statusLabel(gmpFilter).toLowerCase()} IPOs are available right now.`}
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
