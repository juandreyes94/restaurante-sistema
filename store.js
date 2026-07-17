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

let _data = { orders: [], nextId: 1 };
let _timer = null;

function _load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    _data = JSON.parse(raw);
    if (!Array.isArray(_data.orders)) _data.orders = [];
    if (!_data.nextId) {
      _data.nextId = _data.orders.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    }
    console.log(`💾 Datos cargados: ${_data.orders.length} pedidos (id siguiente ${_data.nextId})`);
  } catch {
    _data = { orders: [], nextId: 1 };
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
  save,                        // llamar tras mutar un pedido en sitio
};
