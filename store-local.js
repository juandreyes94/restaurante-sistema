// ─────────────────────────────────────────────────────────────
//  Motor de datos LOCAL (modo demo / navegación sin Supabase).
//  Implementa la MISMA interfaz que store-supabase.js pero
//  persiste en data/db.json. Sirve para ver cómo se navega el
//  sistema con los datos reales del negocio, sin credenciales.
//  Para usarlo: STORE=local (server.js lo elige por esa variable).
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { nuevoCodigo, normalizarCodigo, normalizarTelefono } = require('./codigo-cliente');

const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const IMG_DIR   = path.join(__dirname, 'src', 'img');

let _data = {
  orders: [], nextId: 1, products: [], nextProductId: 1,
  insumos: [], nextInsumoId: 1, recetas: [], movimientos: [],
  usuarios: [], nextUsuarioId: 1,
  clientes: [], nextClienteId: 1, sellos: [], nextSelloId: 1, canjes: [], nextCanjeId: 1,
  config: null,
};
let _timer = null;

function _load() {
  try {
    _data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { /* empieza en limpio */ }
  _data.orders        = Array.isArray(_data.orders) ? _data.orders : [];
  _data.products      = Array.isArray(_data.products) ? _data.products : [];
  _data.insumos       = Array.isArray(_data.insumos) ? _data.insumos : [];
  _data.recetas       = Array.isArray(_data.recetas) ? _data.recetas : [];
  _data.movimientos   = Array.isArray(_data.movimientos) ? _data.movimientos : [];
  _data.nextId        = _data.nextId        || _data.orders.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1;
  _data.nextProductId = _data.nextProductId || _data.products.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
  _data.nextInsumoId  = _data.nextInsumoId  || _data.insumos.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;
  _data.usuarios      = Array.isArray(_data.usuarios) ? _data.usuarios : [];
  _data.nextUsuarioId = _data.nextUsuarioId || _data.usuarios.reduce((m, u) => Math.max(m, u.id || 0), 0) + 1;
  _data.clientes      = Array.isArray(_data.clientes) ? _data.clientes : [];
  _data.sellos        = Array.isArray(_data.sellos) ? _data.sellos : [];
  _data.canjes        = Array.isArray(_data.canjes) ? _data.canjes : [];
  _data.nextClienteId = _data.nextClienteId || _data.clientes.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
  _data.nextSelloId   = _data.nextSelloId   || _data.sellos.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
  _data.nextCanjeId   = _data.nextCanjeId   || _data.canjes.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
  // Las mismas reglas por defecto que siembra sql/05_fidelizacion.sql.
  _data.config = { sellos_por_premio: 10, sellos_por_compra: 1,
                   premio_descripcion: 'Un producto gratis', fidelizacion_activa: true,
                   ..._data.config };
  _seedInsumos();
  _seedUsuarios();
}

// Mismo equipo y mismas claves que siembra scripts/crear-usuarios.js contra
// Supabase, para que entrar en modo local sea idéntico a entrar en el real.
function _seedUsuarios() {
  if (_data.usuarios.length) return;
  [
    { nombre: 'Administrador', rol: 'admin',  pin: '9876' },
    { nombre: 'Cocina',        rol: 'cocina', pin: '1234' },
    { nombre: 'Mesero',        rol: 'mesero', pin: '5678' },
  ].forEach(u => _data.usuarios.push({
    id: _data.nextUsuarioId++, nombre: u.nombre, rol: u.rol,
    pin_hash: bcrypt.hashSync(u.pin, 10), activo: true,
    creado_en: new Date().toISOString(),
  }));
}

// Siembra un inventario de muestra la primera vez, para que la pantalla
// de Inventario y las alertas tengan contenido navegable.
function _seedInsumos() {
  if (_data.insumos.length) return;
  const base = [
    ['Pan de perro',      'unidad', 120, 40],
    ['Pan de hamburguesa','unidad', 80,  30],
    ['Carne de res 150g', 'unidad', 60,  25],
    ['Pollo desmechado',  'gramo',  4000, 1500],
    ['Panceta',           'gramo',  1200, 1500],   // por debajo del mínimo → alerta
    ['Queso cuajada',     'gramo',  3000, 1000],
    ['Papa a la francesa','gramo',  8000, 3000],
    ['Salsa de la casa',  'ml',     900, 1000],    // por debajo del mínimo → alerta
    ['Gaseosa 400ml',     'unidad', 48,  24],
    ['Maicitos',          'gramo',  2500, 800],
  ];
  _data.insumos = base.map(([nombre, unidad, stock, stock_min]) => ({
    id: _data.nextInsumoId++, nombre, unidad, stock, stock_min,
    costo_unitario: 0, activo: true,
  }));
}

function save() {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(_data, null, 2));
    } catch (e) { console.error('⚠️  Error guardando:', e.message); }
  }, 150);
}

