-- Tarter Yard Map — carry the V2.3.2 operational report fields.
-- Run once in Supabase > SQL Editor, after schema.sql.
--
-- The alerts table was designed for the V1 report, which had nine fields. The
-- V2 report carries about twenty-two: quantity, reason, disposition, the
-- inventory comparison, the workflow timeline, the owner, and -- critically --
-- opsVersion, which is what the Control Center filters on. Rather than adding a
-- column per field and migrating again the next time the form changes, the
-- whole client payload rides in one jsonb column. The dedicated columns stay
-- authoritative for anything the server owns or indexes (status, timestamps,
-- priority, sku), so queries and the recurrence RPC are unaffected.

alter table public.alerts add column if not exists payload jsonb;

comment on column public.alerts.payload is
  'Full client report payload (V2+). Server-owned columns win on read; see api/_lib/models.js.';
