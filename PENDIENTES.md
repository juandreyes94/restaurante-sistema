# Pendientes — antes de producción

Notas de endurecimiento del sistema. Estos puntos **no** aplican en pruebas locales;
se hacen todos juntos cuando el proyecto vaya a desplegarse en un servidor real.

Última actualización: 2026-07-23

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
