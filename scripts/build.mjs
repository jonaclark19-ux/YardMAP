/* Assembles public/, the only directory Vercel serves as static files
   (vercel.json "outputDirectory"). The API in api/ is deployed separately
   and is unaffected.

   Two reasons this step exists:
   - SheetJS 0.20+ is published only on cdn.sheetjs.com, not the npm
     registry. package.json installs it from there, and this copies the
     browser build out of node_modules, so the page and the API always run
     the same version.
   - Serving an explicit list keeps everything else in the repository
     (setup notes, schema, tests, node_modules) off the public site. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public");
const MIN_XLSX = [0, 20, 0];

const STATIC = ["index.html", "catalog.js", "sw.js", "manifest.webmanifest", "barcodes.json", "icons"];

function version(v) { return String(v).split(".").map((n) => parseInt(n, 10) || 0); }
function atLeast(v, min) {
  for (let i = 0; i < min.length; i++) {
    if ((v[i] || 0) !== min[i]) return (v[i] || 0) > min[i];
  }
  return true;
}

const pkgPath = join(root, "node_modules", "xlsx", "package.json");
if (!existsSync(pkgPath)) throw new Error("xlsx is not installed: run npm install first");
const xlsxVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version;
// Refuse to ship the old library by accident (a stale lockfile, an npm
// mirror serving 0.18.5); XLSX_ALLOW_OLD=1 is only for local previews.
if (!atLeast(version(xlsxVersion), MIN_XLSX) && process.env.XLSX_ALLOW_OLD !== "1") {
  throw new Error(`xlsx ${xlsxVersion} installed; ${MIN_XLSX.join(".")}+ required (see package.json)`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor"), { recursive: true });
for (const item of STATIC) cpSync(join(root, item), join(out, item), { recursive: true });
cpSync(join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js"), join(out, "vendor", "xlsx.full.min.js"));

const kb = (p) => `${Math.round(statSync(join(out, p)).size / 1024)} KB`;
console.log(`public/ ready · xlsx ${xlsxVersion} · index.html ${kb("index.html")} · vendor/xlsx.full.min.js ${kb("vendor/xlsx.full.min.js")}`);
