# Tarter Yard Map — Guía de instalación Online V1

> **Objetivo de esta guía:** dejar Tarter Yard Map funcionando online con:
>
> - un link de Vercel,
> - usuarios **Administrador/Editor** y **Viewer**,
> - un mapa compartido entre PC y teléfonos,
> - alertas compartidas,
> - fotos en reportes,
> - historial, auditoría y demás funciones de la V1.
>
> Esta guía está pensada para hacer el proceso **sin asumir conocimientos de programación**. Haz los pasos en orden y no avances cuando una verificación diga que algo no está correcto.

---

# ANTES DE EMPEZAR

Necesitas cuentas gratuitas en:

1. **GitHub** — para guardar el proyecto.
2. **Supabase** — para la base de datos, usuarios internos, alertas y fotos.
3. **Vercel** — para publicar la aplicación.

También necesitas el archivo ZIP de este proyecto:

`Tarter Yard Map Online V1`

## MUY IMPORTANTE

No subas claves, contraseñas o secretos a GitHub.

Nunca debes pegar en GitHub ni dentro de `index.html` valores como:

- `SUPABASE_SECRET_KEY`
- `SESSION_SECRET`
- `BOOTSTRAP_ADMIN_CODE`

Estas claves se agregan directamente dentro de **Vercel → Environment Variables**.

---

# PARTE 1 — PREPARAR LA CARPETA DEL PROYECTO

## Paso 1.1 — Extraer el ZIP

1. Descarga el ZIP del proyecto.
2. En Windows, haz clic derecho sobre el ZIP.
3. Selecciona **Extract All / Extraer todo**.
4. Abre la carpeta extraída.

Dentro debes ver, entre otros, estos archivos/carpetas:

```text
index.html
enhancements.js
enhancements.css
manifest.webmanifest
sw.js
package.json
vercel.json
api/
supabase/
icons/
seed/
README_SETUP.md
```

### VERIFICACIÓN 1

La carpeta `api` y el archivo `index.html` deben estar **al mismo nivel**.

Correcto:

```text
mi-carpeta/
├── index.html
├── api/
├── supabase/
└── icons/
```

Incorrecto:

```text
mi-carpeta/
└── otra-carpeta/
    ├── index.html
    └── api/
```

Si tienes una carpeta dentro de otra, cuando subamos a GitHub debes subir **el contenido de la carpeta que contiene directamente `index.html`**.

---

# PARTE 2 — CREAR SUPABASE

Supabase será la base de datos central. Todos los dispositivos conectados al mapa leerán y escribirán aquí mediante las funciones seguras de Vercel.

## Paso 2.1 — Crear el proyecto

1. Entra a **Supabase Dashboard**.
2. Inicia sesión.
3. Haz clic en **New project**.
4. Si te pide una organización, selecciona la tuya o crea una.
5. En **Project name**, puedes escribir:

```text
Tarter Yard Map
```

6. Supabase solicitará una contraseña para la base de datos.
   - Usa una contraseña fuerte.
   - Guárdala en un lugar seguro.
   - Esta contraseña **NO** es el código con el que entrarás al mapa.
7. Selecciona una región cercana a Utah si Supabase te permite elegir región.
8. Crea el proyecto.
9. Espera hasta que Supabase indique que el proyecto está listo.

### VERIFICACIÓN 2

Debes poder entrar al dashboard del proyecto sin ver un mensaje de creación pendiente.

---

# PARTE 3 — CREAR LA BASE DE DATOS DEL MAPA

## Paso 3.1 — Abrir el SQL Editor

Dentro del proyecto de Supabase:

1. Busca en el menú lateral **SQL Editor**.
2. Entra a **SQL Editor**.
3. Selecciona **New query** o crea una consulta nueva.

## Paso 3.2 — Abrir nuestro archivo SQL

En la carpeta del proyecto en Windows entra a:

```text
supabase
```

Abre:

```text
schema.sql
```

Puedes abrirlo con Notepad/Bloc de notas, VS Code o cualquier editor de texto.

## Paso 3.3 — Copiar TODO el SQL

1. Dentro de `schema.sql`, presiona:

```text
Ctrl + A
```

2. Luego:

```text
Ctrl + C
```

3. Regresa a Supabase → SQL Editor.
4. Haz clic dentro del editor.
5. Presiona:

```text
Ctrl + V
```

