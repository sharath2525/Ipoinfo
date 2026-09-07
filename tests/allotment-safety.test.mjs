import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOfficialResult,
  containsExplicitNoRecord
} from "../lib/providers/allotment-result.ts";
import {
  officialAllotmentUrl,
  withOfficialFallback
} from "../lib/providers/official-registrar.ts";

test("generic record-not-found text is not treated as Not Applied", () => {
  assert.equal(containsExplicitNoRecord("Record not found"), false);
  assert.equal(containsExplicitNoRecord("No records found"), false);
});

test("only PAN-specific no-application text is explicit", () => {
  assert.equal(containsExplicitNoRecord("No application found for this PAN"), true);
  assert.equal(containsExplicitNoRecord("PAN number was not found"), true);
});

test("an empty official record remains unavailable", () => {
  assert.equal(classifyOfficialResult({ signal: "record" }).status, "unavailable");
});

test("allotment quantities require application evidence", () => {
  assert.equal(
    classifyOfficialResult({
      signal: "record",
      applicationNo: "SYNTHETIC-APPLICATION",
      allottedQuantity: 0
    }).status,
    "not_allotted"
  );
  assert.equal(
    classifyOfficialResult({
      signal: "record",
      appliedQuantity: 10,
      allottedQuantity: 5
    }).status,
    "allotted"
  );
});

test("untrusted result links are replaced with an official destination", () => {
  assert.equal(
    officialAllotmentUrl({
      registrar: "Bigshare Services",
      allotmentUrl: "https://untrusted.example/status"
    }),
    "https://ipo.bigshareonline.com/ipo_status.html"
  );
});

test("non-final results always receive an official fallback", () => {
  const ipo = {
    id: "synthetic-ipo",
    name: "Synthetic IPO",
    issuePriceMax: 0,
    lotSize: 0,
    openDate: "",
    closeDate: "",
    allotmentDate: "",
    listingDate: "",
    registrar: "KFin Technologies",
    status: "closed",
    allotmentAvailability: "available"
  };
  const result = withOfficialFallback(
    {
      ipoId: ipo.id,
      ipoName: ipo.name,
      pan: "SYNTHETIC",
      status: "unavailable",
      registrar: ipo.registrar,
      checkedAt: new Date(0).toISOString()
    },
    ipo
  );

  assert.equal(result.actionLabel, "Check on official registrar");
  assert.equal(result.actionUrl, "https://ipostatus.kfintech.com/");
});
