// ─────────────────────────────────────────────────────────────
//  Capa de datos — Supabase (reemplazo de store.js)
//
//  Sin estado: cada lectura le pega a Supabase. Antes había una caché en
//  memoria que se llenaba al arrancar, lo cual servía cuando el sistema era
//  un solo proceso encendido todo el día. Al pasar a funciones (Vercel) eso
//  se rompe: cada invocación puede ser una instancia distinta y recién
//  creada, así que un pedido escrito en una no existiría para la otra.
//  La única fuente de verdad es la base de datos.
//
//  El inventario se descuenta/devuelve vía RPC.
//  Un proyecto Supabase = un negocio (sin negocio_id).
// ─────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const cfg = require('./config').supabase;
const { nuevoCodigo, normalizarCodigo, normalizarTelefono } = require('./codigo-cliente');

const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

// Un pedido siempre se lee con sus ítems: el frontend los espera juntos.
const SELECT_PEDIDO = '*, pedido_items(*)';

const ms = (iso) => (iso ? new Date(iso).getTime() : Date.now());

// DB → forma que ya espera el frontend
function mapProducto(p, catById) {
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: catById.get(p.categoria_id) || '',
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

// ── Arranque: solo comprobar que la BD responde ──
// Ya no precarga nada; sirve para fallar temprano y con un mensaje claro si
// las credenciales están mal, en vez de reventar en el primer pedido.
async function init() {
  const { error } = await supa.from('productos').select('id', { count: 'exact', head: true });
  if (error) throw error;
}

// ── Catálogo (categorías + productos) ──
async function catalogo() {
  const [{ data: cats }, { data: prods }] = await Promise.all([
    supa.from('categorias').select('id,nombre').order('orden'),
    supa.from('productos').select('*').order('categoria_id').order('orden'),
  ]);
  const catById = new Map((cats || []).map(c => [c.id, c.nombre]));
  return { catById, productos: (prods || []).map(p => mapProducto(p, catById)) };
}

async function products() {
  return (await catalogo()).productos;
}

async function productGet(id) {
  const [{ data: p }, { data: cats }] = await Promise.all([
    supa.from('productos').select('*').eq('id', id).maybeSingle(),
    supa.from('categorias').select('id,nombre'),
  ]);
  if (!p) return null;
  return mapProducto(p, new Map((cats || []).map(c => [c.id, c.nombre])));
}

// ── Lecturas de pedidos ──
async function pedidosPorEstado(estados) {
  const { data, error } = await supa.from('pedidos')
    .select(SELECT_PEDIDO).in('estado', estados).order('creado_en');
  if (error) throw error;
  return (data || []).map(mapOrder);
}

const pendientes  = () => pedidosPorEstado(['pendiente']);
const completados = () => pedidosPorEstado(['completado']);
const all         = () => pedidosPorEstado(['pendiente', 'completado']);

async function get(id) {
  const { data } = await supa.from('pedidos').select(SELECT_PEDIDO).eq('id', id).maybeSingle();
  return data ? mapOrder(data) : null;
}

// ── Resolver producto_id de un ítem (por id explícito o por nombre) ──
function resolveProductoId(item, productos) {
  if (item.productoId) return item.productoId;
  const p = productos.find(p => p.nombre === item.name);
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
    usuario_id: order.usuario?.id ?? null,
  }).select('*').single();
  if (error) throw error;

  const { productos } = await catalogo();
  const items = (order.items || []).map(i => ({
    pedido_id: ped.id,
    producto_id: resolveProductoId(i, productos),
    nombre: i.name,
    precio: i.price,
    cantidad: i.qty,
    es_combo: !!i.esCombo,
  }));
  await supa.from('pedido_items').insert(items);

  // Descontar inventario (ignora ítems sin producto_id / sin receta)
  await supa.rpc('descontar_inventario_pedido', {
    p_pedido_id: ped.id,
    p_usuario: order.usuario?.nombre || 'mesero',
    p_usuario_id: order.usuario?.id ?? null,
  });
  await refreshProductosAgotados();

  return mapOrder({ ...ped, pedido_items: items });
}