Debes pegar **todo el archivo**, desde la primera hasta la última línea.

## Paso 3.4 — Ejecutar el SQL

Haz clic en **Run**.

El script creará automáticamente:

- `yard_users`
- `map_state`
- `map_history`
- `alerts`
- `app_meta`
- `audit_log`
- `announcements`
- `sku_verifications`
- `edit_lock`
- `zone_status`
- `shift_handoffs`
- funciones SQL para sincronización/historial
- bucket de fotos `yard-alerts`

También activa Row Level Security en las tablas.

### VERIFICACIÓN 3 — TABLAS

Cuando termine:

1. Ve a **Table Editor**.
2. Confirma que puedes ver una tabla llamada:

```text
yard_users
```

3. Confirma que también existe:

```text
map_state
```

4. En `map_state` debería existir una fila con:

```text
id = yard
rev = 0
```

No importa que `data` esté vacío todavía.

### VERIFICACIÓN 4 — STORAGE

1. Ve a **Storage**.
2. Debe existir un bucket llamado:

```text
yard-alerts
```

Si existen las tablas y el bucket, Supabase está preparado.

### Si ejecutaste `schema.sql` dos veces

No debería ser un problema. El archivo está diseñado para poder volver a ejecutarse sin recrear las tablas existentes.

---

# PARTE 4 — OBTENER LOS DATOS DE SUPABASE QUE NECESITA VERCEL

Necesitamos solamente dos datos de Supabase:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

## Paso 4.1 — Obtener SUPABASE_URL

En Supabase:

1. Abre tu proyecto.
2. Busca el botón **Connect** o entra a **Settings → API Keys / API** según la interfaz que aparezca.
3. Busca la URL del proyecto.

Se verá aproximadamente así:

```text
https://abcdefghijk.supabase.co
```

Copia esa URL temporalmente a un Bloc de notas.

La guardaremos en Vercel con el nombre:

```text
SUPABASE_URL
```

## Paso 4.2 — Obtener SUPABASE_SECRET_KEY

En Supabase:

1. Ve a:

```text
Settings
→ API Keys
```

2. Busca la sección **Secret keys**.
3. Si aún no existe una secret key, crea una desde esa sección.
4. Copia la clave que comience aproximadamente así:

```text
sb_secret_...
```

La guardaremos en Vercel con el nombre:

```text
SUPABASE_SECRET_KEY
```

## ADVERTENCIA CRÍTICA

La `sb_secret_...` es una clave privada de servidor.

NO la pongas en:

- GitHub
- `index.html`
- `enhancements.js`
- screenshots públicos
- mensajes enviados a trabajadores

Solo se guardará en **Vercel Environment Variables**.

### VERIFICACIÓN 5

Antes de continuar debes tener guardados temporalmente:

```text
SUPABASE_URL=https://........supabase.co
SUPABASE_SECRET_KEY=sb_secret_........
```

No necesitas una `publishable key` para esta V1.

---

# PARTE 5 — CREAR EL REPOSITORIO DE GITHUB

## Paso 5.1 — Crear repositorio

1. Entra a GitHub.
2. En la esquina superior derecha presiona el botón `+`.
3. Selecciona **New repository**.
4. En nombre puedes usar:

```text
tarter-yard-map
```

5. Recomiendo seleccionar **Private** mientras estamos probando la aplicación.
6. Como ya tenemos todos los archivos del proyecto, para evitar conflictos iniciales puedes crear el repositorio vacío, sin agregar manualmente archivos de ejemplo adicionales.
7. Haz clic en **Create repository**.

## Paso 5.2 — Subir los archivos

Dentro del repositorio vacío:

1. Busca **Add file**.
2. Selecciona **Upload files**.
3. En Windows abre la carpeta extraída de `tarter-yard-map-online-v1`.
4. Selecciona el contenido del proyecto.
5. Arrástralo al área de carga de GitHub.

Debes subir **los archivos y carpetas**, no el ZIP.

NO hagas esto:

```text
tarter-yard-map-online-v1.zip
```

GitHub/Vercel necesitan los archivos extraídos.

## Paso 5.3 — Commit

Cuando GitHub termine de cargar:

1. Baja al final de la página.
2. En el mensaje de commit puedes poner:

```text
Initial Tarter Yard Map online V1
```

3. Presiona **Commit changes**.

### VERIFICACIÓN 6 — ESTRUCTURA EN GITHUB