// El frontend espera productos con categoria (texto) + estos campos.
function mapProducto(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria || '',
    categoria_id: p.categoria || null,
    descripcion: p.descripcion || '',
    precio: p.precio,
    precioCombo: p.precioCombo,
    imagen: p.imagen || '',
    emoji: p.emoji || '',
    disponible: p.disponible !== false && !p.agotado,
    agotado: !!p.agotado,
    promo: p.promo || '',
    orden: p.orden,
  };
}

async function init() {
  _load();
  console.log(`💾 LOCAL: ${_data.products.length} productos, ${_data.orders.length} pedidos, ${_data.insumos.length} insumos`);
}

// ── Pedidos ──
async function add(order) {
  order.id = _data.nextId++;
  if (order.timestamp == null) order.timestamp = Date.now();
  _data.orders.push(order);
  save();
  return order;
}
async function completar(id) {
  const o = _data.orders.find(o => o.id === id);
  if (!o) return null;
  o.status = 'completado';
  o.completedAt = Date.now();
  save();
  return o;
}
async function editar(id, fields) {
  const o = _data.orders.find(o => o.id === id);
  if (!o) return null;
  Object.assign(o, fields, { editedAt: Date.now() });
  save();
  return o;
}
async function remove(id) {
  _data.orders = _data.orders.filter(o => o.id !== id);
  save();
}
async function marcarFacturado(id, { cufe, number } = {}) {
  const o = _data.orders.find(o => o.id === id);
  if (o) { o.facturado = true; o.cufe = cufe; o.facturaNum = number; save(); }
  return o;
}
async function clearCompletados() {
  _data.orders = _data.orders.filter(o => o.status === 'pendiente');
  save();
}

// ── Productos ──
async function productAdd(p) {
  const np = { ...p, id: _data.nextProductId++ };
  _data.products.push(np);
  save();
  return mapProducto(np);
}
async function productUpdate(id, fields) {
  const p = _data.products.find(p => p.id === id);
  if (!p) throw new Error('Producto no encontrado');
  if (fields.nombre       !== undefined) p.nombre = fields.nombre;
  if (fields.categoria    !== undefined) p.categoria = fields.categoria;
  if (fields.descripcion  !== undefined) p.descripcion = fields.descripcion;
  if (fields.precio       !== undefined) p.precio = fields.precio;
  if (fields.precioCombo  !== undefined) p.precioCombo = fields.precioCombo;
  if (fields.imagen       !== undefined) p.imagen = fields.imagen;
  if (fields.emoji        !== undefined) p.emoji = fields.emoji;
  if (fields.disponible   !== undefined) p.disponible = !!fields.disponible;
  save();
  return mapProducto(p);
}
async function productDelete(id) {
  _data.products = _data.products.filter(p => p.id !== id);
  _data.recetas  = _data.recetas.filter(r => r.producto_id !== id);
  save();
}