// ── Completar ──
// El filtro por estado 'pendiente' hace la operación atómica: si dos pantallas
// de cocina tocan "listo" a la vez, la segunda recibe null en vez de volver a
// completar un pedido ya cerrado (y de re-emitir el aviso al mesero).
async function completar(id) {
  const completadoEn = new Date().toISOString();
  const { data } = await supa.from('pedidos')
    .update({ estado: 'completado', completado_en: completadoEn })
    .eq('id', id).eq('estado', 'pendiente')
    .select(SELECT_PEDIDO).maybeSingle();
  return data ? mapOrder(data) : null;
}

// ── Editar pedido pendiente (reajusta inventario: devuelve y vuelve a descontar) ──
async function editar(id, fields) {
  const actual = await get(id);
  if (!actual) return null;
  const quien = fields.usuario;
  const o = { ...actual, ...fields };
  const { productos } = await catalogo();

  await supa.rpc('devolver_inventario_pedido', {
    p_pedido_id: id, p_usuario: quien?.nombre || 'mesero', p_usuario_id: quien?.id ?? null });
  await supa.from('pedidos').update({
    tipo: o.tipo, mesa: o.mesa, direccion: o.direccion, telefono: o.telefono,
    cliente_nombre: o.nombre, notas: o.notas,
    total: o.items.reduce((s, i) => s + i.price * i.qty, 0),
  }).eq('id', id);
  await supa.from('pedido_items').delete().eq('pedido_id', id);
  await supa.from('pedido_items').insert(o.items.map(i => ({
    pedido_id: id, producto_id: resolveProductoId(i, productos),
    nombre: i.name, precio: i.price, cantidad: i.qty, es_combo: !!i.esCombo,
  })));
  await supa.rpc('descontar_inventario_pedido', {
    p_pedido_id: id, p_usuario: quien?.nombre || 'mesero', p_usuario_id: quien?.id ?? null });
  await refreshProductosAgotados();
  return await get(id);
}

// ── Cancelar pedido pendiente (devuelve inventario) ──
async function remove(id, usuario) {
  await supa.rpc('devolver_inventario_pedido', {
    p_pedido_id: id, p_usuario: usuario?.nombre || 'mesero', p_usuario_id: usuario?.id ?? null });
  await supa.from('pedidos').update({ estado: 'cancelado' }).eq('id', id);
  await refreshProductosAgotados();
}

// ── Marcar facturado ──
async function marcarFacturado(id, { cufe, number }) {
  const { data } = await supa.from('pedidos')
    .update({ facturado: true, cufe, factura_num: number })
    .eq('id', id).select(SELECT_PEDIDO).maybeSingle();
  return data ? mapOrder(data) : null;
}

// ── Limpiar completados de la vista (no borra de la BD: quedan como histórico) ──
// Antes solo vaciaba el array en memoria, así que el "limpiar" duraba hasta el
// siguiente reinicio. Ahora los marca 'archivado': salen de la vista de cocina
// y del historial del día, pero la venta sigue en la BD para los reportes.
async function clearCompletados() {
  const { error } = await supa.from('pedidos')
    .update({ estado: 'archivado' }).eq('estado', 'completado');
  if (error) throw error;
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
  return await productGet(data.id);
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
  return await productGet(data.id);
}
async function productDelete(id) {
  await supa.from('productos').delete().eq('id', id);
}