Al volver a la página principal del repositorio debes ver directamente:

```text
index.html
api
supabase
icons
package.json
vercel.json
```

El archivo `index.html` debe verse en la **primera pantalla del repositorio**.

Si para encontrar `index.html` tienes que abrir primero una carpeta llamada `tarter-yard-map-online-v1`, entonces quedó un nivel demasiado profundo.

---

# PARTE 6 — CONECTAR GITHUB CON VERCEL

## Paso 6.1 — Crear el proyecto en Vercel

1. Entra a Vercel.
2. Inicia sesión.
3. Selecciona **Add New → Project** o **New Project**.
4. Si todavía no conectaste GitHub, Vercel te pedirá permiso para conectarlo.
5. Autoriza GitHub.
6. Busca el repositorio:

```text
tarter-yard-map
```

7. Presiona **Import**.

## Paso 6.2 — Configuración del proyecto

Antes de presionar Deploy revisa:

### Framework Preset

Selecciona:

```text
Other
```

### Root Directory

Debe apuntar a la raíz donde está `index.html`.

Normalmente:

```text
./
```

Si GitHub quedó con la estructura correcta, no tienes que seleccionar una subcarpeta.

### Build Command

Déjalo sin un comando personalizado.

### Output Directory

Déjalo sin un directorio personalizado.

### Install Command

No necesitas agregar uno manualmente para este proyecto.

No escribas:

```text
npm run build
```

porque esta aplicación no necesita un proceso de compilación frontend.

---

# PARTE 7 — CREAR LAS VARIABLES DE ENTORNO EN VERCEL

Esta es la parte más importante.

Puedes agregarlas antes del primer deploy desde la pantalla de importación o después desde:

```text
Vercel
→ Project
→ Settings
→ Environment Variables
```

Necesitamos **5 variables obligatorias**.

---

## VARIABLE 1 — SUPABASE_URL

Name:

```text
SUPABASE_URL
```

Value:

```text
https://TU-PROYECTO.supabase.co
```

Usa exactamente la URL que copiaste de Supabase.

---

## VARIABLE 2 — SUPABASE_SECRET_KEY

Name:

```text
SUPABASE_SECRET_KEY
```

Value:

```text
sb_secret_XXXXXXXXXXXXXXXX
```

Usa exactamente la Secret key de Supabase.

---

## VARIABLE 3 — SESSION_SECRET

Esta variable NO viene de Supabase.

Nosotros debemos crearla.

Debe ser una cadena aleatoria de al menos 32 caracteres.

### Forma segura de generarla en Windows PowerShell

1. En Windows abre **PowerShell**.
2. Copia y pega exactamente esto:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $bytes = New-Object byte[] 48; $rng.GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

3. Presiona Enter.
4. PowerShell mostrará una cadena larga parecida a:

```text
R4Nd0mExampleOnlyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

5. Copia el resultado completo.

En Vercel:

Name:

```text
SESSION_SECRET
```

Value:

```text
PEGA_AQUI_EL_RESULTADO_DE_POWERSHELL
```

No uses el ejemplo de esta guía.

---

## VARIABLE 4 — BOOTSTRAP_ADMIN_NAME

Este será el nombre del **primer Administrador**.

Name:

```text
BOOTSTRAP_ADMIN_NAME
```

Value de ejemplo:

```text
Jonathan
```

Puedes utilizar tu nombre.

Recuerda exactamente cómo lo escribiste para el primer login.

---

## VARIABLE 5 — BOOTSTRAP_ADMIN_CODE

Este será el código temporal para crear el primer administrador.

Name:

```text
BOOTSTRAP_ADMIN_CODE
```

Value:

Elige un código que tenga como mínimo 4 caracteres. Para una prueba real recomiendo 8 o más caracteres y no usar algo obvio como `1234`.

Ejemplo de formato:

```text
TyM-48291
```

NO uses necesariamente ese ejemplo.

Guárdalo porque lo necesitaremos una sola vez para crear el primer Admin.

---

# PARTE 8 — REVISAR LAS 5 VARIABLES ANTES DE DESPLEGAR

En Vercel deberían existir exactamente estas variables obligatorias:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
SESSION_SECRET
BOOTSTRAP_ADMIN_NAME
BOOTSTRAP_ADMIN_CODE
```

## IMPORTANTE SOBRE LOS ENVIRONMENTS DE VERCEL

