import test from "node:test";
import assert from "node:assert/strict";
import { alertToClient, mapAlertInput, mergePayload } from "../api/_lib/models.js";

test("mapAlertInput defaults an unknown type to 'empty' and normal priority", () => {
  const out = mapAlertInput({});
  assert.equal(out.type, "empty");
  assert.equal(out.priority, "normal");
  assert.equal(out.sku, null);
});

test("mapAlertInput rejects a priority outside the allowed set", () => {
  const out = mapAlertInput({ priority: "urgent!!" });
  assert.equal(out.priority, "normal");
  assert.equal(mapAlertInput({ priority: "high" }).priority, "high");
});

test("mapAlertInput trims and length-caps free text fields", () => {
  const out = mapAlertInput({ sku: "  6EG10E  ", note: "x".repeat(2000) });
  assert.equal(out.sku, "6EG10E");
  assert.equal(out.note.length, 1200);
});

test("mapAlertInput carries the V2 fields (quantity, reason, disposition...) into payload", () => {
  const out = mapAlertInput({ type: "quality", quantity: 3, reason: "Bent", disposition: "nonconforming_area" });
  assert.deepEqual(out.payload, { type: "quality", quantity: 3, reason: "Bent", disposition: "nonconforming_area" });
});

test("mapAlertInput.payload is null when there's nothing beyond the server-owned fields", () => {
  assert.equal(mapAlertInput({ status: "new", createdAt: "2026-01-01", by: "Jonathan" }).payload, null);
  assert.equal(mapAlertInput({}).payload, null);
});

test("alertToClient prefers server-owned columns over a stale copy in payload", () => {
  const row = {
    id: "1", type: "quality", sku: "6EG10E", status: "resolved", priority: "high",
    payload: { status: "new", priority: "low", reason: "Bent" }, // stale copy from before it was resolved
  };
  const out = alertToClient(row);
  assert.equal(out.status, "resolved");
  assert.equal(out.priority, "high");
  assert.equal(out.reason, "Bent"); // still comes through for fields the server doesn't own
});

test("alertToClient defaults priority to 'normal' when the column is empty", () => {
  assert.equal(alertToClient({ id: "1" }).priority, "normal");
});

test("mergePayload keeps the existing payload when the patch adds nothing", () => {
  const existing = { owner: "Jonathan" };
  assert.deepEqual(mergePayload(existing, {}), existing);
});

test("mergePayload overlays new fields without dropping the ones not being patched", () => {
  const existing = { owner: "Jonathan", reason: "Bent" };
  const merged = mergePayload(existing, { resolutionNote: "Fixed on the line" });
  assert.deepEqual(merged, { owner: "Jonathan", reason: "Bent", resolutionNote: "Fixed on the line" });
});
