// ─────────────────────────────────────────────────────────────
//  Capa de datos — Supabase (reemplazo de store.js)
//  Estrategia: caché en memoria + escritura hacia Supabase (write-through).
//   · Lecturas (pendientes/completados/products) → memoria, síncronas
//     → el frontend (comanda/mesero/admin) no cambia de forma.
//   · Escrituras → memoria (instantáneo para el WebSocket) + persistencia
//     en Supabase por detrás. El inventario se descuenta/devuelve vía RPC.
//  Un proyecto Supabase = un negocio (sin negocio_id).
// ─────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const cfg = require('./supabase.config.js');

const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

// ── Caché en memoria ──
let _orders = [];          // pedidos (pendientes + completados recientes) con forma del frontend
let _products = [];        // productos con forma del frontend
let _catById = new Map();  // categoria_id -> nombre

const ms = (iso) => (iso ? new Date(iso).getTime() : Date.now());

// DB → forma que ya espera el frontend
function mapProducto(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: _catById.get(p.categoria_id) || '',
    categoria_id: p.categoria_id,
    descripcion: p.descripcion || '',
    precio: p.precio,
    precioCombo: p.precio_combo,
    imagen: p.imagen || '',
    emoji: p.emoji || '',
    disponible: p.disponible && !p.agotado,   // agotado por inventario = no disponible para el mesero
    agotado: p.agotado,
    promo: p.promo || '',
    orden: p.orden,
  };
}

function mapOrder(o) {
  return {
    id: o.id,
    tipo: o.tipo,
    mesa: o.mesa || '',
    direccion: o.direccion || '',
    telefono: o.telefono || '',
    items: (o.pedido_items || []).map(it => ({
      name: it.nombre, price: it.precio, qty: it.cantidad,
      productoId: it.producto_id, esCombo: it.es_combo,
    })),
    nombre: o.cliente_nombre || '',
    notas: o.notas || '',
    nit: o.nit || '',
    email: o.email || '',
    timestamp: ms(o.creado_en),
    status: o.estado,
    facturado: o.facturado,
    completedAt: o.completado_en ? ms(o.completado_en) : undefined,
    cufe: o.cufe || undefined,
    facturaNum: o.factura_num || undefined,
  };
}

// ── Arranque: cargar caché desde Supabase ──
async function init() {
  const [{ data: cats }, { data: prods }, { data: peds }] = await Promise.all([
    supa.from('categorias').select('id,nombre').order('orden'),
    supa.from('productos').select('*').order('categoria_id').order('orden'),
    supa.from('pedidos')
      .select('*, pedido_items(*)')
      .in('estado', ['pendiente', 'completado'])
      .order('creado_en'),
  ]);
  _catById = new Map((cats || []).map(c => [c.id, c.nombre]));
  _products = (prods || []).map(mapProducto);
  _orders = (peds || []).map(mapOrder);
  console.log(`💾 Supabase: ${_products.length} productos, ${_orders.length} pedidos en caché`);
}

// ── Resolver producto_id de un ítem (por id explícito o por nombre) ──
function resolveProductoId(item) {
  if (item.productoId) return item.productoId;
  const p = _products.find(p => p.nombre === item.name);
  return p ? p.id : null;
}

// ── Escritura de un pedido nuevo (async: necesitamos el id real de la BD) ──
async function add(order) {
  const total = (order.items || []).reduce((s, i) => s + i.price * i.qty, 0);
  const { data: ped, error } = await supa.from('pedidos').insert({
    tipo: order.tipo,
    mesa: order.mesa || '',
    cliente_nombre: order.nombre || '',
    telefono: order.telefono || '',
    direccion: order.direccion || '',
    notas: order.notas || '',
    nit: order.nit || '',
    email: order.email || '',
    estado: 'pendiente',
    total,
    creado_en: new Date(order.timestamp || Date.now()).toISOString(),
  }).select('*').single();
  if (error) throw error;

  const items = (order.items || []).map(i => ({
    pedido_id: ped.id,
    producto_id: resolveProductoId(i),
    nombre: i.name,
    precio: i.price,
    cantidad: i.qty,
    es_combo: !!i.esCombo,
  }));
  await supa.from('pedido_items').insert(items);

  // Descontar inventario (ignora ítems sin producto_id / sin receta)
  await supa.rpc('descontar_inventario_pedido', { p_pedido_id: ped.id, p_usuario: 'mesero' });
  await refreshProductosAgotados();

  const full = mapOrder({ ...ped, pedido_items: items });
  _orders.push(full);
  return full;
}

