// ─────────────────────────────────────────────────────────────
//  Capa de datos (patrón repositorio)
//  Hoy: persiste en un archivo JSON local (cero configuración).
//  Mañana: se reemplaza esta implementación por Postgres (driver pg)
//  manteniendo la MISMA interfaz, sin tocar server.js.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

let _data = { orders: [], nextId: 1, products: [], nextProductId: 1 };
let _timer = null;

function _load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    _data = JSON.parse(raw);
    if (!Array.isArray(_data.orders)) _data.orders = [];
    if (!_data.nextId) {
      _data.nextId = _data.orders.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    }
    if (!Array.isArray(_data.products)) _data.products = [];
    if (!_data.nextProductId) {
      _data.nextProductId = _data.products.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    }
    console.log(`💾 Datos cargados: ${_data.orders.length} pedidos, ${_data.products.length} productos`);
  } catch {
    _data = { orders: [], nextId: 1, products: [], nextProductId: 1 };
    console.log('💾 Sin datos previos: empezando en limpio');
  }
}

// Guardado con pequeño debounce para no escribir en cada micro-cambio
function save() {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(_data, null, 2));
    } catch (e) {
      console.error('⚠️  Error guardando datos:', e.message);
    }
  }, 150);
}

_load();

module.exports = {
  // Lecturas
  all:         () => _data.orders,
  pendientes:  () => _data.orders.filter(o => o.status === 'pendiente'),
  completados: () => _data.orders.filter(o => o.status === 'completado'),
  get:         (id) => _data.orders.find(o => o.id === id),

  // Escrituras
  add: (order) => {            // asigna id, guarda y devuelve el pedido
    order.id = _data.nextId++;
    _data.orders.push(order);
    save();
    return order;
  },
  clearCompletados: () => {
    _data.orders = _data.orders.filter(o => o.status === 'pendiente');
    save();
  },
  remove: (id) => { _data.orders = _data.orders.filter(o => o.id !== id); save(); },

  // ── Productos (catálogo del menú) ──
  products:      () => _data.products,
  productGet:    (id) => _data.products.find(p => p.id === id),
  productAdd:    (p) => { p.id = _data.nextProductId++; _data.products.push(p); save(); return p; },
  productDelete: (id) => { _data.products = _data.products.filter(p => p.id !== id); save(); },
  // Siembra/actualiza el catálogo cuando cambia la versión (reemplaza el set completo)
  ensureCatalog: (list, version) => {
    if (_data.catalogVersion === version) return;
    _data.nextProductId = 1;
    _data.products = list.map(p => ({ ...p, id: _data.nextProductId++ }));
    _data.catalogVersion = version;
    save();
  },

  save,                        // llamar tras mutar un pedido/producto en sitio
};
