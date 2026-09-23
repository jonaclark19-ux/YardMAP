# Implementation status

## Implemented in code
- Vercel Functions backend using the existing `/api/*` frontend contract
- Admin/Viewer authentication with hashed access codes and HttpOnly signed session cookie
- Supabase schema with RLS enabled and server-side-only privileged access
- Shared map state, revision conflicts and polling sync
- Four-step alert workflow, priority, assignment and time-open display
- Alert evidence photos via Supabase Storage
- Found-out-of-place admin actions
- Per-SKU last verification
- Map history / restore
- Audit log
- Advisory admin edit lock + revision conflict safety
- User management
- Repeated-issue list for 30-day reports
- Announcements
- Zone operational status with map overlays
- Deep links by SKU and Share action
- Shift handoff
- PWA manifest/service worker/icons

## Requires external setup before online features run
- Create a Supabase project
- Run `supabase/schema.sql`
- Add Vercel environment variables from `.env.example`
- Deploy repository on Vercel

## Explicitly deferred by request
- #4 Location QR workflow
- #10 Dashboard/metrics screen
- #14 Favorites/recent searches