// ── Completar ──
async function completar(id) {
  const o = _orders.find(o => o.id === id);
  if (!o) return null;
  o.status = 'completado';
  o.completedAt = Date.now();
  await supa.from('pedidos').update({ estado: 'completado', completado_en: new Date(o.completedAt).toISOString() }).eq('id', id);
  return o;
}

// ── Editar pedido pendiente (reajusta inventario: devuelve y vuelve a descontar) ──
async function editar(id, fields) {
  const o = _orders.find(o => o.id === id);
  if (!o) return null;
  Object.assign(o, fields, { editedAt: Date.now() });
  await supa.rpc('devolver_inventario_pedido', { p_pedido_id: id, p_usuario: 'mesero' });
  await supa.from('pedidos').update({
    tipo: o.tipo, mesa: o.mesa, direccion: o.direccion, telefono: o.telefono,
    cliente_nombre: o.nombre, notas: o.notas,
    total: o.items.reduce((s, i) => s + i.price * i.qty, 0),
  }).eq('id', id);
  await supa.from('pedido_items').delete().eq('pedido_id', id);
  await supa.from('pedido_items').insert(o.items.map(i => ({
    pedido_id: id, producto_id: resolveProductoId(i),
    nombre: i.name, precio: i.price, cantidad: i.qty, es_combo: !!i.esCombo,
  })));
  await supa.rpc('descontar_inventario_pedido', { p_pedido_id: id, p_usuario: 'mesero' });
  await refreshProductosAgotados();
  return o;
}

// ── Cancelar pedido pendiente (devuelve inventario) ──
async function remove(id) {
  const i = _orders.findIndex(o => o.id === id);
  if (i === -1) return;
  _orders.splice(i, 1);
  await supa.rpc('devolver_inventario_pedido', { p_pedido_id: id, p_usuario: 'mesero' });
  await supa.from('pedidos').update({ estado: 'cancelado' }).eq('id', id);
  await refreshProductosAgotados();
}

// ── Marcar facturado ──
async function marcarFacturado(id, { cufe, number }) {
  const o = _orders.find(o => o.id === id);
  if (o) { o.facturado = true; o.cufe = cufe; o.facturaNum = number; }
  await supa.from('pedidos').update({ facturado: true, cufe, factura_num: number }).eq('id', id);
  return o;
}

// ── Limpiar completados de la vista (no borra de la BD: quedan como histórico) ──
async function clearCompletados() {
  _orders = _orders.filter(o => o.status === 'pendiente');
}

// ── Productos (CRUD) ──
async function productAdd(p) {
  const { data, error } = await supa.from('productos').insert({
    nombre: p.nombre, categoria_id: await categoriaId(p.categoria),
    descripcion: p.descripcion || '', precio: p.precio,
    precio_combo: p.precioCombo ?? null, imagen: p.imagen || '',
    emoji: p.emoji || '', disponible: p.disponible !== false,
  }).select('*').single();
  if (error) throw error;
  const mp = mapProducto(data);
  _products.push(mp);
  return mp;
}
async function productUpdate(id, fields) {
  const patch = {};
  if (fields.nombre !== undefined) patch.nombre = fields.nombre;
  if (fields.categoria !== undefined) patch.categoria_id = await categoriaId(fields.categoria);
  if (fields.descripcion !== undefined) patch.descripcion = fields.descripcion;
  if (fields.precio !== undefined) patch.precio = fields.precio;
  if (fields.precioCombo !== undefined) patch.precio_combo = fields.precioCombo;
  if (fields.imagen !== undefined) patch.imagen = fields.imagen;
  if (fields.emoji !== undefined) patch.emoji = fields.emoji;
  if (fields.disponible !== undefined) patch.disponible = !!fields.disponible;
  const { data, error } = await supa.from('productos').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  const mp = mapProducto(data);
  const idx = _products.findIndex(p => p.id === id);
  if (idx >= 0) _products[idx] = mp;
  return mp;
}
async function productDelete(id) {
  await supa.from('productos').delete().eq('id', id);
  _products = _products.filter(p => p.id !== id);
}