// categoria por nombre → id (crea la categoría si no existe)
async function categoriaId(nombre) {
  if (!nombre) return null;
  const { data: existe } = await supa.from('categorias')
    .select('id').eq('nombre', nombre).maybeSingle();
  if (existe) return existe.id;
  const { data } = await supa.from('categorias').insert({ nombre }).select('id').single();
  return data ? data.id : null;
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
    motivo: 'Entrada de stock',
    usuario: usuario?.nombre || String(usuario || 'admin'),
    usuario_id: usuario?.id ?? null,
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

// ── Usuarios (una cuenta por persona) ──
// El PIN nunca sale de aquí: se guarda con hash y solo se compara.
const bcrypt = require('bcryptjs');

// Lista mínima para pintar el login: sin hash, sin nada sensible.
async function usuariosActivos() {
  const { data } = await supa.from('usuarios')
    .select('id,nombre,rol').eq('activo', true).order('rol').order('nombre');
  return data || [];
}

async function usuarios() {
  const { data } = await supa.from('usuarios')
    .select('id,nombre,rol,activo,creado_en').order('rol').order('nombre');
  return data || [];
}

// Devuelve el usuario si el PIN es correcto; null si no.
async function verificarPin(usuarioId, pin) {
  const { data: u } = await supa.from('usuarios')
    .select('id,nombre,rol,activo,pin_hash').eq('id', usuarioId).maybeSingle();
  if (!u || !u.activo) return null;
  if (!bcrypt.compareSync(String(pin || ''), u.pin_hash)) return null;
  return { id: u.id, nombre: u.nombre, rol: u.rol };
}

// Login normal: usuario y contraseña.
//
// El "usuario" es el nombre de la persona, que ya era único sin importar
// mayúsculas (índice en sql/03_usuarios.sql), así que no hizo falta una
// columna nueva ni otra migración. El rol sale de la cuenta: no se elige al
// entrar, y por eso nadie termina en una pantalla que no le toca.
async function verificarCredenciales(usuario, password) {
  const nombre = String(usuario || '').trim();
  const clave = String(password || '');
  if (!nombre || !clave) return null;

  const { data: u } = await supa.from('usuarios')
    .select('id,nombre,rol,activo,pin_hash')
    .ilike('nombre', nombre)          // sin distinguir mayúsculas
    .maybeSingle();

  if (!u || !u.activo) return null;
  if (!bcrypt.compareSync(clave, u.pin_hash)) return null;
  return { id: u.id, nombre: u.nombre, rol: u.rol };
}

async function usuarioAdd({ nombre, rol, pin }) {
  const { data, error } = await supa.from('usuarios').insert({
    nombre, rol, pin_hash: bcrypt.hashSync(String(pin), 10), activo: true,
  }).select('id,nombre,rol,activo').single();
  if (error) throw error;
  return data;
}

async function usuarioUpdate(id, fields) {
  const patch = {};
  if (fields.nombre !== undefined) patch.nombre = String(fields.nombre).trim();
  if (fields.rol    !== undefined) patch.rol = fields.rol;
  if (fields.activo !== undefined) patch.activo = !!fields.activo;
  // El PIN solo se toca si mandan uno nuevo — nunca se devuelve ni se registra.
  if (fields.pin) patch.pin_hash = bcrypt.hashSync(String(fields.pin), 10);
  const { data, error } = await supa.from('usuarios')
    .update(patch).eq('id', id).select('id,nombre,rol,activo').single();
  if (error) throw error;
  return data;
}

// ── Imágenes de productos (Supabase Storage, bucket público "productos") ──
// Ojo: `sharp` se quitó a propósito del proyecto (rompía en Linux) — no
// re-agregarlo. El tamaño se limita en el endpoint con los límites de multer.
const BUCKET_IMG = 'productos';

async function uploadImagen(buffer, filename, mime) {
  const ext = (filename.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
  const base = filename.replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sin tildes
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40) || 'imagen';
  // Nombre único: si se vuelve a subir la misma foto no pisa la anterior
  const path = `${base}-${Date.now().toString(36)}${ext}`;

  const { error } = await supa.storage.from(BUCKET_IMG)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) throw error;

  const { data } = supa.storage.from(BUCKET_IMG).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

// ── Recetas (qué insumos consume cada producto) ──
async function recetas() {
  const { data, error } = await supa.from('recetas').select('producto_id,insumo_id,cantidad');
  if (error) throw error;
  return data || [];
}

// Reemplaza la receta completa de un producto.
// items: [{ insumo_id, cantidad }]  ·  lista vacía = producto sin receta
async function recetaSet(productoId, items) {
  const filas = (items || [])
    .map(it => ({
      producto_id: productoId,
      insumo_id: Number(it.insumo_id),
      cantidad: Number(it.cantidad),
    }))
    .filter(f => f.insumo_id > 0 && f.cantidad > 0);

  // Un insumo no puede ir dos veces en la misma receta (unique en la tabla)
  const vistos = new Set();
  for (const f of filas) {
    if (vistos.has(f.insumo_id)) throw new Error('Hay un insumo repetido en la receta');
    vistos.add(f.insumo_id);
  }

  const { error: eDel } = await supa.from('recetas').delete().eq('producto_id', productoId);
  if (eDel) throw eDel;
  if (filas.length) {
    const { error: eIns } = await supa.from('recetas').insert(filas);
    if (eIns) throw eIns;
  }
  await refreshProductosAgotados();
  return filas;
}

// Recalcula el flag "agotado" de los productos tras cambios de stock.
// El resultado queda en la BD, que es de donde lo lee todo el mundo.
async function refreshProductosAgotados() {
  await supa.rpc('recalcular_agotados');
}


// ── Fidelización: tarjeta de sellos ────────────────────────────
// Los clientes viven aparte del personal (ver sql/05_fidelizacion.sql).

// Las reglas del programa las manda la fila de config, no el código: el
// restaurante cambia la promoción sin desplegar nada.
async function reglasFidelizacion() {
  const { data, error } = await supa.from('config')
    .select('sellos_por_premio, sellos_por_compra, premio_descripcion, fidelizacion_activa')
    .eq('id', 1).single();
  if (error) throw error;
  return data;
}

// El saldo lo calcula la BD (función sellos_disponibles): sumar en el
// servidor obligaría a traerse todo el historial de la persona.
async function clienteSaldo(clienteId) {
  const { data, error } = await supa.rpc('sellos_disponibles', { p_cliente_id: clienteId });
  if (error) throw error;
  return data ?? 0;
}

async function clientes() {
  const { data, error } = await supa.from('clientes')
    .select('*').order('creado_en', { ascending: false });
  if (error) throw error;
  // Un RPC por cliente sería una consulta por fila. Se traen los movimientos
  // de una vez y se cuadra el saldo aquí.
  const [{ data: s }, { data: c }] = await Promise.all([
    supa.from('sellos').select('cliente_id, cantidad'),
    supa.from('canjes').select('cliente_id, sellos_usados'),
  ]);
  const saldo = new Map();
  for (const r of s || []) saldo.set(r.cliente_id, (saldo.get(r.cliente_id) || 0) + r.cantidad);
  for (const r of c || []) saldo.set(r.cliente_id, (saldo.get(r.cliente_id) || 0) - r.sellos_usados);
  return (data || []).map(cl => ({ ...cl, sellos: saldo.get(cl.id) || 0 }));
}

async function clientePorCodigo(codigo) {
  const { data, error } = await supa.from('clientes')
    .select('*').eq('codigo', normalizarCodigo(codigo)).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function clientePorTelefono(telefono) {
  const { data, error } = await supa.from('clientes')
    .select('*').eq('telefono', normalizarTelefono(telefono)).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function clienteAdd({ nombre, telefono, email = '', autoriza_datos = false }) {
  // Reintento por si el código aleatorio choca con uno existente. Con 3.8e11
  // combinaciones es rarísimo, pero el unique de la tabla lo haría fallar y
  // el cliente vería un error sin ninguna culpa suya.
  for (let intento = 0; intento < 5; intento++) {
    const { data, error } = await supa.from('clientes').insert({
      codigo: nuevoCodigo(),
      nombre: String(nombre || '').trim(),
      telefono: normalizarTelefono(telefono),
      email: String(email || '').trim(),
      autoriza_datos: !!autoriza_datos,
      autorizado_en: autoriza_datos ? new Date().toISOString() : null,
    }).select().single();
    if (!error) return data;
    // 23505 en `codigo` es choque de código; en `telefono` es que la persona
    // ya está registrada, y eso sí hay que reportarlo.
    if (error.code === '23505' && /codigo/.test(error.message || '')) continue;
    throw error;
  }
  throw new Error('No se pudo generar un código de tarjeta libre');
}

async function clienteUpdate(id, fields) {
  const patch = {};
  for (const k of ['nombre', 'email', 'activo']) if (k in fields) patch[k] = fields[k];
  if ('telefono' in fields) patch.telefono = normalizarTelefono(fields.telefono);
  const { data, error } = await supa.from('clientes')
    .update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Historial visible en la tarjeta: cuándo ganó cada sello y cuándo canjeó.
async function clienteHistorial(clienteId) {
  const [{ data: s }, { data: c }] = await Promise.all([
    supa.from('sellos').select('*').eq('cliente_id', clienteId).order('creado_en', { ascending: false }).limit(50),
    supa.from('canjes').select('*').eq('cliente_id', clienteId).order('creado_en', { ascending: false }).limit(50),
  ]);
  return [
    ...(s || []).map(r => ({ tipo: 'sello', cantidad: r.cantidad, pedido_id: r.pedido_id, usuario: r.usuario, fecha: r.creado_en })),
    ...(c || []).map(r => ({ tipo: 'canje', cantidad: r.sellos_usados, premio: r.premio, pedido_id: r.pedido_id, usuario: r.usuario, fecha: r.creado_en })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function selloDar({ clienteId, pedidoId = null, cantidad = 1, usuarioId = null, usuario = '' }) {
  const { data, error } = await supa.from('sellos').insert({
    cliente_id: clienteId, pedido_id: pedidoId, cantidad,
    usuario_id: usuarioId, usuario,
  }).select().single();
  // El índice único sobre pedido_id es lo que impide sellar dos veces el mismo
  // pedido: el doble clic del mesero llega aquí y rebota.
  if (error) throw error;
  return data;
}

async function canjear({ clienteId, pedidoId = null, usuarioId = null, usuario = '' }) {
  // La comprobación de saldo y la escritura van juntas dentro de la función
  // SQL: hacerlas por separado dejaría entregar dos premios con los sellos
  // de uno si dos meseros canjean a la vez.
  const { data, error } = await supa.rpc('canjear_premio', {
    p_cliente_id: clienteId, p_pedido_id: pedidoId,
    p_usuario_id: usuarioId, p_usuario: usuario,
  });
  if (error) throw error;
  return { restantes: data ?? 0 };
}

module.exports = {
  init,
  // Lecturas (async: van a la BD, no a memoria)
  all, pendientes, completados, get, products, productGet,
  // Escrituras
  add, completar, editar, remove, marcarFacturado, clearCompletados,
  productAdd, productUpdate, productDelete,
  // Inventario
  insumos, insumoAdd, insumoEntrada, insumoUpdate, movimientos, alertas,
  // Recetas
  recetas, recetaSet,
  // Imágenes
  uploadImagen,
  // Usuarios
  usuariosActivos, usuarios, verificarPin, verificarCredenciales,
  usuarioAdd, usuarioUpdate,
  // Fidelización
  reglasFidelizacion, clientes, clientePorCodigo, clientePorTelefono,
  clienteAdd, clienteUpdate, clienteSaldo, clienteHistorial, selloDar, canjear,
  // Compatibilidad: el catálogo ahora vive en la BD, no se siembra desde el código
  ensureCatalog: () => {},
  save: () => {},
};