Si Vercel pregunta en qué environments usar cada variable, para la primera prueba habilítalas al menos para:

```text
Production
```

Si también quieres probar Preview deployments, puedes habilitarlas para Preview.

Para evitar confusión durante el primer lanzamiento, lo importante es que estén disponibles en el deployment que vas a abrir.

### `YARD_ID`

No necesitas crear `YARD_ID` para esta V1. Está reservado para una futura versión multi-yard y el backend actual no depende de esa variable.

---

# PARTE 9 — HACER EL PRIMER DEPLOY

Una vez configurado todo:

1. Presiona **Deploy** en Vercel.
2. Espera hasta que el deployment indique:

```text
Ready
```

3. Vercel te dará una URL similar a:

```text
https://tarter-yard-map-xxxxx.vercel.app
```

Ábrela.

---

# PARTE 10 — QUÉ DEBE OCURRIR AL ABRIR LA APP

En la primera visita debe aparecer la pantalla de login.

No debería aparecer un mensaje indicando que estás trabajando únicamente en modo local.

### VERIFICACIÓN 7 — BACKEND

En otra pestaña del navegador abre:

```text
https://TU-APP.vercel.app/api/me
```

Antes de iniciar sesión es normal recibir una respuesta de tipo:

```json
{"error":"unauthorized"}
```

con estado HTTP 401.

**Eso es bueno.**

Significa que `/api/me` existe y que Vercel está ejecutando el backend.

### Si `/api/me` muestra 404

Entonces Vercel no está detectando correctamente la carpeta `/api` o el Root Directory del proyecto está mal configurado.

Revisa que GitHub tenga:

```text
/api/me.js
```

en la raíz del proyecto.

### Si `/api/me` muestra `supabase_not_configured`

Revisa:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Después de modificar Environment Variables en Vercel, haz un **Redeploy** para asegurar que el deployment nuevo reciba las variables.

---

# PARTE 11 — CREAR EL PRIMER ADMINISTRADOR

Todavía la tabla `yard_users` debe estar vacía.

En la pantalla de login utiliza exactamente:

```text
Name: valor de BOOTSTRAP_ADMIN_NAME
Code: valor de BOOTSTRAP_ADMIN_CODE
```

Ejemplo solamente:

```text
Name: Jonathan
Code: TyM-48291
```

Al hacer login por primera vez, el backend detecta que `yard_users` está vacío y crea automáticamente el primer usuario con rol:

```text
editor
```

`editor` es nuestro **Administrador**.

El access code no se guarda directamente; el backend guarda su hash.

### VERIFICACIÓN 8 — PRIMER USUARIO

En Supabase:

1. Ve a **Table Editor**.
2. Abre:

```text
yard_users
```

3. Debe existir ahora una fila para tu usuario.
4. En `role` debe decir:

```text
editor
```

5. En `access_code_hash` debe haber un valor largo que comienza con algo similar a:

```text
scrypt$
```

NO debería aparecer tu access code original en esa columna.

---

# PARTE 12 — QUÉ PASA CON EL MAPA EN EL PRIMER LOGIN

La tabla `map_state` comenzó con:

```text
rev = 0
data = null
```

Cuando entra por primera vez un Admin, el frontend carga el mapa actual que viene incluido dentro de la aplicación y lo envía al servidor.

### VERIFICACIÓN 9 — MAPA ONLINE

Después del primer login:

1. Ve a Supabase → Table Editor.
2. Abre:

```text
map_state
```

3. La fila `yard` debería pasar de:

```text
rev = 0
```

a un número mayor, normalmente:

```text
rev = 1
```

4. La columna `data` ya no debería estar vacía.

Esto confirma que el mapa está guardado online.

---

# PARTE 13 — CREAR UN VIEWER DE PRUEBA

Desde la app como Admin:

1. Abre el menú.
2. Entra a **Operations Center**.
3. Busca la administración de usuarios.
4. Crea un usuario de prueba.

Ejemplo:

```text
Name: Test Viewer
Role: Viewer
Access Code: 5842Test
```

El código debe tener mínimo 4 caracteres.

### VERIFICACIÓN 10

En Supabase → `yard_users` ahora deberían existir por lo menos:

```text
Jonathan      editor
Test Viewer   viewer
```

---

# PARTE 14 — PRUEBA REAL CON DOS DISPOSITIVOS

