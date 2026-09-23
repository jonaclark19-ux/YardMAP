import test from "node:test";
import assert from "node:assert/strict";
import { esc, parseRecipients, recipientsFromGroups, resolveRecipients } from "../api/_lib/email.js";

test("parseRecipients accepts comma, semicolon, or whitespace separated addresses", () => {
  assert.deepEqual(
    parseRecipients("a@x.com, b@x.com;c@x.com  d@x.com"),
    ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
  );
});

test("parseRecipients drops entries that aren't a plausible email address", () => {
  assert.deepEqual(parseRecipients("a@x.com, not-an-email, @x.com, b@x"), ["a@x.com"]);
});

test("parseRecipients returns an empty list for empty or garbage input", () => {
  assert.deepEqual(parseRecipients(""), []);
  assert.deepEqual(parseRecipients(undefined), []);
  assert.deepEqual(parseRecipients("   "), []);
});

test("parseRecipients caps the list at the given max", () => {
  const many = Array.from({ length: 30 }, (_, i) => `u${i}@x.com`).join(",");
  assert.equal(parseRecipients(many, 5).length, 5);
});

test("esc escapes the five HTML-significant characters", () => {
  assert.equal(esc(`<script>alert("x")</script> & 'quote'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;");
});

test("esc coerces non-string input instead of throwing", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(42), "42");
});

test("recipientsFromGroups short-circuits on ids that are not uuids", async () => {
  // Nothing plausible to look up means no database round trip at all, which
  // is also what keeps this assertion from needing Supabase configured.
  assert.deepEqual(await recipientsFromGroups([]), []);
  assert.deepEqual(await recipientsFromGroups(["", "not-a-uuid", 42]), []);
  assert.deepEqual(await recipientsFromGroups(undefined), []);
});

test("resolveRecipients returns the hand-typed addresses when no group is picked", async () => {
  assert.deepEqual(
    await resolveRecipients({ to: "a@x.com, b@x.com", groupIds: [] }),
    ["a@x.com", "b@x.com"],
  );
});

test("resolveRecipients lowercases and de-duplicates", async () => {
  assert.deepEqual(
    await resolveRecipients({ to: "A@x.com, a@X.com, b@x.com" }),
    ["a@x.com", "b@x.com"],
  );
});

test("resolveRecipients drops garbage the same way parseRecipients does", async () => {
  assert.deepEqual(await resolveRecipients({ to: "nope, a@x.com, @x.com" }), ["a@x.com"]);
  assert.deepEqual(await resolveRecipients({}), []);
});

test("resolveRecipients caps the merged list at the given max", async () => {
  const many = Array.from({ length: 30 }, (_, i) => `u${i}@x.com`).join(",");
  assert.equal((await resolveRecipients({ to: many }, 5)).length, 5);
});
