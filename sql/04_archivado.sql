-- ─────────────────────────────────────────────────────────────
--  04 · Estado 'archivado' para pedidos
--
--  "Limpiar historial" en la pantalla de cocina antes solo vaciaba un array
--  en memoria: al reiniciar el servidor los pedidos volvían a aparecer. Para
--  que la limpieza sea real necesita quedar escrita en la BD, pero sin borrar
--  la venta (los reportes del admin viven de esos datos).
--
--  'archivado' = la venta ocurrió y sigue en la base, pero ya no se muestra
--  en la vista del día. Correr en el SQL Editor después de 03_usuarios.sql.
-- ─────────────────────────────────────────────────────────────

alter table pedidos drop constraint if exists pedidos_estado_check;

alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'completado', 'cancelado', 'archivado'));
