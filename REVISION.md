# Revisión del proyecto — 23 sep 2026

Revisión de **lo que está publicado**: la rama `main` (commit `aa57958`, PR #54),
el proyecto `yardmap` en Vercel y la base **Tarter Yard Map** en Supabase.

> Una primera versión de esta revisión se hizo sobre la rama
> `claude/yard-map-barcode-conversion-b7e4k3`, que parte de `main` de principios
> de septiembre y no tiene los 63 commits posteriores. Quedó inválida y se
> reemplazó por esta.

**Cómo se revisó:** el código de `main` completo; las 38 pruebas del proyecto
(`node --test`, pasan todas); la configuración y los deploys de Vercel; y la base
de Supabase **solo en estructura y conteos** — no se leyeron datos de ninguna
persona ni de ningún reporte.

## Estado general

`main` está bastante mejor de lo que sugería la rama vieja. Ya resuelve:
reportes que conservan todos sus datos (`payload`), fotos subidas a Supabase,
retención automática del historial y de reportes viejos, lista de alertas que
no pierde los abiertos viejos, service worker que no guarda datos de sesión,
manifest enlazado, 38 pruebas, y funciones agrupadas para caber en el plan
Hobby.

En producción: 4 cuentas (2 editores, 2 viewers), 18 reportes, 11 fotos
(3.8 MB), RLS activo en las 13 tablas.

---

## 🔴 Arreglar pronto

| # | Problema | Estado |
|---|---|---|
| 1 | La foto de un reporte hecho por un viewer nunca se enlaza | pendiente |
| 2 | La sincronización deshace el arreglo de la lista de alertas | pendiente |
| 3 | La base no se puede volver a montar desde el repositorio | pendiente |
| 4 | Cualquiera se puede registrar y ver todo lo que ve un viewer | decisión |

**1. Foto de un viewer.** `uploadAlertPhoto` sube la foto (permitido a cualquier
usuario) y después la enlaza con `PATCH /api/alerts`, que **solo permiten los
editores** (`requireEditor`). Para un viewer —quien trabaja en la yarda— la foto
queda subida pero el reporte nunca la muestra, y la retención nunca la borra
porque no pertenece a ningún reporte. Todavía no pasó en producción (hay un solo
reporte de viewer y sin foto), pero pasará la primera vez.

**2. Sync.** `alerts.js` se arregló para traer *todos los abiertos + los
resueltos recientes*, porque "las N más nuevas" hacía desaparecer el atraso
abierto. Pero `/api/sync` (`state.js`, línea 108) sigue con
`order=created_at.desc&limit=1500`, y el cliente **reemplaza toda su lista** con
lo que llega por sync. Pasando 1500 reportes, los abiertos más viejos
desaparecen en cada sincronización. Hay que usar la misma consulta en los dos.

**3. Reproducibilidad.** `requireUser` —que corre en **cada** petición con
sesión— lee `yard_users.onboarded_at`. Esa columna existe en producción pero
**no se crea en ningún archivo SQL** del repositorio: se agregó a mano. Si hay
que montar la base de nuevo (otro proyecto, recuperación, una copia de prueba)
siguiendo el repositorio, **ningún login funciona**. Además, `schema.sql` no
incluye `payload` ni `email_groups`; están en migraciones aparte que hay que
acordarse de correr. Conviene un `schema.sql` que deje la base completa.

**4. Registro abierto.** `/api/signup` y la pantalla de login dejan que
**cualquiera con la URL** se cree una cuenta de viewer, sin invitación ni
aprobación. Un viewer ve el mapa, el inventario con cantidades, los reportes,
los traspasos de turno y **las listas de correo de la empresa**. Cada registro
además manda un correo a `ALERT_SUMMARY_RECIPIENTS`, sin límite: se puede usar
para llenar esa bandeja. Si el registro abierto es a propósito, al menos: un
código de invitación (una variable de entorno) o cuentas nuevas desactivadas
hasta que un editor las apruebe.

## 🟠 Seguridad

| # | Problema | Estado |
|---|---|---|
| 5 | Login y registro sin límite de intentos; códigos de 4 caracteres | pendiente |
| 6 | El correo de un reporte descarga cualquier URL (SSRF) | pendiente |
| 7 | No hay pantalla de usuarios | pendiente |
| 8 | Un editor puede dejar la app sin editores | pendiente |
| 9 | Sin CSP, `frame-ancestors` ni `Permissions-Policy` | pendiente |
| 10 | Secretos de Vercel legibles desde el panel | pendiente (en Vercel) |
| 11 | 8 funciones SQL con `search_path` mutable; ejecutables con la llave anónima | pendiente |

**5.** Fuerza bruta sobre códigos de 4 caracteres, y cada intento calcula
`scrypt` (CPU en Vercel). Vercel ofrece `checkRateLimit` en `@vercel/firewall`
para esto. Subir el mínimo a 6–8.

**6.** Al mandar un reporte por correo, el servidor hace `fetch(photoUrl)` para
adjuntar la foto. `photoUrl` lo puede poner cualquier usuario al crear el
reporte. Hay que aceptar solo URLs del bucket propio, al crear y al descargar.
La misma validación evita que alguien ponga una imagen externa que registre la
IP de quien abre el reporte.

**7.** La gestión de usuarios existe en el servidor (`/api/users`) pero su
pantalla vive en `enhancements.js`, que el `index.html` no carga. Hoy no se
puede crear un editor, cambiar un código ni desactivar a alguien sin entrar a
Supabase.

**8.** `handleUsers` deja quitarse el rol o desactivar al último editor activo.

**10.** Vercel marca `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `CRON_SECRET` e
`INVENTORY_IMPORT_SECRET` como *readable-secret*: conviene cambiarlas a tipo
**Sensitive**.

**11.** Aviso del propio Supabase (`function_search_path_mutable`), se corrige
con `set search_path = public, pg_temp` en cada una. Hoy no son explotables
(son `invoker` y RLS bloquea), pero conviene `revoke execute … from anon`.

## 🟡 Operación

| # | Problema | Estado |
|---|---|---|
| 12 | La retención borra resueltos por fecha de **creación** | pendiente |
| 13 | Si el servidor falla, la app se pasa sola a modo local | pendiente |
| 14 | Límite de 4.5 MB por petición en Vercel | vigilar |
| 15 | `.env.example` citado pero inexistente; `.gitignore` no cubre `.env` | pendiente |

**12.** Un reporte abierto hace 40 días y resuelto ayer se borra esta noche.
Debería contar desde `resolved_at`.

**13.** `probe()` trata cualquier error que no sea 401/503 como "no hay backend"
y ofrece *Continue offline* con permisos de editor. Si Supabase falla, la gente
sigue "reportando" en su teléfono sin que nada llegue. Debería decir "servidor
no disponible".

**14.** Vercel corta los cuerpos de más de 4.5 MB antes de llegar a la función.
Los límites internos de `inventory.js` (20–25 MB) no se alcanzan nunca: un
reporte TGU de más de ~3.3 MB (en base64) fallaría al importarse.

## 🔵 Frontend

| # | Problema | Estado |
|---|---|---|
| 16 | 1.66 MB (519 KB comprimida); SheetJS embebido | pendiente |
| 17 | Lector de iPhone desde CDN | pendiente |

## Sobre la rama `claude/yard-map-barcode-conversion-b7e4k3`

No se puede publicar ni fusionar tal cual: tiene 18 archivos en `api/` y el plan
Hobby admite 12 funciones (su último preview falló por eso), y le faltan los 63
commits de `main`. Lo que aporta —conversión de códigos de barras con nombres,
el sistema visual y el escáner rediseñado— hay que **rehacerlo encima de
`main`**, que ya tiene su propio `barcodes.json`. El trabajo del commit
"[En pausa]" sobra: `main` ya resolvió eso con `payload`.
