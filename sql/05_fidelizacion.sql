-- ─────────────────────────────────────────────────────────────
--  05 · Fidelización — tarjeta de sellos del cliente
--
--  Los clientes NO van en `usuarios`. Esa tabla es del personal: tiene el rol
--  restringido a mesero/cocina/admin y un PIN con hash para entrar al POS.
--  Mezclarlas obligaría a que cada comensal apareciera en el login del
--  restaurante. Son dos poblaciones distintas y viven aparte.
--
--  Correr en el SQL Editor después de 04_archivado.sql.
-- ─────────────────────────────────────────────────────────────

-- ── Reglas del programa: en la base, no en el código ───────────
--  Así el restaurante cambia la promoción sin que nadie despliegue nada.
alter table config add column if not exists sellos_por_premio  int  not null default 10;
alter table config add column if not exists sellos_por_compra   int  not null default 1;
alter table config add column if not exists premio_descripcion  text not null default 'Un producto gratis';
alter table config add column if not exists fidelizacion_activa boolean not null default true;

-- ── clientes ───────────────────────────────────────────────────
--  `codigo` es lo que viaja en el QR de la tarjeta y en su URL pública. Es
--  aleatorio a propósito: si fuera el id secuencial, cualquiera podría contar
--  hacia arriba y abrir la tarjeta de otro. No es un secreto fuerte (va
--  impreso en el celular del cliente), pero sí evita la enumeración.
--
--  El teléfono identifica al cliente en el mostrador cuando no trae el QR a
--  mano, así que es único. Se guarda solo con dígitos para que no dependa de
--  cómo lo escriba cada mesero.
create table if not exists clientes (
  id              bigint generated always as identity primary key,
  codigo          text    not null unique,
  nombre          text    not null,
  telefono        text    not null unique,
  email           text    default '',
  -- Habeas data: en Colombia hay que poder demostrar que el cliente autorizó
  -- el tratamiento de sus datos, y cuándo. Sin esto no se debería registrar.
  autoriza_datos  boolean not null default false,
  autorizado_en   timestamptz,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_clientes_telefono on clientes(telefono);

-- ── sellos: un renglón por sello otorgado ──────────────────────
--  Igual que movimientos_inventario: el saldo es una consecuencia del
--  historial, no un número suelto que alguien pueda tocar. Así se puede
--  responder "quién le puso este sello y en qué pedido" meses después.
create table if not exists sellos (
  id         bigint generated always as identity primary key,
  cliente_id bigint not null references clientes(id) on delete cascade,
  pedido_id  bigint references pedidos(id) on delete set null,
  cantidad   int    not null default 1 check (cantidad > 0),
  usuario_id bigint references usuarios(id) on delete set null,
  usuario    text   default '',      -- snapshot del nombre, por si se desactiva
  creado_en  timestamptz not null default now()
);
create index if not exists idx_sellos_cliente on sellos(cliente_id);
-- Un pedido no puede sellar dos veces. Es la protección real contra el mesero
-- que toca el botón dos veces o contra un reintento de red.
create unique index if not exists idx_sellos_pedido_unico
  on sellos(pedido_id) where pedido_id is not null;

-- ── canjes: cuando el cliente cobra el premio ──────────────────
create table if not exists canjes (
  id            bigint generated always as identity primary key,
  cliente_id    bigint not null references clientes(id) on delete cascade,
  pedido_id     bigint references pedidos(id) on delete set null,
  sellos_usados int    not null check (sellos_usados > 0),
  premio        text   not null default '',   -- snapshot de lo que se entregó
  usuario_id    bigint references usuarios(id) on delete set null,
  usuario       text   default '',
  creado_en     timestamptz not null default now()
);
create index if not exists idx_canjes_cliente on canjes(cliente_id);

-- ── Saldo de sellos ────────────────────────────────────────────
--  Ganados menos gastados. Se calcula, no se almacena: un contador guardado se
--  desincroniza en cuanto algo falle a mitad de camino.
create or replace function sellos_disponibles(p_cliente_id bigint)
returns int language sql stable as $$
  select coalesce((select sum(cantidad) from sellos where cliente_id = p_cliente_id), 0)
       - coalesce((select sum(sellos_usados) from canjes where cliente_id = p_cliente_id), 0);
$$;

-- ── Canjear: descuenta solo si alcanza ─────────────────────────
--  La comprobación y la escritura van juntas en la misma transacción. Si se
--  hicieran por separado desde el servidor, dos meseros canjeando a la vez
--  podrían entregar dos premios con los sellos de uno.
create or replace function canjear_premio(
  p_cliente_id bigint,
  p_pedido_id  bigint,
  p_usuario_id bigint,
  p_usuario    text
) returns int language plpgsql as $$
declare
  v_necesarios int;
  v_premio     text;
  v_saldo      int;
begin
  select sellos_por_premio, premio_descripcion into v_necesarios, v_premio
    from config where id = 1;

  -- for update sobre el cliente: serializa los canjes de esa persona.
  perform 1 from clientes where id = p_cliente_id for update;

  v_saldo := sellos_disponibles(p_cliente_id);
  if v_saldo < v_necesarios then
    raise exception 'Sellos insuficientes: tiene %, necesita %', v_saldo, v_necesarios
      using errcode = 'P0001';
  end if;

  insert into canjes (cliente_id, pedido_id, sellos_usados, premio, usuario_id, usuario)
  values (p_cliente_id, p_pedido_id, v_necesarios, v_premio, p_usuario_id, p_usuario);

  return v_saldo - v_necesarios;
end;
$$;
