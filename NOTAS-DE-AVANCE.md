# Notas de avance

Dónde quedó el trabajo y qué sigue, para retomarlo desde cero en otra sesión.

Rama: `claude/yard-map-barcode-conversion-b7e4k3` · PR abierto:
[#1](https://github.com/jonaclark19-ux/YardMAP/pull/1) (sin fusionar a `main`).

---

# 1 · Códigos de barras → producto escrito  ✅ terminado

El problema original: al escanear, el lector devuelve un UPC/EAN
(`704496065337`) que no le dice nada a nadie en la yarda.

Ahora ese número se convierte al número de parte y la app muestra el producto
escrito: **2 ft x 14 ft Galvanized Water Trough · WT214**.

## Cómo se resuelve un escaneo

`resolveSku(code)` en `index.html` prueba en este orden:

1. ¿El código es el número de parte tal cual? (alguien lo escribió a mano)
2. ¿Lo conoce la tabla de conversión? → tres niveles, el primero que conteste:
   - lo cargado en **ese aparato** (`localStorage`, lo más reciente)
   - lo guardado en el **mapa** (compartido con todos)
   - **`barcodes.js`**, la tabla que viaja con la app
3. Si no, quita los dígitos de empaque (cero inicial, dígito verificador) y
   reintenta.
4. Si aun así no, busca en el reporte de inventario cargado.

Las llaves van **sin los ceros de la izquierda**, así da lo mismo si el lector
devuelve el UPC-A de 12 dígitos o el EAN-13 de 13. Un código de puros ceros no
es código en ninguno de los tres caminos.

Los 17 códigos compartidos por dos variantes (`16GC10` / `16GC10T`) se guardan
como lista y gana la que sí tiene lugar en el mapa.

## De dónde salen los nombres

`productName(sku)`, también en orden:

1. El **reporte de inventario TGU** cargado en el aparato (columna `Description`)
2. Los nombres guardados en el **mapa** (`data.names`)
3. **`catalog.js`**, los 104 productos de 3 puntos que trae la app

Hoy solo **73 de los 394** productos del mapa tienen nombre sin cargar nada.
El resto se llena al cargar el reporte de inventario. Un Excel con parte +
descripción de toda la planta los dejaría dentro de la app: se generaría con
`tools/build-barcode-map.py`.

## Dónde se carga un Excel actualizado

Dos caminos, los dos llevan al mismo lugar:

- **Menú → 🏷 Load barcode list** (debajo de *Load inventory report*)
- **Control Center → pestaña Data → Load barcode Excel**

Acepta el archivo del ERP tal como sale (`PartNum` / `BarCode`) y también
`FG` + `UPC`. Se guarda **dentro del mapa**, así que llega al resto de los
teléfonos en la siguiente sincronización — pero eso empieza a valer el día que
el sitio esté publicado con Supabase (ver §3). Sin backend se guarda igual,
pero en el navegador de cada quien.

En el mapa se guarda **solo lo distinto** de lo que trae la app: recargar el
mismo archivo avisa "nada nuevo" en vez de duplicar 2 895 filas. Con la tabla
entera sustituida el mapa pesa 218 KB (el servidor admite 5 500 KB).

**Download barcodes.js** (misma fila) arma el archivo para meter la lista
dentro de la app, para un teléfono recién instalado que aún no sincroniza.
Da exactamente el mismo archivo que el script de Python.

## Archivos

| Archivo | Qué es |
|---|---|
| `barcodes.js` | 2 895 códigos → número de parte, desde `seed/Part_Conversion.xlsx` |
| `catalog.js` | 104 números de parte → nombre, desde `fotos3point.xlsx` |
| `tools/build-barcode-map.py` | regenera los dos; sin dependencias externas |

---

# 2 · Diseño — parte 1 de 4  ✅ hecha, faltan 3

Dirección: **acero galvanizado**. La app se viste como lo que mapea: gris
zinc, rojo Tarter como identidad, ámbar como única señal de atención — el
color que ya significa "mire aquí" en un equipo. La capa vive en
`<style id="tarter-design-system">`, cargada al final para ganar los empates.

## Tokens

```
--steel-950 #080C10   el fondo de todo
--steel-900 #0F151C   la superficie de la app
--steel-850 #141C25   paneles
--steel-800 #1B2531   elevado: campos, tarjetas, filas
--steel-700 #243040   líneas
--steel-600 #35455780 bordes que deben verse bajo el sol
--zinc-100  #F2F5F8   tinta   ·  --zinc-400 #96A4B4  ·  --zinc-600 #6C7B8C
--tarter-red #E6322B  identidad y lo que está mal
--signal     #FFBD24  atención: una coincidencia, una precaución
```
Ritmo de 4px (`--s1`…`--s6`), radios (`--r-sm/md/lg/pill`). Los nombres
viejos (`--bg`, `--ink`, `--amber`…) apuntan a estos, así que cambiar la
paleta es un solo bloque.

## Tipografía

Barlow Semi Condensed (títulos), Inter (texto), JetBrains Mono (números de
parte). **Estaban declaradas desde siempre y nunca se cargaban** — no había
`@font-face` ni enlace, así que todo caía a la fuente del sistema. Se cargan
sin bloquear el primer pintado (`media="print"` + `onload`): en una yarda con
mala señal, una hoja de fuentes bloqueante es una pantalla en blanco.

## El elemento que se repite

Nombre del producto arriba en condensada, número de parte estampado debajo en
mono con una marquita. Es lo que esta app es, así que todo se construye
alrededor: misma forma en la búsqueda, en el escaneo y en el reporte.

## Parte 2 — escaneo y reporte  ✅ hecha

El escáner era una tarjeta 4:3 dentro de una ventana: achicaba el blanco y
obligaba a acercarse a la etiqueta. En el teléfono ahora la cámara **es** la
pantalla, los controles caen en el arco del pulgar (52 px) y la mira son
cuatro esquinas con una línea de barrido — la única animación de la app, y
está porque es la única prueba de que la cámara está viva y no congelada.
Cuando el lector engancha un código, las esquinas se ponen verdes: la
respuesta se ve sin leer.

El mensaje de error decía **"cámara denegada" para cualquier falla**, incluso
cuando la cámara estaba bien y lo que no cargó fue el decodificador — mandaba
a la gente a los ajustes del teléfono para nada. Ahora cada caso dice lo que
pasó: permiso, cámara ocupada por otra app, lector sin descargar, o falla
genérica.

En el reporte, el ámbar se gastaba tres veces (tipo elegido, botón de
escanear, enviar), así que nada mandaba. Ahora es uno: **Submit**. Los cuatro
tipos usaban círculos de colores que no decían nada y encima peleaban con el
color de selección; ahora usan los mismos glifos que la navegación del
Control Center, así un símbolo significa lo mismo en toda la app.

**Ojo con esto:** varios módulos inyectan sus estilos en tiempo de ejecución,
después de la capa de diseño, así que ganan los empates de especificidad.
Cuando una regla "no agarra", hay que apuntarla con el id del contenedor
(`#opsReportModal .ops-scan-btn`), no subir a `!important`.

### Pendiente técnico que salió aquí

En iPhone no existe `BarcodeDetector`, así que el lector (ZXing) **se baja de
un CDN**. Se estaba bajando en el peor momento: parado frente al rack, con la
cámara abierta y la señal de la yarda. Ahora se precarga al abrir la app,
normalmente todavía con wifi.

Lo correcto sería **traer ZXing dentro del repositorio**, como ya está XLSX,
para que no dependa de señal nunca. No se pudo hacer desde esta sesión porque
el proxy bloquea el CDN. Es un archivo (`umd/index.min.js` de
`@zxing/library@0.21.3`), guardarlo junto a `barcodes.js` y apuntar `ZXING_CDN`
al archivo local, dejando el CDN de respaldo.

## Lo que falta

3. **Control Center** — la pantalla más cargada.
4. **Consolidar las tres generaciones de interfaz** (ver §4). Es lo que
   destraba un modo de sol de verdad.

---

# 3 · Pendientes que no son código

## No está publicado

La cuenta de Vercel (`jonaclark19-8483's projects`, plan Hobby) **no tiene
ningún proyecto**. El repositorio nunca se conectó. El intento de subirlo a
mano no se pudo completar.

Para publicarlo: importar el repositorio en Vercel, y cargar estas variables
(las explica `README_SETUP.md`, partes 2 a 4):

`SUPABASE_URL` · `SUPABASE_SECRET_KEY` · `SESSION_SECRET` (mínimo 32
caracteres) · `BOOTSTRAP_ADMIN_NAME` · `BOOTSTRAP_ADMIN_CODE`

Antes hay que crear el proyecto en Supabase y correr `supabase/schema.sql`.

## Las cuentas tienen un bloqueo

La pantalla para crear usuarios vive en **`enhancements.js`**, y el
`index.html` actual **ya no lo carga** (tampoco enlaza
`/manifest.webmanifest` ni el `apple-touch-icon`; se perdieron al traer la
versión nueva — está en el commit `7f104f3`, sin tocar).

Las contraseñas se guardan con `scrypt` y sal aleatoria, así que **no se
pueden crear usuarios a mano en Supabase**. Sin esa pantalla, se puede entrar
como administrador pero no darle cuenta a nadie más.

Se arregla devolviendo dos líneas al `<head>`. El riesgo: `enhancements.js`
trae su propio sistema de reportes (el viejo, del servidor) y pisa
`#reportBtn` y `#drReport`, así que puede pelearse con el Control Center
nuevo. Hay que probarlo en el navegador antes de darlo por bueno. **Decisión
pendiente del usuario.**

---

# 4 · Cómo está armado el archivo (lo que más cuesta descubrir)

`index.html` son ~8 800 líneas y **tres generaciones de interfaz apiladas**.
Cada módulo reemplaza pedazos del anterior en tiempo de ejecución, así que un
botón agregado en el lugar razonable puede quedar fuera de la pantalla.

| Línea | Módulo | Qué hace |
|---|---|---|
| ~14 | `<style>` | estilos base + una "piel" al final con cientos de literales |
| (final del head) | `tarter-design-system` | la capa de tokens nueva |
| ~2 400 | Scanner | cámara, `BarcodeDetector` con respaldo ZXing |
| ~2 700 | app principal | mapa, fichas, búsqueda, `resolveSku`, alertas |
| 5 254 | `inventory-local-module` | `YardInventory`: catálogo + reporte TGU en localStorage |
| 6 016 | `ops-v2-module` | reportes v2, registro de códigos, Control Center **viejo** |
| 6 996 | `tarter-control-center-v23-js` | Control Center **actual**: reconstruye `#opsCenter` entero |
| 7 692 | `tarter-field-mode-js` | alto contraste para exteriores |

**Esto ya mordió una vez:** el botón para cargar los códigos se puso en la
pestaña *Settings* del Control Center de la línea 6 016, y el módulo de la
7 000 reconstruye esa pantalla — la fila quedó fuera de la interfaz y el
usuario no la encontraba. Por eso ahora está en dos lugares.

Antes de agregar un control, **abrir la app en el navegador y confirmar que se
ve**, no solo que el código está.

## Cómo probar

No hay suite en el repositorio. Lo que se usó:

```
python3 -m http.server 8765            # servir el proyecto
```

y Playwright contra Chromium, entrando por **Continue offline** (modo local,
sin backend). Vale la pena verificar en cada cambio:

- escanear un código conocido → sale el nombre del producto
- cargar `seed/Part_Conversion.xlsx` → avisa "nada nuevo"
- **Download barcodes.js** → idéntico al `barcodes.js` del repositorio
- dos navegadores: uno carga el Excel, el otro lo recibe por el mapa
- `node --check` sobre cada bloque `<script>` del `index.html`
- `npm run check`

## Al tocar los Excel de origen

```
python3 tools/build-barcode-map.py
```
Regenera `barcodes.js` y `catalog.js`. Si cambia el criterio de qué es un
código válido, hay que cambiarlo **en los dos lados** (el script y
`importBarcodeFile` en `index.html`) o los archivos dejan de coincidir.
