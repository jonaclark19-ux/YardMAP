# Implementation status

> Para retomar el trabajo desde otra sesión, empezar por
> [`NOTAS-DE-AVANCE.md`](NOTAS-DE-AVANCE.md): dónde quedó todo, qué sigue,
> y cómo está armado el `index.html` por dentro.

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
- The conversion table and the product names ride inside the shared map state, so loading the Excel once reaches every device on the next sync
- Only the rows that differ from the shipped table are stored in the map, keeping the state small
- The Control Center writes the updated `barcodes.js` back out, for baking a new list into the build itself

## Requires external setup before online features run
- Create a Supabase project
- Run `supabase/schema.sql`
- Add Vercel environment variables from `.env.example`
- Deploy repository on Vercel

## Explicitly deferred by request
- #4 Location QR workflow
- #10 Dashboard/metrics screen
- #14 Favorites/recent searches
