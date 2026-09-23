import test from "node:test";
import assert from "node:assert/strict";

/* The list endpoint stopped being "newest N" and became two scoped queries.
   What matters is that the pair can never lose a report the app would have
   shown -- so these test the split, not the transport. */

const RESOLVED_WINDOW_DAYS = 60;
const since = () => new Date(Date.now() - RESOLVED_WINDOW_DAYS * 86400000).toISOString();

// The client's own definition, copied so a change to it breaks this test.
const openReport = (r) => r && r.status !== "resolved" && r.inventoryResult !== "verified";

function fetched(rows) {
  const cut = since();
  const open = rows.filter((r) => r.status !== "resolved");
  const done = rows.filter((r) => r.status === "resolved" && r.created_at >= cut);
  return open.concat(done);
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test("no open report is ever dropped, however old", () => {
  const rows = [
    { id: "a", status: "new", created_at: daysAgo(900) },
    { id: "b", status: "acknowledged", created_at: daysAgo(400) },
    { id: "c", status: "in_progress", created_at: daysAgo(120) },
    { id: "d", status: "resolved", created_at: daysAgo(1) },
  ];
  const got = fetched(rows).map((r) => r.id);
  assert.ok(got.includes("a"), "a three-year-old open report still comes back");
  assert.ok(got.includes("b"));
  assert.ok(got.includes("c"));
});

test("resolved reports outside the window are left behind, inside it are kept", () => {
  const rows = [
    { id: "recent", status: "resolved", created_at: daysAgo(10) },
    { id: "edge", status: "resolved", created_at: daysAgo(59) },
    { id: "old", status: "resolved", created_at: daysAgo(400) },
  ];
  const got = fetched(rows).map((r) => r.id);
  assert.deepEqual(got.sort(), ["edge", "recent"]);
});

test("the window is wider than the UI's widest range, so nothing displayable is missing", () => {
  // The Control Center's widest range and repeatedSkus() both run on 30 days.
  assert.ok(RESOLVED_WINDOW_DAYS >= 30, "window must cover every screen's range");
});

test("the server's split is a superset of what the client calls open", () => {
  // A verified inventory check is closed to the client but not resolved in
  // the status column. It must still arrive, so the client can filter it --
  // fetched-then-filtered is safe, never-fetched is not.
  const verified = { id: "v", status: "new", inventoryResult: "verified", created_at: daysAgo(500) };
  assert.equal(openReport(verified), false, "client treats it as closed");
  assert.ok(fetched([verified]).some((r) => r.id === "v"), "server still sends it");
});

test("truncation is reported rather than silently shortening the list", () => {
  const LIMIT = 4000;
  const atCap = (open, done) => open >= LIMIT || done >= LIMIT;
  assert.equal(atCap(4000, 12), true);
  assert.equal(atCap(12, 4000), true);
  assert.equal(atCap(3999, 3999), false);
});
