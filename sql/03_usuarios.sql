-- ═══════════════════════════════════════════════════════════════
--  USUARIOS — una cuenta por persona, no un PIN por rol
--
--  Antes había un PIN compartido por rol (cocina/mesero/admin), así que
--  no se sabía quién tomó un pedido ni quién ajustó el inventario: en
--  movimientos_inventario quedaba el texto "mesero".
--
--  Correr en el SQL Editor de Supabase DESPUÉS de 01_schema.sql.
--  Los PINs no se ponen aquí: se crean con `node scripts/crear-usuarios.js`,
--  que los guarda con hash bcrypt (nunca en texto plano).
-- ═══════════════════════════════════════════════════════════════

create table if not exists usuarios (
  id             bigint generated always as identity primary key,
  nombre         text    not null,
  rol            text    not null check (rol in ('mesero', 'cocina', 'admin')),
  pin_hash       text    not null,              -- bcrypt, nunca el PIN plano
  activo         boolean not null default true, -- se desactiva, no se borra:
                                                -- así el historial conserva su autor
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_usuarios_activo on usuarios(activo);

-- En el login la gente se reconoce por el nombre, así que dos "Ana" serían
-- indistinguibles. Se bloquea sin importar mayúsculas ni si está inactivo.
create unique index if not exists idx_usuarios_nombre on usuarios(lower(nombre));

drop trigger if exists trg_usuarios_upd on usuarios;
create trigger trg_usuarios_upd before update on usuarios
  for each row execute function set_actualizado_en();

-- ── Quién hizo cada movimiento de inventario ──────────────────
-- La columna `usuario` (texto) ya existía y guardaba el rol. Se le agrega el
-- id para poder cruzar por persona en reportes. El texto se conserva a
-- propósito: si alguien se renombra, el histórico debe seguir diciendo cómo
-- se llamaba cuando ocurrió el movimiento.
alter table movimientos_inventario
  add column if not exists usuario_id bigint references usuarios(id) on delete set null;

create index if not exists idx_mov_usuario on movimientos_inventario(usuario_id);

-- ── Quién tomó cada pedido ────────────────────────────────────
alter table pedidos
  add column if not exists usuario_id bigint references usuarios(id) on delete set null;

create index if not exists idx_pedidos_usuario on pedidos(usuario_id);

-- ── Las funciones de inventario ahora reciben también el id ───
-- Se BORRAN las versiones de 2 argumentos primero: en Postgres, agregar un
-- parámetro crea una sobrecarga, y las llamadas con 2 argumentos quedarían
-- ambiguas ("function is not unique") en vez de reemplazarse.
drop function if exists descontar_inventario_pedido(bigint, text);
drop function if exists devolver_inventario_pedido(bigint, text);

create or replace function descontar_inventario_pedido(
  p_pedido_id bigint, p_usuario text default '', p_usuario_id bigint default null)
returns void language plpgsql as $$
declare r record; nuevo numeric;
begin
  for r in
    select rec.insumo_id, sum(rec.cantidad * pi.cantidad) as consumo
    from pedido_items pi
    join recetas rec on rec.producto_id = pi.producto_id
    where pi.pedido_id = p_pedido_id
    group by rec.insumo_id
  loop
    update insumos set stock = stock - r.consumo
      where id = r.insumo_id returning stock into nuevo;
    insert into movimientos_inventario(insumo_id, tipo, cantidad, stock_resultante,
                                       motivo, pedido_id, usuario, usuario_id)
      values (r.insumo_id, 'venta', -r.consumo, nuevo,
              'Venta del pedido #' || p_pedido_id, p_pedido_id, p_usuario, p_usuario_id);
  end loop;
  perform recalcular_agotados();
end; $$;

create or replace function devolver_inventario_pedido(
  p_pedido_id bigint, p_usuario text default '', p_usuario_id bigint default null)
returns void language plpgsql as $$
declare r record; nuevo numeric;
begin
  for r in
    select rec.insumo_id, sum(rec.cantidad * pi.cantidad) as consumo
    from pedido_items pi
    join recetas rec on rec.producto_id = pi.producto_id
    where pi.pedido_id = p_pedido_id
    group by rec.insumo_id
  loop
    update insumos set stock = stock + r.consumo
      where id = r.insumo_id returning stock into nuevo;
    insert into movimientos_inventario(insumo_id, tipo, cantidad, stock_resultante,
                                       motivo, pedido_id, usuario, usuario_id)
      values (r.insumo_id, 'devolucion', r.consumo, nuevo,
              'Devolución del pedido #' || p_pedido_id, p_pedido_id, p_usuario, p_usuario_id);
  end loop;
  perform recalcular_agotados();
end; $$;
