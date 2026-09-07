import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataUrl = new URL("../data/closed-ipo-backup.json", import.meta.url);
const metaUrl = new URL("../data/ipo-snapshot-meta.json", import.meta.url);

test("closed IPO snapshot contains the complete paginated history", async () => {
  const rows = JSON.parse(await readFile(dataUrl, "utf8"));
  const meta = JSON.parse(await readFile(metaUrl, "utf8"));
  const ids = new Set(rows.map((row) => row.id));

  assert.ok(rows.length >= 1200);
  assert.equal(rows.length, meta.closed);
  assert.equal(ids.size, rows.length);

  for (const pageSize of [25, 50, 100]) {
    const pageCount = Math.ceil(rows.length / pageSize);
    const finalPage = rows.slice((pageCount - 1) * pageSize, pageCount * pageSize);
    assert.ok(finalPage.length > 0 && finalPage.length <= pageSize);
  }
});

