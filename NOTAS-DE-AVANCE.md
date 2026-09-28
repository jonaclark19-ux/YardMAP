# Notas de avance

Dónde quedó el trabajo y qué sigue. Las reglas del proyecto están en
[`CLAUDE.md`](CLAUDE.md); los hallazgos y su estado, en [`REVISION.md`](REVISION.md).

---

## 28 sep 2026 — Se juntan las dos sesiones y se prepara el lanzamiento

Otra vez hubo dos líneas de trabajo desde el mismo punto (PR #54): la sesión
"TARTER YARDMAP" (rama `claude/yard-map-barcode-conversion-b7e4k3`, escáner,
catálogo y reglas) y la de revisión completa (PR #55, #56, #57 en `main`). Se
juntaron con un merge normal: `index.html` combinó sin conflictos y los tres
conflictos (`.gitignore`, `README_SETUP.md`, `schema.sql`) eran la misma idea
escrita dos veces.

Ya en `main` y en producción:
- **Fotos**: hasta 5 por reporte, desde la cámara o la galería; se suben antes
  de crear el reporte (arregla #1) y se ven en todos los aparatos.
- **Seguridad**: límite de intentos en login/registro/fotos, códigos de 6+,
  sesiones que se cierran al cambiar el código, URLs de fotos validadas (#6),
  grupos de correo solo para editores, cabeceras CSP (#9), último editor
  protegido (#8), registro con **dos códigos de invitación** (viewer y editor, #4).
- **Datos**: `/api/sync` usa la misma lista que `/api/alerts` y pagina más allá
  de 1000 filas (#2); la línea de tiempo se guarda en el servidor; ubicaciones
  secundarias compartidas; inventario grande como Excel binario (#14); si el
  servidor no responde la app ya no se pasa sola a modo local (#13).
- **Centro de Control → Users** (#7).
- **SheetJS 0.20.3** bajo demanda y sitio servido solo desde `public/` (#16).
- **Retención** cuenta desde la fecha de resolución (#12).
- Base de producción limpiada para el lanzamiento (29 reportes, 780 registros de
  auditoría y 2 cuentas de prueba); respaldo en `backup.prelaunch_20260928`.

Pendiente del usuario:
- Borrar las 11 fotos de prueba en Supabase → Storage → `yard-alerts` → `2026/09`.
- Cambiar a *Sensitive* los secretos de Vercel (#10).

---

## 23 sep 2026 — Consolidación

Había dos versiones del proyecto. La rama `claude/yard-map-barcode-conversion-b7e4k3`
salió de `main` a principios de septiembre y siguió sola mientras `main` —lo
publicado— recibía 63 commits. Se consolidó así:

1. **La rama pasó a ser `main`**: un merge que deja el árbol idéntico a `main`,
   sin reescribir historia ni forzar el push.
2. **Encima, solo lo que `main` no tenía**, probado en el navegador contra la
   app real:
   - Al escanear se lee **el producto**, no el número: en el resultado, en el
     aviso y en la búsqueda (buscar "box blade" encuentra por nombre).
   - Los **34 códigos compartidos por dos variantes** (WT214/WT214T,
     16GC10/16GC10T…) que `barcodes.json` descartaba ahora resuelven, a la
     variante que tiene lugar en el mapa.
   - Un Excel de códigos que carga un editor **se guarda en el mapa** y llega a
     todos los aparatos. Solo se guarda lo distinto de `barcodes.json`.
   - El escáner dice **qué falló** en vez de "cámara denegada" para todo, y el
     lector de iPhone se precarga al abrir la app.
3. **Blindaje** para que no vuelva a pasar: `CLAUDE.md`, `schema.sql` completo
   (probado en Postgres, desde cero y como actualización), `.env.example`,
   `.gitignore` que bloquea `.env` y `.vercel/`, y `test/barcodes.test.js`.

**No se trajo** el sistema visual "Galvanized" de la rama vieja: `main` ya tiene
`tarter-brand-theme`.

## Pendiente del usuario

- **Correr `supabase/schema.sql` en la Supabase de producción** (SQL Editor). No
  borra nada; agrega lo que falte, fija el `search_path` de las funciones, le
  quita a la llave anónima el permiso de ejecutarlas y corrige el candado de
  edición que respondía dos veces.
- **Vercel → Settings → Environment Variables:** cambiar a tipo *Sensitive*
  `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `CRON_SECRET`,
  `INVENTORY_IMPORT_SECRET`, `SMTP_PASS` y `BOOTSTRAP_ADMIN_CODE`.
- **Decidir sobre el registro abierto** (REVISION #4).

## Lo que sigue

En orden, de `REVISION.md`:

1. #1 — la foto de un reporte hecho por un viewer nunca se enlaza.
2. #2 — `/api/sync` volvió a la lista plana de 1500.
3. #5, #6, #8, #9 — límite de intentos de login, SSRF en el correo, último
   editor, headers de seguridad.
4. #7 — pantalla de usuarios.
5. #12, #13 — retención por fecha de resolución; aviso cuando el servidor falla.