// ── Inventario ──
async function insumos() {
  return _data.insumos.filter(i => i.activo !== false)
    .slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
}
async function insumoAdd(p) {
  const ins = {
    id: _data.nextInsumoId++, nombre: p.nombre, unidad: p.unidad || 'unidad',
    stock: Number(p.stock) || 0, stock_min: Number(p.stock_min) || 0,
    costo_unitario: 0, activo: true,
  };
  _data.insumos.push(ins);
  save();
  return ins;
}
async function insumoEntrada(id, cantidad, usuario = 'admin') {
  const ins = _data.insumos.find(i => i.id === id);
  if (!ins) throw new Error('Insumo no encontrado');
  ins.stock = Number(ins.stock) + Number(cantidad);
  _data.movimientos.push({
    id: (_data.movimientos.at(-1)?.id || 0) + 1, insumo_id: id, tipo: 'entrada',
    cantidad: Number(cantidad), stock_resultante: ins.stock,
    motivo: 'Entrada de stock', usuario, creado_en: new Date().toISOString(),
  });
  save();
  return ins.stock;
}
async function insumoUpdate(id, fields) {
  const ins = _data.insumos.find(i => i.id === id);
  if (!ins) throw new Error('Insumo no encontrado');
  ['nombre', 'unidad', 'stock', 'stock_min', 'costo_unitario', 'activo'].forEach(k => {
    if (fields[k] !== undefined) ins[k] = fields[k];
  });
  save();
  return ins;
}
async function movimientos(insumoId) {
  let m = _data.movimientos.slice().reverse();
  if (insumoId) m = m.filter(x => x.insumo_id === insumoId);
  return m.slice(0, 200);
}
async function alertas() {
  return _data.insumos.filter(i => i.activo !== false && Number(i.stock) <= Number(i.stock_min));
}

// ── Recetas ──
async function recetas() {
  return _data.recetas.map(r => ({
    producto_id: r.producto_id, insumo_id: r.insumo_id, cantidad: r.cantidad,
  }));
}
async function recetaSet(productoId, items) {
  const filas = (items || [])
    .map(it => ({ producto_id: productoId, insumo_id: Number(it.insumo_id), cantidad: Number(it.cantidad) }))
    .filter(f => f.insumo_id > 0 && f.cantidad > 0);
  const vistos = new Set();
  for (const f of filas) {
    if (vistos.has(f.insumo_id)) throw new Error('Hay un insumo repetido en la receta');
    vistos.add(f.insumo_id);
  }
  _data.recetas = _data.recetas.filter(r => r.producto_id !== productoId).concat(filas);
  save();
  return filas;
}

// ── Usuarios ──
// Misma interfaz que store-supabase: el hash nunca sale de aquí y el nombre es
// único sin distinguir mayúsculas. El duplicado se lanza con el code '23505'
// (el de Postgres) porque server.js lo traduce al mensaje que ve el usuario.
const _sinHash = (u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo, creado_en: u.creado_en });
const _porOrden = (a, b) => a.rol.localeCompare(b.rol) || a.nombre.localeCompare(b.nombre);

function _nombreOcupado(nombre, exceptoId) {
  const n = String(nombre).trim().toLowerCase();
  return _data.usuarios.some(u => u.nombre.toLowerCase() === n && u.id !== exceptoId);
}
function _errorDuplicado() {
  const e = new Error('Ya existe un usuario con ese nombre');
  e.code = '23505';
  return e;
}

