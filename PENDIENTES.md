# Pendientes — antes de producción

Notas de endurecimiento del sistema. Estos puntos **no** aplican en pruebas locales;
se hacen todos juntos cuando el proyecto vaya a desplegarse en un servidor real.

Última actualización: 2026-08-05

---

## ✅ Login por persona + pantalla de Usuarios (hecho — 2026-08-05)

Se acabó el PIN compartido por rol. Ahora **cada persona tiene su cuenta**: en el login
elige el rol, toca su nombre y marca su PIN. Así queda registrado **quién** tomó cada
pedido y **quién** movió el inventario (antes en `movimientos_inventario` decía "mesero").

- **`sql/03_usuarios.sql`** — tabla `usuarios` (PIN con hash bcrypt, nombre único sin
  importar mayúsculas, `activo` en vez de borrar para no perder el autor del historial),
  `usuario_id` en `pedidos` y en `movimientos_inventario`, y las funciones
  `descontar/devolver_inventario_pedido` recreadas con un tercer parámetro `p_usuario_id`.
- **Sesión sin estado**: el token dejó de ser una entrada en un `Map` en memoria y pasó a
  ser un **JWT firmado** (12 h). Sobrevive a reinicios del servidor y sirve con varias
  instancias. Secreto en `JWT_SECRET` (avisa por consola si no está definido).
- **`src/auth.js`** — login estilo POS en las 5 pantallas: pestaña de rol → nombre → PIN.
- **Admin → Usuarios** (`src/admin.html`) — crear gente, cambiar rol, reasignar PIN y
  activar/desactivar. Guardas: nadie puede desactivarse a sí mismo ni quitarse su propio
  rol de admin (bloqueado en la UI y también en el servidor).
- **`scripts/crear-usuarios.js`** — siembra el equipo inicial conservando los PINs viejos
  (admin 9876 · cocina 1234 · mesero 5678). También agrega gente suelta:
  `node scripts/crear-usuarios.js "Ana" mesero 4321`.

**Ya aplicado en Supabase (2026-08-05):** se corrió `sql/03_usuarios.sql` y luego
`node scripts/crear-usuarios.js`. El equipo quedó sembrado con los PINs de siempre
(Administrador 9876 · Cocina 1234 · Mesero 5678). Si algún día se levanta la base desde
cero, ese es el orden: `01_schema.sql` → `02_seed_productos.sql` → `03_usuarios.sql` →
`crear-usuarios.js`.

**Verificado end-to-end** contra el servidor y la BD: login y PIN incorrecto, CRUD de
usuarios, nombre repetido con otra capitalización, PIN fuera de rango, cambio de PIN
(invalida el anterior), desactivar (saca del login y niega el acceso), las dos guardas de
auto-desactivación y auto-degradación respondiendo desde el **servidor**, roles cruzados y
token inventado → 403. Y lo que motivaba todo esto: un pedido de prueba quedó con su
`usuario_id` y sus movimientos de inventario firmados con el nombre de quien los hizo.
Los datos de esa prueba ya se limpiaron (el pedido se canceló por el flujo normal, así que
el inventario volvió a su sitio).

Nota: al desactivar a alguien o cambiarle el PIN, su sesión abierta sigue viva hasta que
vence el JWT (máx. 12 h). Si algún día importa cortar al instante, habría que revisar
`activo` en cada request o guardar una lista de tokens revocados.

---

## ✅ Inventario real + recetas + pantalla de recetas (hecho — 2026-07-27)

Llegó la planilla de inventario del cliente (foto `inventario coraje.jpeg`, 39 insumos).

- **Cambio de modelo**: el stock deja de contarse en *porciones* y pasa a la **unidad base**
  (gramos / unidades), que es como cuenta el cliente. `recetas.cantidad` = el peso por porción.
  El motor SQL no cambió: `descontar_inventario_pedido()` y `recalcular_agotados()` ya eran
  agnósticos de la unidad.
- **Excel de carga**: `C:/Users/Principal/Desktop/coraje/inventario-coraje-carga-supabase.xlsx`
  (hojas: como_cargar, insumos, recetas, mapeo_nombres, revisar_con_cliente, referencia_foto).
- **`scripts/cargar-inventario.js`** — lee ese Excel y lo aplica a Supabase en orden:
  renombrar (conserva ids) → dividir Pan brioche → crear/actualizar insumos → reemplazar
  recetas → `recalcular_agotados()`. Tiene `--dry-run` y es idempotente. Usa `xlsx` (nueva dep).
