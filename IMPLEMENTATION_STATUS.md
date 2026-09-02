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
- Barcode → part number conversion shipped with the build (`barcodes.js`, 2 896 codes from `seed/Part_Conversion.xlsx`)
- Product names on every scan, search result, report and export (`catalog.js` + the `Description` column of the imported inventory report)
- Search matches product names as well as part numbers
- The Control Center accepts the ERP conversion file as it comes (`PartNum` / `BarCode`)

## Requires external setup before online features run
- Create a Supabase project
- Run `supabase/schema.sql`
- Add Vercel environment variables from `.env.example`
- Deploy repository on Vercel

## Explicitly deferred by request
- #4 Location QR workflow
- #10 Dashboard/metrics screen
- #14 Favorites/recent searches