Esta prueba es obligatoria antes de dar por terminado el sistema online.

## Dispositivo A — Admin

En tu PC:

1. Abre la app.
2. Inicia sesión como Admin.
3. Deja abierta la aplicación.

## Dispositivo B — Viewer

En un teléfono:

1. Abre la misma URL de Vercel.
2. Inicia sesión como `Test Viewer`.
3. Busca un SKU.
4. Crea un reporte de prueba.

Ejemplo:

```text
Type: RUNNING LOW
SKU: WTR82
Note: TEST ALERT
```

## Resultado esperado

En el Admin debe aparecer esa misma alerta durante la siguiente sincronización.

El sistema actual consulta cambios aproximadamente cada 15 segundos mientras está activo y con menor frecuencia cuando permanece inactivo.

### VERIFICACIÓN 11 — ALERTA EN SUPABASE

En Supabase → Table Editor → `alerts`, debe existir una fila nueva correspondiente al reporte.

Luego desde Admin:

1. Abre la alerta.
2. Cámbiala a `Acknowledged` o `In Progress`.
3. Finalmente márcala `Resolved`.

Confirma que el Viewer también recibe el estado actualizado.

---

# PARTE 15 — PROBAR UNA FOTO EN UNA ALERTA

Desde el teléfono Viewer:

1. Crea un reporte.
2. Adjunta una foto.
3. Envía el reporte.

Después:

1. En Supabase abre **Storage**.
2. Entra a:

```text
yard-alerts
```

3. Debe existir un archivo dentro de una ruta organizada por fecha.

En la tabla `alerts`, el campo `photo_url` debe contener la URL de la fotografía.

---

# PARTE 16 — PROBAR LOS PERMISOS

## Viewer

Un Viewer debe poder:

- abrir el mapa,
- buscar SKU,
- escanear,
- ver imágenes,
- ver alertas,
- crear reportes,
- subir foto en reportes,
- verificar una ubicación,
- ver announcements,
- ver estados de zona,
- ver el último Shift Handoff.

Un Viewer NO debe poder:

- mover productos,
- eliminar SKU,
- agregar SKU,
- modificar geometría del mapa,
- restaurar historial,
- administrar usuarios,
- resolver alertas administrativas.

## Admin / Editor

Debe poder hacer todas las funciones anteriores y además administrar el mapa y las operaciones.

---

# PARTE 17 — ELIMINAR EL CÓDIGO BOOTSTRAP DESPUÉS DEL PRIMER ADMIN

Cuando hayas confirmado que tu Admin funciona correctamente:

1. Ve a Vercel.
2. Abre el proyecto.
3. Ve a:

```text
Settings
→ Environment Variables
```

4. Puedes eliminar:

```text
BOOTSTRAP_ADMIN_CODE
```

Esto ya no elimina tu Admin.

El usuario ya existe dentro de `yard_users` con su hash de access code.

También puedes dejar `BOOTSTRAP_ADMIN_NAME`, pero sin `BOOTSTRAP_ADMIN_CODE` el proceso automático de bootstrap ya no puede crear al primer Admin.

Después de eliminar/modificar variables, haz un nuevo deployment/redeploy para que el cambio se aplique.

---

# PARTE 18 — INSTALARLO COMO APP EN EL TELÉFONO

La aplicación incluye PWA:

```text
manifest.webmanifest
sw.js
icons/
```

## iPhone

En Safari:

1. Abre la URL de Vercel.
2. Presiona **Share / Compartir**.
3. Selecciona **Add to Home Screen / Agregar a pantalla de inicio**.

## Android / Chrome

En Chrome:

1. Abre la app.
2. Abre el menú del navegador.
3. Busca **Install app** o **Add to Home screen**, dependiendo de la versión del navegador.

Luego podrás abrir Tarter Yard Map desde el icono de la pantalla principal.

---

# PARTE 19 — DEEP LINK DIRECTO A UN SKU

Puedes abrir el mapa directamente apuntando a un SKU.

Ejemplo:

```text
https://TU-APP.vercel.app/?sku=WTR82
```

Después del login, la app intentará llevar al usuario directamente a ese producto.

---

# PARTE 20 — ERRORES COMUNES Y CÓMO IDENTIFICARLOS

## ERROR A — Vercel muestra 404 al abrir la app

Revisar:

