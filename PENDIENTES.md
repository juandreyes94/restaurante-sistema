# Pendientes — antes de producción

Notas de endurecimiento del sistema. Estos puntos **no** aplican en pruebas locales;
se hacen todos juntos cuando el proyecto vaya a desplegarse en un servidor real.

Última actualización: 2026-07-23

---

## 🎯 PRÓXIMO PASO — Carga de imágenes de productos a Supabase Storage

Hoy las fotos de productos se sirven por **ruta local** (`img/hamburguesa-coraje.jpg`)
o URL. Falta que el dueño pueda **subir fotos desde el panel** y que se guarden en
**Supabase Storage** (para que el catálogo sea 100% autogestionable y clonable).

**Plan concreto (para retomar):**
1. **Supabase:** crear un bucket **público** llamado `productos` en Storage
   (Storage → New bucket → Public).
2. **Backend (`server.js` + `store-supabase.js`):**
   - Agregar `multer` (memory storage) para recibir el archivo.
   - Endpoint `POST /upload` (rol admin) → recibe imagen → `supa.storage.from('productos')
     .upload(nombreUnico, buffer, { contentType })` → devuelve la **URL pública**
     (`supa.storage.from('productos').getPublicUrl(path)`).
   - Método `store.uploadImagen(buffer, filename, mime)` en el adaptador.
   - Ojo: `sharp` se quitó a propósito (rompía en Railung/Linux) — **no** re-agregarlo;
     si se quiere limitar peso, validar tamaño en el cliente o `multer` `limits`.
3. **Frontend (`src/admin.html`, modal de producto):**
   - Agregar `<input type="file" accept="image/*">` en el modal.
   - Al elegir archivo: subirlo a `/upload`, recibir la URL, y meterla en `#fImagen`
     (mostrar preview). El resto del guardado de producto ya funciona igual.
4. (Opcional) Migrar las imágenes actuales de `src/img/*.jpg` al bucket para no depender
   de archivos locales al desplegar.

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

### 1. PINs y secretos fuera del código
Hoy están hardcodeados y se imprimen en consola al arrancar.

- `server.js:46-50` — PINs por defecto `cocina: 1234` / `mesero: 5678` / `admin: 9876`.
  Mover a variables de entorno reales (`PIN_COCINA`, `PIN_MESERO`, `PIN_ADMIN`) y **quitar los valores por defecto**.
- El `console.log` del banner imprime los PINs al iniciar. Quitarlo en producción.
- `server.js:18-19` — `client_id` / `client_secret` de Factus hardcodeados. Mover a `factus.config.js`
  (que ya está en `.gitignore`) o a variables de entorno.
- `factus.config.js` — llenar credenciales reales (hoy tiene placeholders `TU_EMAIL@ejemplo.com`).

### 2. Tokens de sesión persistentes
- `server.js:50` — `_tokens` es un `Map` en memoria: al reiniciar el server se cierran todas las sesiones.
  Solo es tema si algún día hay varios servidores / balanceo. Evaluar mover a una store persistente
  (Redis o la misma BD) cuando se migre de JSON a Postgres (ver `store.js`).

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
