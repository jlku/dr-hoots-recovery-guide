import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("the PDF source composes all three instructions on one safety-pamphlet sheet", async () => {
  const [html, styles] = await Promise.all([
    readFile(resolve(root, "preview/airline-safety-pamphlet.html"), "utf8"),
    readFile(resolve(root, "preview/assets/airline-safety-pamphlet.css"), "utf8")
  ]);

  assert.equal((html.match(/<section class="instruction /g) ?? []).length, 3);
  assert.match(html, /Day 2/);
  assert.match(html, /During recovery/);
  assert.match(html, /After healing/);
  assert.match(html, /instruction-path/);
  assert.match(styles, /grid-template-columns: 1\.08fr \.84fr 1\.08fr/);
  assert.match(styles, /@page \{ size: letter landscape; margin: 0; \}/);
  assert.doesNotMatch(styles, /break-after|page-break-after/);
});
