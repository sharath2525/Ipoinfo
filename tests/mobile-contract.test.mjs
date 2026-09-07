import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile layout and controls retain the 320px safety contract", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /\.captcha-refresh[\s\S]*?width: 44px;[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.filter \{[\s\S]*?min-height: 44px;/);
  assert.match(page, /aria-label="Refresh CAPTCHA"/);
  assert.match(page, /secondary result-reset/);
  assert.doesNotMatch(page, /gmp-view-arrow/);
});
