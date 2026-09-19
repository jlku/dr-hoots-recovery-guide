// tests/v2-reviews-index.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { badgeFor, buildReviewsIndex } from "../scripts/lib/reviews-index.mjs";

const root = resolve(import.meta.dirname, "..");
const member = (path, verdict, date = "2026-09-18") => ({ path, receipt: { verdict, reviewed_on: date } });

test("a badge says reviewed only for a full panel that passed the current target", () => {
  const passed = badgeFor("L", [member("a.json", "pass", "2026-09-18"), member("a.2.json", "pass", "2026-09-19"), member("a.3.json", "pass")], "h");
  assert.deepEqual(passed, { status: "reviewed", label: "L", date: "2026-09-19", target: "h", receipts: ["a.json", "a.2.json", "a.3.json"] });
  assert.equal(badgeFor("L", [member("a.json", "pass"), member("a.2.json", "pass")], "h").status, "not_reviewed");
  assert.equal(badgeFor("L", [member("a.json", "pass"), member("a.2.json", "fail"), member("a.3.json", "pass")], "h").status, "not_reviewed");
  assert.deepEqual(badgeFor("L", [], "h"), { status: "not_reviewed", label: "L", date: null, target: null, receipts: [] });
});

test("the committed reviews index is current", async () => {
  const committed = JSON.parse(await readFile(resolve(root, "content/reviews/index.json"), "utf8"));
  assert.deepEqual(committed, await buildReviewsIndex(root), "run npm run reviews:index");
});