// categoria por nombre → id (crea la categoría si no existe)
async function categoriaId(nombre) {
  if (!nombre) return null;
  for (const [id, n] of _catById) if (n === nombre) return id;
  const { data } = await supa.from('categorias').insert({ nombre }).select('id').single();
  if (data) { _catById.set(data.id, nombre); return data.id; }
  return null;
}

// ── Inventario ──
async function insumos() {
  const { data } = await supa.from('insumos').select('*').order('nombre');
  return data || [];
}
async function insumoEntrada(id, cantidad, usuario = 'admin') {
  const { data: ins } = await supa.from('insumos').select('stock').eq('id', id).single();
  const nuevo = Number(ins.stock) + Number(cantidad);
  await supa.from('insumos').update({ stock: nuevo }).eq('id', id);
  await supa.from('movimientos_inventario').insert({
    insumo_id: id, tipo: 'entrada', cantidad: Number(cantidad), stock_resultante: nuevo,
    motivo: 'Entrada de stock', usuario,
  });
  await refreshProductosAgotados();
  return nuevo;
}
async function insumoUpdate(id, fields) {
  const patch = {};
  ['nombre', 'unidad', 'stock', 'stock_min', 'costo_unitario', 'activo'].forEach(k => {
    if (fields[k] !== undefined) patch[k] = fields[k];
  });
  const { data } = await supa.from('insumos').update(patch).eq('id', id).select('*').single();
  await refreshProductosAgotados();
  return data;
}
async function insumoAdd(p) {
  const { data } = await supa.from('insumos').insert({
    nombre: p.nombre, unidad: p.unidad || 'unidad',
    stock: p.stock || 0, stock_min: p.stock_min || 0,
  }).select('*').single();
  return data;
}
async function movimientos(insumoId) {
  let q = supa.from('movimientos_inventario').select('*').order('creado_en', { ascending: false }).limit(200);
  if (insumoId) q = q.eq('insumo_id', insumoId);
  const { data } = await q;
  return data || [];
}
async function alertas() {
  const { data } = await supa.from('insumos').select('*').eq('activo', true);
  return (data || []).filter(i => Number(i.stock) <= Number(i.stock_min));
}

// Refresca el flag "agotado" de los productos en caché tras cambios de stock
async function refreshProductosAgotados() {
  await supa.rpc('recalcular_agotados');
  const { data } = await supa.from('productos').select('id,agotado,disponible');
  const byId = new Map((data || []).map(p => [p.id, p]));
  _products.forEach(p => {
    const db = byId.get(p.id);
    if (db) { p.agotado = db.agotado; p.disponible = db.disponible && !db.agotado; }
  });
}

module.exports = {
  init,
  // Lecturas (síncronas desde caché)
  all: () => _orders,
  pendientes: () => _orders.filter(o => o.status === 'pendiente'),
  completados: () => _orders.filter(o => o.status === 'completado'),
  get: (id) => _orders.find(o => o.id === id),
  products: () => _products,
  productGet: (id) => _products.find(p => p.id === id),
  // Escrituras (async, write-through)
  add, completar, editar, remove, marcarFacturado, clearCompletados,
  productAdd, productUpdate, productDelete,
  // Inventario
  insumos, insumoAdd, insumoEntrada, insumoUpdate, movimientos, alertas,
  // Compatibilidad: el catálogo ahora vive en la BD, no se siembra desde el código
  ensureCatalog: () => {},
  save: () => {},
};