async function usuariosActivos() {
  return _data.usuarios.filter(u => u.activo).sort(_porOrden)
    .map(u => ({ id: u.id, nombre: u.nombre, rol: u.rol }));
}
async function usuarios() {
  return _data.usuarios.slice().sort(_porOrden).map(_sinHash);
}
async function verificarPin(usuarioId, pin) {
  const u = _data.usuarios.find(u => u.id === Number(usuarioId));
  if (!u || !u.activo) return null;
  if (!bcrypt.compareSync(String(pin || ''), u.pin_hash)) return null;
  return { id: u.id, nombre: u.nombre, rol: u.rol };
}
async function verificarCredenciales(usuario, password) {
  const nombre = String(usuario || '').trim().toLowerCase();
  const clave = String(password || '');
  if (!nombre || !clave) return null;
  const u = _data.usuarios.find(u => u.nombre.toLowerCase() === nombre);
  if (!u || !u.activo) return null;
  if (!bcrypt.compareSync(clave, u.pin_hash)) return null;
  return { id: u.id, nombre: u.nombre, rol: u.rol };
}
async function usuarioAdd({ nombre, rol, pin }) {
  if (_nombreOcupado(nombre)) throw _errorDuplicado();
  const u = {
    id: _data.nextUsuarioId++, nombre: String(nombre).trim(), rol,
    pin_hash: bcrypt.hashSync(String(pin), 10), activo: true,
    creado_en: new Date().toISOString(),
  };
  _data.usuarios.push(u);
  save();
  return _sinHash(u);
}
async function usuarioUpdate(id, fields) {
  const u = _data.usuarios.find(u => u.id === Number(id));
  if (!u) throw new Error('Usuario no encontrado');
  if (fields.nombre !== undefined) {
    if (_nombreOcupado(fields.nombre, u.id)) throw _errorDuplicado();
    u.nombre = String(fields.nombre).trim();
  }
  if (fields.rol    !== undefined) u.rol = fields.rol;
  if (fields.activo !== undefined) u.activo = !!fields.activo;
  if (fields.pin) u.pin_hash = bcrypt.hashSync(String(fields.pin), 10);
  save();
  return _sinHash(u);
}

