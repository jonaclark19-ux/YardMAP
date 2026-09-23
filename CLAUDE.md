# Tarter Yard Map — reglas del proyecto

Mapa de la yarda de Tarter West: ubicación de productos, escaneo de códigos de
barras y reportes operativos. Frontend en un solo `index.html`, backend en
Vercel Functions (`api/`), base en Supabase.

## Antes de tocar nada

**`main` es lo que está publicado.** El proyecto `yardmap` de Vercel despliega
`main` a producción en cada push. Cualquier otra rama es un preview.

1. `git fetch origin main` y mirar cuánto le falta a la rama actual:
   `git rev-list --count HEAD..origin/main`. Si no es 0, **primero traer `main`**.
2. Una rama nueva sale siempre de `origin/main`, nunca de una rama vieja.
3. Revisar, probar o arreglar algo = sobre `main` actualizado.

Esto ya pasó una vez: una sesión trabajó semanas sobre una rama sacada de un
`main` viejo, mientras `main` recibía 63 commits. Revisó el código equivocado,
arregló cosas que `main` ya había resuelto de otra forma, y su preview no se
podía publicar.

## Límites que rompen el deploy

- **Plan Hobby: máximo 12 funciones por deploy.** Cada archivo en `api/` (fuera
  de `api/_lib/`) es una función. Para un endpoint nuevo, se agrega una ruta
  `?route=` a un archivo existente y un `rewrite` en `vercel.json`, no un
  archivo nuevo.
- **4.5 MB por petición.** Vercel corta el cuerpo antes de llegar a la función.

## Base de datos

- **`supabase/schema.sql` tiene que construir toda la base que usa el código**, y
  poder correrse otra vez sin error. Nunca agregar una columna a mano en el
  editor de Supabase sin ponerla también ahí: `yard_users.onboarded_at` existió
  un tiempo solo en producción, y la base no se podía volver a montar desde el
  repositorio.
- Todo pasa por las funciones de Vercel con la llave del servidor. Las tablas
  tienen RLS sin políticas y la llave anónima no ejecuta ninguna función
  `yard_*`. Mantenerlo así.
- Para probar el esquema: `psql` local, correrlo sobre una base vacía (dos
  veces) y sobre una copia del esquema anterior. No probar contra producción.

## Antes de hacer push

```
npm test                      # node --test, sobre test/
```
y `node --check` sobre cada `<script>` del `index.html` si se tocó.

## El `index.html`

~1.6 MB, un solo archivo, con varios módulos apilados. **Un módulo posterior
puede reemplazar en tiempo de ejecución lo que armó uno anterior**: el Control
Center actual (`tarter-control-center-v23`) reconstruye `#opsCenter` entero,
así que un botón agregado en el Control Center viejo nunca aparece. Después de
cambiar algo visible, **abrir la app en el navegador y comprobar que se ve**, no
solo que el código está.

- El sistema visual es `tarter-brand-theme` (theme/). No agregar un segundo
  sistema de estilos encima.
- Para probar sin backend: servir la carpeta (`python3 -m http.server`) y entrar
  con *Continue offline*.

## Códigos de barras

- `barcodes.json` = código de barras → número de parte. Se actualiza con
  `python3 tools/build-barcode-map.py ruta/Part_Conversion.xlsx`, que **agrega**
  sobre el archivo actual y nunca borra. `test/barcodes.test.js` protege lo que
  ya se rompió una vez (códigos compartidos por dos variantes, ceros de relleno).
- Un Excel cargado desde la app por un editor se guarda en el mapa
  (`data.barcodes`, solo lo distinto de `barcodes.json`) y llega a todos los
  aparatos en la siguiente sincronización.
- `catalog.js` = nombres de producto que vienen con la app. El reporte TGU
  compartido (columna Description) manda sobre él.

## Secretos

Nunca en el repositorio. La lista está en `.env.example`; los valores, en
Vercel con tipo *Sensitive*.

## Documentos

- `REVISION.md` — hallazgos de la última revisión y su estado.
- `NOTAS-DE-AVANCE.md` — qué se hizo, qué sigue.
- `README_SETUP.md` — instalación paso a paso.
