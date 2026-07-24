-- ═══════════════════════════════════════════════════════════════
--  MOTOR CLONABLE — Sistema de restaurante (Vorastudio)
--  Esquema base. Un proyecto Supabase = un negocio (sin negocio_id).
--  Pegar completo en:  Supabase → SQL Editor → New query → Run
--  Precios en pesos enteros (COP, sin decimales). Stock por unidades.
-- ═══════════════════════════════════════════════════════════════

-- ── Utilidad: mantener actualizado_en ──────────────────────────
create or replace function set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end; $$;

-- ── config: datos del negocio (una sola fila) ──────────────────
create table if not exists config (
  id            smallint primary key default 1,
  nombre        text    not null default 'Mi Restaurante',
  moneda        text    not null default 'COP',
  impuesto_rate numeric(5,2) not null default 0,   -- % para facturación (Factus)
  whatsapp      text    default '',
  constraint config_una_fila check (id = 1)
);
insert into config (id, nombre) values (1, 'Coraje Fast Food')
  on conflict (id) do nothing;

-- ── categorias: cada negocio define las suyas ──────────────────
create table if not exists categorias (
  id        bigint generated always as identity primary key,
  nombre    text not null unique,
  orden     int  not null default 0,
  creado_en timestamptz not null default now()
);

-- ── productos: fuente única (alimenta menú y toma de pedidos) ───
create table if not exists productos (
  id             bigint generated always as identity primary key,
  categoria_id   bigint references categorias(id) on delete set null,
  nombre         text    not null,
  descripcion    text    default '',
  precio         int     not null default 0,
  precio_combo   int,                              -- null si no aplica
  imagen         text    default '',               -- URL (Storage) o ruta local
  emoji          text    default '',               -- fallback sin foto (bebidas)
  disponible     boolean not null default true,    -- apagado MANUAL por el negocio
  agotado        boolean not null default false,   -- apagado AUTOMÁTICO por inventario
  promo          text,                             -- badge "2x1" / "-20%" (opcional)
  orden          int     not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists idx_productos_categoria on productos(categoria_id);
drop trigger if exists trg_productos_upd on productos;
create trigger trg_productos_upd before update on productos
  for each row execute function set_actualizado_en();

-- ── insumos: lo que se consume, contado en UNIDADES (porcionado) ─
create table if not exists insumos (
  id             bigint generated always as identity primary key,
  nombre         text    not null,                 -- "Carne premium 150g"
  unidad         text    not null default 'unidad',-- descripción de la porción
  stock          numeric not null default 0,       -- unidades disponibles
  stock_min      numeric not null default 0,       -- umbral de alerta
  costo_unitario int     default 0,                -- opcional (reportes de costo)
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
drop trigger if exists trg_insumos_upd on insumos;
create trigger trg_insumos_upd before update on insumos
  for each row execute function set_actualizado_en();

-- ── recetas: qué insumos (y cuántas unidades) consume un producto ─
create table if not exists recetas (
  id          bigint generated always as identity primary key,
  producto_id bigint not null references productos(id) on delete cascade,
  insumo_id   bigint not null references insumos(id)   on delete cascade,
  cantidad    numeric not null default 1,            -- unidades de insumo por 1 producto
  unique (producto_id, insumo_id)
);
create index if not exists idx_recetas_producto on recetas(producto_id);
create index if not exists idx_recetas_insumo   on recetas(insumo_id);

-- ── pedidos + items (con nombre/precio "congelados" al vender) ──
create table if not exists pedidos (
  id             bigint generated always as identity primary key,
  tipo           text not null default 'mesa' check (tipo in ('mesa','domicilio','llevar')),
  mesa           text default '',
  cliente_nombre text default '',
  telefono       text default '',
  direccion      text default '',
  notas          text default '',
  nit            text default '',
  email          text default '',
  estado         text not null default 'pendiente' check (estado in ('pendiente','completado','cancelado')),
  total          int  not null default 0,
  facturado      boolean not null default false,
  cufe           text,
  factura_num    text,
  creado_en      timestamptz not null default now(),
  completado_en  timestamptz
);
create index if not exists idx_pedidos_estado on pedidos(estado);

create table if not exists pedido_items (
  id          bigint generated always as identity primary key,
  pedido_id   bigint not null references pedidos(id) on delete cascade,
  producto_id bigint references productos(id) on delete set null,
  nombre      text not null,                 -- snapshot al momento de la venta
  precio      int  not null,                 -- snapshot (precio cobrado: solo o combo)
  cantidad    int  not null default 1,
  es_combo    boolean not null default false
);
create index if not exists idx_pedido_items_pedido on pedido_items(pedido_id);

-- ── movimientos_inventario: auditoría de stock ─────────────────
create table if not exists movimientos_inventario (
  id               bigint generated always as identity primary key,
  insumo_id        bigint not null references insumos(id) on delete cascade,
  tipo             text not null check (tipo in ('entrada','salida','ajuste','venta','devolucion')),
  cantidad         numeric not null,          -- + entra, - sale
  stock_resultante numeric,                   -- stock tras el movimiento
  motivo           text default '',
  pedido_id        bigint references pedidos(id) on delete set null,
  usuario          text default '',
  creado_en        timestamptz not null default now()
);
create index if not exists idx_mov_insumo on movimientos_inventario(insumo_id);

-- ═══════════════════════════════════════════════════════════════
--  LÓGICA DE INVENTARIO (atómica, del lado de la base de datos)
-- ═══════════════════════════════════════════════════════════════

-- Recalcula qué productos quedan "agotados" según el stock de sus insumos.
-- Un producto se agota si ALGÚN insumo de su receta no alcanza para 1 unidad.
-- Productos sin receta nunca se agotan por inventario.
create or replace function recalcular_agotados()
returns void language plpgsql as $$
begin
  update productos p
    set agotado = sub.faltante
  from (
    select p2.id,
      exists (
        select 1 from recetas r
        join insumos i on i.id = r.insumo_id
        where r.producto_id = p2.id and i.activo and i.stock < r.cantidad
      ) as faltante
    from productos p2
  ) sub
  where p.id = sub.id and p.agotado is distinct from sub.faltante;
end; $$;

-- Descuenta del stock los insumos que consume un pedido (según recetas).
create or replace function descontar_inventario_pedido(p_pedido_id bigint, p_usuario text default '')
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
      where id = r.insumo_id
      returning stock into nuevo;
    insert into movimientos_inventario(insumo_id, tipo, cantidad, stock_resultante, motivo, pedido_id, usuario)
      values (r.insumo_id, 'venta', -r.consumo, nuevo, 'Pedido #'||p_pedido_id, p_pedido_id, p_usuario);
  end loop;
  perform recalcular_agotados();
end; $$;

-- Devuelve el stock cuando un pedido se cancela.
create or replace function devolver_inventario_pedido(p_pedido_id bigint, p_usuario text default '')
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
      where id = r.insumo_id
      returning stock into nuevo;
    insert into movimientos_inventario(insumo_id, tipo, cantidad, stock_resultante, motivo, pedido_id, usuario)
      values (r.insumo_id, 'devolucion', r.consumo, nuevo, 'Cancelación pedido #'||p_pedido_id, p_pedido_id, p_usuario);
  end loop;
  perform recalcular_agotados();
end; $$;
