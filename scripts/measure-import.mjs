// How much of a real practice's instructions this page can actually read:
//   node scripts/measure-import.mjs <directory of .txt files>
// Points at a directory of after-visit summaries and reports, per document, which of the driving values
// the parser resolves, which lines it matched but could not read, and how much text it accounts for.
// The documents themselves belong to the institutions that published them and live outside this
// repository; only the numbers come back. See qa/import/README.md.
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { FIELD_ORDER, parseProviderBlock, stripBullet } from "../guide/assets/provider.js";

// A driving line is accounted for by the table, not by a review list.
const DRIVING = /^(antibiotics?|abx|pain\b|follow[ -]?up|f\/u|fu|return to clinic|rtc|video guide|languages?|lang)/i;

const dir = resolve(process.argv[2] ?? "qa/import");
const files = (await readdir(dir)).filter((name) => name.endsWith(".txt")).sort();
if (!files.length) throw new Error(`no .txt files in ${dir}`);

const rows = [];
for (const name of files) {
  const text = await readFile(join(dir, name), "utf8");
  const parsed = parseProviderBlock(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const shown = [...parsed.other.map((entry) => entry.text), ...parsed.unread, ...Object.values(parsed.unclear)].join("\n");
  rows.push({
    name: basename(name, ".txt"),
    lines: lines.length,
    resolved: FIELD_ORDER.filter((field) => field in parsed.fields),
    unreadable: parsed.needs_choice,
    accounted: lines.filter((line) => shown.includes(line) || DRIVING.test(stripBullet(line))).length
  });
}

const touched = rows.filter((row) => row.resolved.length || row.unreadable.length).length;
const resolving = rows.filter((row) => row.resolved.length).length;
const perField = Object.fromEntries(FIELD_ORDER.map((field) => [field, rows.filter((row) => row.resolved.includes(field)).length]));

for (const row of rows) {
  const mark = row.resolved.length ? row.resolved.join(",") : row.unreadable.length ? `(asks: ${row.unreadable.join(",")})` : "nothing";
  console.log(`${row.name.slice(0, 44).padEnd(46)} ${String(row.accounted).padStart(3)}/${String(row.lines).padEnd(4)} lines shown   ${mark}`);
}
console.log("");
console.log(`${rows.length} documents: ${resolving} yield a value, ${touched - resolving} match a line but read nothing, ${rows.length - touched} match nothing at all.`);
console.log(`by field: ${FIELD_ORDER.map((field) => `${field} ${perField[field]}`).join(", ")}`);
const shownTotal = rows.reduce((sum, row) => sum + row.accounted, 0);
const lineTotal = rows.reduce((sum, row) => sum + row.lines, 0);
console.log(`${shownTotal} of ${lineTotal} lines (${Math.round((shownTotal / lineTotal) * 100)}%) are shown back to the clinician somewhere on the page.`);