- **Recetas completas**: 35 productos / 146 líneas, derivadas de la descripción real de cada
  plato en `sql/02_seed_productos.sql` (antes eran 87 líneas con cantidad 1).
- **`src/recetas.html`** — pantalla nueva para que **cocina** (PIN 1234) o admin arme y edite
  recetas: buscador por plato o ingrediente, filtro "sin receta", y "alcanza para N platos"
  calculado contra el stock real. Endpoints `GET /recetas` y `PUT /recetas/:productoId`
  (rol cocina|admin) + `store.recetas()` / `store.recetaSet()`. Enlazada desde el admin.

**Pendiente de confirmar con el cliente** (hoja `revisar_con_cliente`): peso del bloque de queso
(se asumió 500 g), Huevos de Codorniz y Carne Desmechada tienen stock máximo que parece error de
digitación, y el "Chuzo Desgranado" es res/pollo/mixto a elección (hoy descuenta res). Insumos
sin usar en ninguna receta: Cebollín, Perejil Crespo, Pollo, Salsa Caramelizada.
Falta la pestaña "COSTOS GENERAL" del cliente para llenar `costo_unitario`.

---

## 🎯 PRÓXIMO PASO — Subir las fotos reales de los productos

La **mecánica ya está hecha** (commit `cb2f2ab`): bucket público `productos` en Supabase
Storage, `POST /upload` (rol admin, multer en memoria, máx 5 MB), `store.uploadImagen()`
y el selector de foto con vista previa en el modal de producto del admin.
Ojo: `sharp` se quitó a propósito (rompía en Linux) — **no** re-agregarlo.

Lo que falta es **contenido, no código**: hoy la BD tiene 35 productos, **0 con foto en
Storage** y **16 sin ninguna imagen**. Hay que subirlas desde Admin → Productos → Editar
(o pedirle al cliente las que falten) y, de paso, migrar las de `src/img/*.jpg` al bucket
para no depender de archivos locales al desplegar.

Notas del estado actual de datos (por si confunde al retomar): la BD de Supabase tiene
**datos de prueba** de esta sesión — un pedido #3 completado (por eso el dashboard
muestra ~$32.900) y algún movimiento de inventario de los tests. Se pueden borrar sin
problema desde el SQL Editor si se quiere arrancar limpio.

---

## ✅ Motor Supabase + Inventario (hecho — 2026-07-23, commit 11c2fc1)

El sistema pasó de JSON local a **Supabase** y ahora maneja **inventario por unidades**.
Todo probado end-to-end (mesero → cocina → stock baja; entrada de reposición → sube).

- **Base de datos** (proyecto Supabase `bjzdodqqvoszarvdaapz`, un proyecto por cliente):
  tablas `config, categorias, productos, insumos, recetas, pedidos, pedido_items,
  movimientos_inventario` + funciones SQL `descontar/devolver_inventario_pedido` y
  `recalcular_agotados`. SQL en `sql/01_schema.sql` y `sql/02_seed_productos.sql`.
- **Adaptador `store-supabase.js`** — caché en memoria + write-through. Misma interfaz
  que el viejo `store.js` (por eso `server.js` casi no cambió de forma) + métodos de
  inventario. Credenciales en `supabase.config.js` (gitignored; `.example` para clonar).
- **`server.js`** — usa el adaptador, rutas de escritura async, catálogo hardcodeado
  eliminado, nuevos endpoints: `GET/POST/PUT /insumos`, `POST /insumos/:id/entrada`,
  `GET /inventario/alertas`.
- **`mesero.html`** — manda `productoId` en cada ítem (para descontar la receta correcta).
- **`admin.html`** — sección **Inventario** activa: tabla stock/mínimo, banner de alertas,
  modal "Entrada" (reposición), modal nuevo/editar insumo.
- **Inventario por porcionado:** insumos en unidades, recetas producto↔insumo. Vender
  descuenta según receta; cancelar devuelve; productos se marcan `agotado` solos en 0.
  Seed: 29 insumos (stock 10) + 87 recetas (`scripts/seed-insumos.js`). Recetas deducidas
  del menú — **ajustar cuando llegue el inventario real** del cliente.