- `index.html` debe estar en la raíz del repositorio.
- Root Directory de Vercel debe apuntar a esa misma raíz.

---

## ERROR B — La app entra en Local Mode

Posibles causas:

1. `/api/me` no existe.
2. Vercel no detectó la carpeta `api`.
3. Root Directory incorrecto.
4. Deployment antiguo.

Prueba directamente:

```text
https://TU-APP.vercel.app/api/me
```

Un `401 unauthorized` antes de login es normal.

---

## ERROR C — `supabase_not_configured`

Falta una de estas variables o tiene un nombre incorrecto:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Los nombres deben coincidir exactamente, incluyendo mayúsculas y `_`.

---

## ERROR D — `session_secret_not_configured`

La variable:

```text
SESSION_SECRET
```

no existe o tiene menos de 32 caracteres.

Genera otra con PowerShell usando el comando de esta guía.

---

## ERROR E — Login dice invalid credentials en el primer intento

Revisa:

1. `yard_users` debe estar vacío si estás usando el bootstrap por primera vez.
2. El nombre debe coincidir con `BOOTSTRAP_ADMIN_NAME`.
3. El código debe coincidir exactamente con `BOOTSTRAP_ADMIN_CODE`.
4. El access code debe tener al menos 4 caracteres.
5. Si cambiaste las variables después del deploy, realiza **Redeploy**.

---

## ERROR F — El Admin entra, pero el mapa no se guarda

Revisa en Supabase:

```text
map_state
```

Si `rev` continúa en `0`, revisa los logs de Vercel de la función `/api/state`.

También confirma que ejecutaste `schema.sql` completo.

---

## ERROR G — Dos usuarios ven mapas diferentes

Primero revisa que ambos hayan iniciado sesión en la **misma URL de Vercel**.

Luego confirma que el drawer/menu indique modo online y no local.

Finalmente revisa Supabase → `map_state` y confirma que tiene información en `data`.

---

## ERROR H — La foto no sube

Revisa:

1. Supabase → Storage debe contener `yard-alerts`.
2. La imagen debe ser JPEG, PNG o WebP.
3. El backend limita el archivo a aproximadamente 4.5 MB después del procesamiento del navegador.
4. Revisa Vercel logs para `/api/upload`.

---

## ERROR I — Cambié una Environment Variable pero nada cambió

Las variables de Vercel se aplican a deployments.

Después de un cambio importante de Environment Variables:

1. Ve a **Deployments**.
2. Abre el último deployment.
3. Usa **Redeploy**.

Luego prueba nuevamente.

---

# PARTE 21 — CHECKLIST FINAL DE LANZAMIENTO DE PRUEBA

No pases a uso real hasta poder marcar TODO esto:

```text
[ ] Supabase creado
[ ] schema.sql ejecutado sin errores
[ ] yard_users existe
[ ] map_state existe
[ ] yard-alerts existe en Storage
[ ] GitHub contiene index.html en la raíz
[ ] GitHub contiene api/ en la raíz
[ ] Vercel conectado al repositorio correcto
[ ] Framework Preset = Other
[ ] SUPABASE_URL configurada
[ ] SUPABASE_SECRET_KEY configurada
[ ] SESSION_SECRET configurada
[ ] BOOTSTRAP_ADMIN_NAME configurado
[ ] BOOTSTRAP_ADMIN_CODE configurado
[ ] Deployment = Ready
[ ] /api/me responde 401 antes del login, no 404
[ ] Primer Admin puede iniciar sesión
[ ] Admin aparece en Supabase yard_users
[ ] map_state tiene rev > 0
[ ] Viewer de prueba creado
[ ] Viewer puede iniciar sesión desde teléfono
[ ] Viewer NO puede editar mapa
[ ] Viewer puede crear una alerta
[ ] Admin recibe la alerta
[ ] Admin puede resolver la alerta
[ ] Foto de prueba llega a yard-alerts
[ ] PC y teléfono muestran el mismo mapa
[ ] App puede instalarse en pantalla de inicio
```

---

# ORDEN RECOMENDADO PARA NUESTRA PRIMERA PRUEBA

Para reducir posibilidades de error, hazlo exactamente en este orden:

