import test from "node:test";
import assert from "node:assert/strict";
import { esc, parseRecipients } from "../api/_lib/email.js";

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
