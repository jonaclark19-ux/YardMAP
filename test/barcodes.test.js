import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* barcodes.json is data the app trusts on every scan, and it is regenerated
   by hand from an ERP export. These pin down the properties that have already
   gone wrong once, so a regeneration that repeats the mistake fails here
   instead of in the yard. */

const file = JSON.parse(readFileSync(new URL("../barcodes.json", import.meta.url), "utf8"));
const items = file.items;

test("barcodes.json keeps the codes shared by two variants", () => {
  // An earlier generation dropped every code printed on two variants of the
  // same product, so scanning a WT214 trough or a 16GC10 gate found nothing.
  assert.deepEqual(items["704496065337"], ["WT214", "WT214T"]);
  assert.deepEqual(items["0704496065337"], ["WT214", "WT214T"]);
  assert.deepEqual(items["704496210010"], ["16GC10", "16GC10T"]);
  assert.ok(file.shared >= 34, `expected at least 34 shared codes, got ${file.shared}`);
});

test("barcodes.json knows both the 12-digit and the 13-digit form of a label", () => {
  assert.equal(items["704486020442"], "BB205BL");
  assert.equal(items["0704486020442"], "BB205BL");
});

test("barcodes.json keeps part numbers the way the ERP writes them", () => {
  assert.equal(items["704496004688"], "P-P1811");
});

test("barcodes.json has no all-zero filler codes", () => {
  // A blank or zeroed scan must not resolve to whatever part sat next to the
  // filler row in the export.
  for (const code of Object.keys(items)) {
    assert.ok(!/^0+$/.test(code), `filler code ${code} should not be in the list`);
  }
});

test("barcodes.json count matches its items", () => {
  assert.equal(file.count, Object.keys(items).length);
  for (const [code, parts] of Object.entries(items)) {
    const list = Array.isArray(parts) ? parts : [parts];
    assert.ok(list.length >= 1 && list.every((p) => typeof p === "string" && p), `bad entry for ${code}`);
  }
});
