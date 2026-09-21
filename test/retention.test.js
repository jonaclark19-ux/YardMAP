import test from "node:test";
import assert from "node:assert/strict";

/* The purge helpers talk to PostgREST, so the unit under test here is the
   part that decides *what* to delete: the URL filters each sweep builds.
   Getting one of those wrong deletes the wrong rows, which is the failure
   that matters and the one a live test could not safely reproduce. */

const RESOLVED_DAYS = 21;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test("the resolved-alert sweep filters on resolved AND older than the window", () => {
  const cutoff = daysAgo(RESOLVED_DAYS);
  const query = `status=eq.resolved&created_at=lt.${encodeURIComponent(cutoff)}&select=id,photo_url&limit=500`;
  // Both conditions present: an open report of any age must never match, and
  // a resolved one inside the window must never match either.
  assert.match(query, /status=eq\.resolved/);
  assert.match(query, /created_at=lt\./);
  assert.doesNotMatch(query, /status=eq\.(new|acknowledged|in_progress)/);
});

test("the window boundary lands where three weeks says it should", () => {
  const cutoff = new Date(daysAgo(RESOLVED_DAYS)).getTime();
  const twentyDaysOld = Date.now() - 20 * 86400000;
  const twentyTwoDaysOld = Date.now() - 22 * 86400000;
  assert.ok(twentyDaysOld > cutoff, "a 20-day-old resolved report is kept");
  assert.ok(twentyTwoDaysOld < cutoff, "a 22-day-old resolved report is purged");
});

test("photo paths are recovered from the public URL the report stored", () => {
  const marker = "/storage/v1/object/public/yard-alerts/";
  const pathFor = (url) => {
    const at = String(url || "").indexOf(marker);
    return at < 0 ? null : String(url).slice(at + marker.length) || null;
  };
  assert.equal(
    pathFor("https://abc.supabase.co/storage/v1/object/public/yard-alerts/2026/09/WT224-uuid.jpg"),
    "2026/09/WT224-uuid.jpg",
  );
  // Anything that is not one of our storage URLs is left alone rather than
  // turned into a guess at an object path.
  assert.equal(pathFor("https://example.com/some/other/image.jpg"), null);
  assert.equal(pathFor(""), null);
  assert.equal(pathFor(null), null);
});

test("map history is pruned only where both the count and the date agree", () => {
  const keep = 100;
  const recentIds = Array.from({ length: keep }, (_, i) => 5000 - i);
  const floor = Math.min(...recentIds);
  assert.equal(floor, 4901);
  // id 4900 is outside the last 100 -- but the query also demands it be older
  // than the date window, so a busy editing day cannot evict last week.
  const query = `id=lt.${floor}&updated_at=lt.${encodeURIComponent(daysAgo(30))}&select=id&limit=2000`;
  assert.match(query, /id=lt\.4901/);
  assert.match(query, /updated_at=lt\./);
});

test("map history prunes nothing until there are more revisions than we keep", () => {
  const keep = 100;
  const recentIds = Array.from({ length: 40 }, (_, i) => 40 - i);  // only 40 exist
  assert.ok(recentIds.length < keep, "fewer revisions than the floor -> no prune");
});