```text
1. Crear Supabase
2. Ejecutar schema.sql
3. Verificar tablas + bucket yard-alerts
4. Copiar SUPABASE_URL
5. Copiar SUPABASE_SECRET_KEY
6. Crear GitHub repo
7. Subir los archivos extraídos
8. Confirmar index.html + api/ en la raíz
9. Importar repo en Vercel
10. Crear las 5 Environment Variables
11. Deploy
12. Probar /api/me
13. Primer login Admin
14. Confirmar Admin en yard_users
15. Confirmar map_state rev > 0
16. Crear Viewer
17. Abrir app en teléfono
18. Crear alerta desde Viewer
19. Ver alerta desde Admin
20. Resolverla
21. Probar foto
22. Instalar la PWA en el teléfono
```

Si uno de estos pasos falla, **no continúes con el siguiente** hasta corregirlo. Así podremos identificar exactamente dónde está cualquier problema.

---

# REFERENCIAS OFICIALES

Las ubicaciones exactas de algunos botones pueden cambiar ligeramente con actualizaciones de las plataformas. Las referencias oficiales actuales son:

- Supabase API Keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase SQL / Tables: https://supabase.com/docs/guides/database/tables
- Supabase Storage: https://supabase.com/docs/guides/storage
- Vercel Git deployments: https://vercel.com/docs/git
- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- GitHub Upload Files: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

---

# CÓDIGOS DE BARRAS → PRODUCTO

Al escanear una etiqueta, el lector devuelve un UPC/EAN (por ejemplo
`704496065337`), que no le dice nada a nadie en la yarda. La app lo convierte
al número de parte y muestra el producto escrito.

## Archivos

| Archivo | Qué tiene | De dónde sale |
|---|---|---|
| `barcodes.js` | 2 896 códigos de barras → número de parte | `seed/Part_Conversion.xlsx` |
| `catalog.js` | 104 números de parte → nombre del producto | `fotos3point.xlsx` |

Los dos se cargan solos con la página (`index.html` los llama antes del mapa),
así que un teléfono nuevo ya escanea bien sin importar nada.

## Cuando llegue un Excel de códigos actualizado

Menú → **Control Center** → pestaña **Settings** → fila *Barcode conversion* →
**Load barcode list**, y elija el Excel. Nada más.

Acepta el archivo del ERP tal como sale (columnas `PartNum` y `BarCode`) y
también `FG` + `UPC` del reporte de inventario.

Los códigos se guardan **dentro del mapa**, igual que las fichas: quien tenga
la app se los lleva en la siguiente sincronización, sin volver a publicar el
sitio ni reemplazar archivos. Lo mismo pasa con los nombres de producto del
reporte de inventario: el administrador lo carga una vez y los demás
teléfonos ya leen el producto escrito aunque nunca hayan cargado un reporte.

En el mapa solo se guarda **lo que sea distinto** de la lista que trae la app,
así que volver a cargar el mismo archivo no lo infla. Con la tabla completa
sustituida, el mapa pesa unos 220 KB — el servidor admite 5 500 KB.

> **Ojo:** "se lo llevan todos" vale cuando el sitio está publicado con
> Supabase y las variables de Vercel puestas. Sin backend, la app trabaja en
> modo local y el mapa (con sus códigos y nombres) se guarda solo en ese
> navegador.

## Meter los códigos dentro de la app (opcional)

Sirve para que un teléfono recién instalado escane bien **antes** de
sincronizar, o si todavía no hay backend. En la misma fila:

1. **⬇ Download barcodes.js** → descarga el archivo ya armado, con lo que trae
   la app más lo que se haya cargado encima.
2. Reemplace el `barcodes.js` del sitio por ese y vuelva a publicar.

## Regenerar los archivos desde los Excel de origen

Solo hace falta si se quiere rehacer todo desde cero, o para actualizar los
nombres de `catalog.js`. Con Python instalado:

```
python3 tools/build-barcode-map.py
```

Reescribe `barcodes.js` y `catalog.js` a partir de `seed/Part_Conversion.xlsx`
y `fotos3point.xlsx`. Da exactamente el mismo `barcodes.js` que el botón de
descarga de la app.

## De dónde salen los nombres

1. El **reporte de inventario TGU** que carga el administrador (columna
   `Description`) — es el que cubre toda la planta.
2. `catalog.js`, la lista que viene con la app (104 productos, los de 3 puntos).

Si un número de parte no está en ninguno de los dos, la app muestra el número
de parte solo y avisa que ese producto todavía no tiene nombre. Cargando el
reporte de inventario del día se llenan los que faltan.
