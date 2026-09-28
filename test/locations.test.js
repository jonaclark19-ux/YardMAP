import test from "node:test";
import assert from "node:assert/strict";
import { importItems, normalizeItems, observe, setStatus } from "../api/_lib/locations.js";

test("a sighting near an existing spot for the same SKU updates it instead of adding one", () => {
  let r = observe([], { sku: "wt214", x: 100, y: 100, qty: 3 }, "Ana");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].sku, "WT214");
  r = observe(r.items, { sku: "WT214", x: 110, y: 105, qty: 7 }, "Luis");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].qty, 7);
  r = observe(r.items, { sku: "WT214", x: 400, y: 400 }, "Luis");
  assert.equal(r.items.length, 2, "far away is a second spot");
});

test("a sighting is always 'observed', whatever the client claims", () => {
  const r = observe([], { sku: "A", x: 1, y: 1, status: "approved" }, "Ana");
  assert.equal(r.items[0].status, "observed");
});

test("setStatus only accepts the known statuses", () => {
  const { items } = observe([], { sku: "A", x: 1, y: 1 }, "Ana");
  const id = items[0].id;
  assert.equal(setStatus(items, id, "approved", "Jefe").items[0].status, "approved");
  assert.equal(setStatus(items, id, "hacked", "Jefe").changed, false);
  assert.equal(setStatus(items, "missing", "approved", "Jefe").changed, false);
});

test("import only adds unknown ids, and a viewer's imports stay observed", () => {
  const base = normalizeItems([{ id: "loc_a", sku: "A", x: 1, y: 1, status: "approved" }]);
  const incoming = [
    { id: "loc_a", sku: "A", x: 1, y: 1, status: "dismissed" },
    { id: "loc_b", sku: "B", x: 5, y: 5, status: "approved" },
    { id: "bad", sku: "", x: 1, y: 1 },
  ];
  const viewer = importItems(base, incoming, "Ana", false);
  assert.equal(viewer.items.length, 2);
  assert.equal(viewer.items.find((i) => i.id === "loc_a").status, "approved", "existing ids untouched");
  assert.equal(viewer.items.find((i) => i.id === "loc_b").status, "observed");
  const editor = importItems(base, incoming, "Jefe", true);
  assert.equal(editor.items.find((i) => i.id === "loc_b").status, "approved");
});
