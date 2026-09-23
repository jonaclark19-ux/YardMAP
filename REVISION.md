# Revisión del proyecto — 23 sep 2026

Revisión completa del código: las 18 funciones de `api/`, `supabase/schema.sql`,
`vercel.json`, el service worker y el `index.html`.

Supabase y Vercel **todavía no existen** (no hay proyecto en ninguno), así que lo
que tiene que ver con ellos se revisó en el código, no en vivo. El hallazgo #1 se
confirmó con una prueba: un backend simulado que usa las funciones reales del
servidor (`api/_lib/models.js`) y un reporte hecho desde la app como se haría en
la yarda.

La columna **Estado** se actualiza a medida que se resuelve cada punto.

---

## 🔴 Lo que impide usarla en línea

| # | Problema | Estado |
|---|---|---|
| 1 | Los reportes nuevos se pierden al llegar al servidor | ⏳ en curso |
| 2 | Las fotos de los reportes se quedan en el teléfono | pendiente |
| 3 | No hay cómo crear cuentas | pendiente |
| 4 | Si el servidor falla, la app se pasa sola a modo local sin avisar | pendiente |

**1. Los reportes nuevos se pierden al llegar al servidor.** Probado:

| | Lo que manda el teléfono | Lo que guardaba el servidor |
|---|---|---|
| Cantidad física | 7 | — |
| Resultado / diferencia | `reported` | — |
| Versión v2 (`opsVersion`) | 2 | — |
| Tipo, SKU, nota | ✓ | ✓ |

`mapAlertInput` solo aceptaba los campos del sistema de reportes viejo y tiraba el
resto. Encima, el Control Center muestra solo los reportes con `opsVersion`: el
reporte **desaparecía del Control Center** apenas volvía del servidor. En modo
local no se nota; publicado, el flujo de reportes deja de funcionar.

**2. Las fotos se quedan en el teléfono** (IndexedDB). `/api/upload` existe para
subirlas a Supabase, pero el flujo nuevo no lo usa: el supervisor nunca ve la
evidencia.

**3. No hay cómo crear cuentas.** La pantalla de usuarios vive en
`enhancements.js`, que el `index.html` actual ya no carga. Las contraseñas se
guardan con `scrypt` y sal aleatoria, así que no se pueden crear a mano en
Supabase.

**4. Si el servidor falla, la app se pasa sola a modo local.** `probe()` trata
cualquier respuesta que no sea 401 o 503 como "no hay backend" y ofrece
*Continue offline* con permisos de editor. El plan gratis de Supabase se pausa
tras 7 días sin uso: ese día la gente seguiría "reportando" sin que nada llegue
al servidor. Debería decir "servidor no disponible".

## 🟠 Seguridad

| # | Problema | Estado |
|---|---|---|
| 5 | Login sin límite de intentos, códigos de 4 caracteres | pendiente |
| 6 | Un editor puede dejar la app sin editores | pendiente |
| 7 | Sin CSP, `frame-ancestors` ni `Permissions-Policy` | pendiente |
| 8 | Funciones SQL ejecutables con la llave anónima | pendiente |
| 9 | `logout` da 500 sin `SESSION_SECRET`; errores de la base llegan al navegador | pendiente |

**5.** Se puede sacar un código por fuerza bruta, y cada intento calcula `scrypt`
(CPU en Vercel). Mínimo 6–8 caracteres y limitar intentos: una tabla en Supabase
o una regla del Firewall de Vercel sobre `/api/login`.

**6.** Un editor puede quitarse el rol o desactivar al último editor activo.

**7.** La app se puede meter en un iframe (clickjacking). Van en `vercel.json`.

**8.** Hoy no pasa nada: las funciones son `SECURITY INVOKER` y RLS bloquea sin
políticas. Como defensa extra: `revoke execute … from anon, authenticated`.

## 🟡 Datos y Supabase

| # | Problema | Estado |
|---|---|---|
| 10 | `map_history` guarda el mapa completo en cada guardado, sin límite | pendiente |
| 11 | Las alertas solo cargan las últimas 400 | pendiente |
| 12 | El bucket de fotos es público | aceptable |

**10.** Empeoró con los nombres de producto dentro del mapa: cada guardado pesa
~200 KB en vez de ~36 KB. Con el límite de 500 MB del plan gratis se llena en
semanas si se edita seguido. Necesita retención (por ejemplo, los últimos 200
guardados) y los nombres deberían pasar a su propia tabla.

**11.** Las más viejas desaparecen de la pantalla sin aviso.

**12.** Las URLs llevan un UUID y no se pueden adivinar.

## 🟡 Vercel y el repositorio

| # | Problema | Estado |
|---|---|---|
| 13 | Formato de las funciones (`export default { fetch }`) | ✅ correcto, confirmado en la documentación de Vercel |
| 14 | `.env.example` citado pero inexistente; no hay `.gitignore` | pendiente |
| 15 | No hay pruebas; `npm run check` revisa 4 archivos | pendiente |

## 🔵 Frontend

| # | Problema | Estado |
|---|---|---|
| 16 | 1.48 MB (472 KB comprimida); 624 KB son SheetJS embebido | pendiente |
| 17 | Tres generaciones de interfaz apiladas | pendiente (diseño, parte 4) |
| 18 | Service worker sin registrar, manifest sin enlazar; el SW cachearía `/api` | pendiente |
| 19 | Lector de iPhone desde CDN; flujo de reportes solo en inglés | pendiente |

**16.** SheetJS solo se usa al importar un Excel. Cargándolo cuando haga falta, la
primera carga en el teléfono baja a la mitad.

**18.** Tal como está escrito, el SW guardaría respuestas de `/api` con datos de
sesión en la caché: corregirlo antes de activarlo.

## ✅ Lo que está bien hecho

- **Autenticación:** cookie firmada `HttpOnly`/`Secure`/`SameSite`, códigos con
  `scrypt`, y el rol se relee de la base en cada petición — desactivar a alguien
  tiene efecto inmediato.
- **Base de datos:** RLS en todas las tablas; la llave secreta nunca llega al
  navegador.
- **Mapa:** control de versiones para que dos personas no se pisen al guardar,
  con historial y restauración.
- **Operación:** bitácora de auditoría y cola de alertas para cuando no hay señal.
- **Frontend:** el texto que viene de los Excel se escapa bien; no se encontraron
  huecos de XSS.

## Orden acordado

1. Reportes y fotos al servidor (#1, #2) — sin esto, publicar no sirve.
2. Pantalla de usuarios (#3) y candados de login y editores (#5, #6).
3. Aviso cuando el servidor falla (#4) y retención del historial (#10).
4. `.env.example`, `.gitignore`, headers (#7, #14).
5. Publicar. Después, las partes 3 y 4 del diseño.