// ── Imágenes (guardadas en src/img, servidas como estáticas) ──
async function uploadImagen(buffer, filename, mime) {
  const ext = (filename.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
  const base = filename.replace(/\.[^.]+$/, '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'imagen';
  const nombre = `${base}-${Date.now().toString(36)}${ext}`;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(IMG_DIR, nombre), buffer);
  const ruta = `img/${nombre}`;
  return { path: ruta, url: `/${ruta}` };
}


// ── Fidelización: tarjeta de sellos ────────────────────────────
// Mismo contrato que store-supabase. Lo que allá resuelven un unique y una
// función SQL, aquí se comprueba a mano: es un solo proceso, así que no hay
// dos escrituras compitiendo, pero las reglas tienen que ser las mismas o el
// modo local mentiría sobre cómo se comporta el sistema real.

async function reglasFidelizacion() {
  return { ..._data.config };
}

function _saldo(clienteId) {
  const ganados = _data.sellos.filter(s => s.cliente_id === clienteId)
    .reduce((t, s) => t + s.cantidad, 0);
  const usados = _data.canjes.filter(c => c.cliente_id === clienteId)
    .reduce((t, c) => t + c.sellos_usados, 0);
  return ganados - usados;
}

async function clienteSaldo(clienteId) { return _saldo(clienteId); }

async function clientes() {
  return _data.clientes
    .map(c => ({ ...c, sellos: _saldo(c.id) }))
    .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
}

async function clientePorCodigo(codigo) {
  const cod = normalizarCodigo(codigo);
  return _data.clientes.find(c => c.codigo === cod) || null;
}

async function clientePorTelefono(telefono) {
  const tel = normalizarTelefono(telefono);
  return _data.clientes.find(c => c.telefono === tel) || null;
}

async function clienteAdd({ nombre, telefono, email = '', autoriza_datos = false }) {
  const tel = normalizarTelefono(telefono);
  // Mismo code '23505' que devolvería Postgres: server.js lo traduce al
  // mensaje que ve el cliente, y no debería tener que saber qué motor corre.
  if (_data.clientes.some(c => c.telefono === tel)) {
    const e = new Error('Ese teléfono ya está registrado');
    e.code = '23505';
    throw e;
  }
  let codigo;
  do { codigo = nuevoCodigo(); } while (_data.clientes.some(c => c.codigo === codigo));
  const cliente = {
    id: _data.nextClienteId++,
    codigo,
    nombre: String(nombre || '').trim(),
    telefono: tel,
    email: String(email || '').trim(),
    autoriza_datos: !!autoriza_datos,
    autorizado_en: autoriza_datos ? new Date().toISOString() : null,
    activo: true,
    creado_en: new Date().toISOString(),
  };
  _data.clientes.push(cliente);
  save();
  return cliente;
}

async function clienteUpdate(id, fields) {
  const c = _data.clientes.find(x => x.id === id);
  if (!c) throw new Error('Cliente no encontrado');
  if ('telefono' in fields) {
    const tel = normalizarTelefono(fields.telefono);
    if (_data.clientes.some(x => x.telefono === tel && x.id !== id)) {
      const e = new Error('Ese teléfono ya está registrado');
      e.code = '23505';
      throw e;
    }
    c.telefono = tel;
  }
  for (const k of ['nombre', 'email', 'activo']) if (k in fields) c[k] = fields[k];
  save();
  return c;
}

async function clienteHistorial(clienteId) {
  return [
    ..._data.sellos.filter(s => s.cliente_id === clienteId)
      .map(s => ({ tipo: 'sello', cantidad: s.cantidad, pedido_id: s.pedido_id, usuario: s.usuario, fecha: s.creado_en })),
    ..._data.canjes.filter(c => c.cliente_id === clienteId)
      .map(c => ({ tipo: 'canje', cantidad: c.sellos_usados, premio: c.premio, pedido_id: c.pedido_id, usuario: c.usuario, fecha: c.creado_en })),
  ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 100);
}

async function selloDar({ clienteId, pedidoId = null, cantidad = 1, usuarioId = null, usuario = '' }) {
  // El equivalente del índice único de Postgres sobre pedido_id: un pedido
  // no sella dos veces, aunque el mesero toque el botón dos veces.
  if (pedidoId != null && _data.sellos.some(s => s.pedido_id === pedidoId)) {
    const e = new Error('Ese pedido ya tiene sello');
    e.code = '23505';
    throw e;
  }
  const sello = {
    id: _data.nextSelloId++, cliente_id: clienteId, pedido_id: pedidoId,
    cantidad, usuario_id: usuarioId, usuario, creado_en: new Date().toISOString(),
  };
  _data.sellos.push(sello);
  save();
  return sello;
}

async function canjear({ clienteId, pedidoId = null, usuarioId = null, usuario = '' }) {
  const necesarios = _data.config.sellos_por_premio;
  const saldo = _saldo(clienteId);
  if (saldo < necesarios) {
    const e = new Error(`Sellos insuficientes: tiene ${saldo}, necesita ${necesarios}`);
    e.code = 'P0001';
    throw e;
  }
  _data.canjes.push({
    id: _data.nextCanjeId++, cliente_id: clienteId, pedido_id: pedidoId,
    sellos_usados: necesarios, premio: _data.config.premio_descripcion,
    usuario_id: usuarioId, usuario, creado_en: new Date().toISOString(),
  });
  save();
  return { restantes: saldo - necesarios };
}

module.exports = {
  init,
  all:         () => _data.orders,
  pendientes:  () => _data.orders.filter(o => o.status === 'pendiente'),
  completados: () => _data.orders.filter(o => o.status === 'completado'),
  get:         (id) => _data.orders.find(o => o.id === id),
  products:    () => _data.products.map(mapProducto),
  productGet:  (id) => { const p = _data.products.find(p => p.id === id); return p ? mapProducto(p) : undefined; },
  add, completar, editar, remove, marcarFacturado, clearCompletados,
  productAdd, productUpdate, productDelete,
  insumos, insumoAdd, insumoEntrada, insumoUpdate, movimientos, alertas,
  recetas, recetaSet,
  usuariosActivos, usuarios, verificarPin, verificarCredenciales,
  usuarioAdd, usuarioUpdate,
  reglasFidelizacion, clientes, clientePorCodigo, clientePorTelefono,
  clienteAdd, clienteUpdate, clienteSaldo, clienteHistorial, selloDar, canjear,
  uploadImagen,
  ensureCatalog: () => {},
  save,
};
