TARTER YARD MAP — VERCEL TEMPORARY DEPLOY

This folder is ready to deploy as a static site.

FILES
- index.html: application entry point (required for the root URL)
- tarter-yard-map.json: current map backup/export (2026-08-03)
- fotos3point.xlsx: photo/SKU reference workbook

IMPORTANT
- No npm install and no build command are required.
- On Vercel, use Framework Preset: Other.
- Leave Build Command and Output Directory unset for this static deployment.
- The current HTML tries /api/* routes for the optional shared backend.
  If no backend exists, it intentionally falls back to Local Mode/localStorage.
- In Local Mode, edits are stored only in that browser/device and are not shared.
- The latest uploaded JSON has been embedded into index.html so the deployed demo
  starts with the current map data.

FASTEST TEMPORARY DEPLOY
1. Open Vercel Drop.
2. Drag this folder (or extract the ZIP and drag the folder).
3. Vercel returns a temporary deployment URL.

GITHUB DEPLOY
1. Create a repository.
2. Upload the CONTENTS of this folder to the repository root.
3. Import that repository in Vercel.
4. Framework Preset: Other.
5. Root Directory: repository root.
6. No build command / no output directory.
7. Deploy.
