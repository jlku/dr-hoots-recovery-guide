import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("the PDF source composes all fourteen cards across two print sheets", async () => {
  const html = await readFile(resolve(root, "preview/airline-safety-pamphlet.html"), "utf8");

  assert.equal((html.match(/data-sheet="[12]"/g) ?? []).length, 2);
  const cardNumbers = [...html.matchAll(/class="card[^\"]*\bc(\d+)\b/g)].map((match) => Number(match[1]));
  assert.deepEqual(cardNumbers, Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal((html.match(/assets\/generated\/card-/g) ?? []).length, 13);
  assert.match(html, /card--contact c11/);
  assert.match(html, /Care for the surgery site/);
  assert.match(html, /Know when to call/);
  assert.match(html, /@page \{ size: 17in 11in; margin: 0; \}/);
  assert.match(html, /\.\.\/output\/pdf\/airline-safety-card-deck-prototype\.pdf/);
});