- **Clonar a otro cliente:** copiar repo → nuevo proyecto Supabase → correr `sql/*` →
  `node scripts/seed-insumos.js` → crear su `supabase.config.js`. La parte visual se
  retoca por cliente (el motor de datos es lo reutilizable).

---

## 🔴 Pendiente para el despliegue

### 1. Secretos fuera del código
- **`JWT_SECRET`** — hoy cae a un valor de desarrollo si no está definido (lo avisa por
  consola al arrancar). Definirlo como variable de entorno **antes de desplegar**: con el
  secreto de dev, cualquiera puede firmarse un token de admin.
- Los PINs ya **no** están en el código: viven cifrados en la tabla `usuarios` y el banner
  de arranque dejó de imprimirlos. Los de arranque (9876/1234/5678) son públicos de facto
  — cambiarlos desde Admin → Usuarios antes de entregar.
- `server.js:18-19` — `client_id` / `client_secret` de Factus hardcodeados. Mover a `factus.config.js`
  (que ya está en `.gitignore`) o a variables de entorno.
- `factus.config.js` — llenar credenciales reales (hoy tiene placeholders `TU_EMAIL@ejemplo.com`).

### 2. ~~Tokens de sesión persistentes~~ ✅ resuelto
El `Map` en memoria se reemplazó por JWT firmado: la sesión ya sobrevive al reinicio del
servidor y funcionaría con varias instancias. Queda solo el detalle de la revocación
inmediata (ver la nota de la sección de usuarios).

### 3. Cosmético (cuando se toque esa pantalla)
- `src/comanda.html` — la leyenda del semáforo (~línea 561) y los comentarios del código (~línea 891)
  no coinciden en los tiempos (habla de "5 min" vs "10 min"). Unificar los textos con `MAX_MIN`.

---

## 💡 Ideas futuras (referencia: EJEMPLO.jpeg del escritorio)

- **Promociones / badges en productos** — el POS de referencia muestra etiquetas tipo
  "2×1" y "20%" en la esquina de cada tarjeta. Hoy el catálogo no tiene ese dato.
  Para hacerlo: agregar un campo opcional `promo` al producto (en el catálogo del admin)
  y pintarlo como badge en `mesero.html` (`prodCard`) y en `menu.html`.

---

## ✅ Ya corregido (2026-07-23)

- **Rutas de pedidos protegidas** — `POST /pedido/:id/completar`, `GET /pedidos`,
  `DELETE /pedidos/completados` y `POST /facturar/:id` requieren rol `cocina` o `admin`.
  `POST /pedido` (crear pedido) requiere rol `mesero` o `admin`.
  Se dejaron abiertas a propósito: `POST /login` y `GET /productos` (el menú público lee el catálogo).
  > Nota: si en el futuro quieres que los clientes pidan solos desde el QR, habría que reabrir
  > `POST /pedido` (quitarle el `requireRole`) o darle su propio flujo.

- **Pantalla de meseros** — nueva `src/mesero.html`: carga el catálogo desde `/productos`
  (fuente única, se sincroniza sola con lo que edita el admin), arma el carrito, elige
  tipo (mesa/domicilio/llevar) y envía con `POST /pedido` → llega a comandas y admin.
  Acceso con rol `mesero` (PIN 5678 por defecto). Tiene búsqueda de productos y tema cálido (naranja).

- **Corregir / cancelar pedidos en vivo** — `PUT /pedido/:id` (editar) y `DELETE /pedido/:id`
  (cancelar), sólo sobre pedidos pendientes, rol `mesero`/`admin`. Emiten `order_updated` /
  `order_cancelled` por WebSocket → cocina y admin se actualizan al instante. El mesero corrige
  desde el cajón "Pedidos activos" en `mesero.html` (ahora con WebSocket, la lista es en vivo).

- **Aviso al mesero cuando cocina da "Listo"** — al completar, el servidor emite `order_complete`
  con los datos del pedido. `mesero.html` recibe el evento, suena una campana y muestra una
  tarjeta "Listos para entregar" con el destino (llevar a Mesa X / empacar domicilio / para llevar)
  y botón "Recogido ✓". Cierra el ciclo: pedir → cocinar → recoger → entregar.
- **Escape de HTML (anti-XSS)** — helper `esc()` en `src/comanda.html` y `src/admin.html`,
  aplicado a todos los campos que vienen del cliente (nombre, notas, mesa, dirección, teléfono,
  nombres de ítems, NIT, y campos del catálogo).
