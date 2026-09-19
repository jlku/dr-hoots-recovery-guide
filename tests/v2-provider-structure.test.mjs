// tests/v2-provider-structure.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "guide/provider.html"), "utf8");
const script = await readFile(resolve(root, "guide/assets/provider-page.js"), "utf8");

test("the provider page has one block to paste, the parsed table, what it could not read, the link, and the open questions", () => {
  for (const id of ["block", "parsed", "unread", "patient-link", "copy-link", "asks"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<textarea[^>]+id="block"/);
  assert.match(html, /<label[^>]+for="block"/, "the paste box has a visible label");
  assert.match(html, /Private prototype\. Not for patient use\./);
});

test("nothing leaves the page: no form posts, no credentials, and one fetch for the presets", () => {
  assert.doesNotMatch(html, /<form[^>]+action=/);
  assert.doesNotMatch(html + script, /api[_-]?key|FAL_KEY|anthropic|fal\.subscribe/i);
  const fetches = script.match(/fetch(Json)?\(/g) ?? [];
  assert.equal(fetches.length, 1, "the presets are the only thing the page loads");
  assert.match(script, /content\/provider\/presets\.json/);
});
