import assert from "node:assert/strict";
import test from "node:test";
import { refreshedCaptchaState } from "../lib/captcha-state.ts";
import { toGmpRows } from "../lib/gmp-values.ts";
import {
  gmpTimingLabel,
  paginationWindow,
  parseGmpViewHash,
  serializeGmpViewHash,
  sortAndFilterGmpRows
} from "../lib/gmp-view.ts";
import {
  effectiveIpoStatus,
  indiaDate,
  ipoNameKey,
  isoDateOnly,
  sanitizeIpoDates
} from "../lib/ipo-normalization.ts";
import { selectPublicSnapshot } from "../lib/public-snapshot.ts";

function row(overrides) {
  return {
    id: overrides.id,
    name: overrides.name,
    marketType: overrides.marketType ?? "Mainboard",
    issuePriceMax: 100,
    lotSize: 10,
    openDate: overrides.openDate ?? "2026-09-01",
    closeDate: overrides.closeDate ?? "2026-09-05",
    allotmentDate: "",
    listingDate: "",
    registrar: "Registrar",
    status: overrides.status ?? "closed",
    allotmentAvailability: "unavailable"
  };
}

test("India midnight reclassifies an IPO from upcoming to open", () => {
  const ipo = row({
    id: "midnight",
    name: "Midnight IPO",
    openDate: "2026-09-07",
    closeDate: "2026-09-09",
    status: "upcoming"
  });
  const beforeMidnight = new Date("2026-09-06T18:29:59.000Z");
  const atMidnight = new Date("2026-09-06T18:30:00.000Z");

  assert.equal(indiaDate(beforeMidnight), "2026-09-06");
  assert.equal(effectiveIpoStatus(ipo, beforeMidnight), "upcoming");
  assert.equal(indiaDate(atMidnight), "2026-09-07");
  assert.equal(effectiveIpoStatus(ipo, atMidnight), "open");
});

test("duplicate decorated company names resolve to one canonical key", () => {
  assert.equal(
    ipoNameKey("Example Industries Ltd (MAINBOARD) Closing Today IPO"),
    ipoNameKey("Example Industries Limited IPO")
  );
});

test("invalid dates, years, and impossible chronology are rejected", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  assert.equal(isoDateOnly("2026-02-31", now), "");
  assert.equal(isoDateOnly("2099-01-01", now), "");
  assert.deepEqual(
    sanitizeIpoDates(
      {
        openDate: "2026-09-10",
        closeDate: "2026-09-01",
        allotmentDate: "2026-08-30",
        listingDate: "2026-08-31"
      },
      now
    ),
    { openDate: "", closeDate: "", allotmentDate: "2026-08-30", listingDate: "2026-08-31" }
  );
});

test("partial rows remain usable and missing dates sort last", () => {
  const rows = [
    row({ id: "partial", name: "Partial IPO", openDate: "", closeDate: "", status: "open" }),
    row({ id: "soon", name: "Soon IPO", closeDate: "2026-09-07", status: "open" })
  ];
  assert.deepEqual(
    sortAndFilterGmpRows(rows, "open", "all", "date").map((item) => item.id),
    ["soon", "partial"]
  );
});

test("missing GMP and prices are never converted into invented zero values", () => {
  const [missing] = toGmpRows([
    { ...row({ id: "missing", name: "Missing GMP IPO" }), issuePriceMax: 0 }
  ]);
  assert.equal(missing.gmp, undefined);
  assert.equal(missing.gmpPercent, undefined);
  assert.equal(missing.estimatedListingPrice, undefined);

  const [reportedZero] = toGmpRows([
    { ...row({ id: "zero", name: "Reported Zero IPO" }), gmp: 0 }
  ]);
  assert.equal(reportedZero.gmp, 0);
  assert.equal(reportedZero.estimatedListingPrice, 100);
});

test("timing labels appear only when verified dates support them", () => {
  const today = "2026-09-06";
  assert.equal(
    gmpTimingLabel(row({ id: "close", name: "Close IPO", closeDate: today, status: "open" }), "open", today),
    "Closes Today"
  );
  assert.equal(
    gmpTimingLabel(row({ id: "open", name: "Open IPO", openDate: "2026-09-07", status: "upcoming" }), "upcoming", today),
    "Opens Tomorrow"
  );
  assert.equal(
    gmpTimingLabel(
      {
        ...row({ id: "allot", name: "Allot IPO" }),
        allotmentDate: "2026-09-07",
        allotmentAvailability: "expected_soon"
      },
      "closed",
      today
    ),
    "Allotment Expected"
  );
  assert.equal(
    gmpTimingLabel(row({ id: "unknown", name: "Unknown IPO", closeDate: "", status: "open" }), "open", today),
    ""
  );
});

test("source outage selects the last usable public snapshot", () => {
  const cached = { ipos: [row({ id: "cached", name: "Cached IPO" })], gmp: [{}] };
  assert.equal(selectPublicSnapshot(null, cached).source, "cached");
  assert.equal(
    selectPublicSnapshot({ ipos: [row({ id: "partial", name: "Partial IPO" })], gmp: [] }, cached)
      .source,
    "cached"
  );
  assert.equal(selectPublicSnapshot({ ipos: [], gmp: [] }, null).source, "unavailable");
});

test("CAPTCHA refresh replaces the token and clears old input", () => {
  const refreshed = refreshedCaptchaState({ token: "new-token", image: "data:image/png;base64,new" });
  assert.equal(refreshed.token, "new-token");
  assert.equal(refreshed.answer, "");
  assert.equal(refreshed.loading, false);
});

test("GMP tab, filter, sort, and closed pagination survive refresh", () => {
  const state = {
    category: "closed",
    market: "all",
    sort: "date",
    page: 8,
    pageSize: 50
  };
  assert.deepEqual(parseGmpViewHash(serializeGmpViewHash(state)), state);
  assert.deepEqual(paginationWindow(8, 20), [7, 8, 9]);
});
