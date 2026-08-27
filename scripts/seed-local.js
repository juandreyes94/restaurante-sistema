// ─────────────────────────────────────────────────────────────
//  Siembra insumos y recetas en el motor LOCAL (data/db.json).
//
//  Es el equivalente de seed-insumos.js, que hace lo mismo contra Supabase, y
//  usa exactamente los mismos datos (scripts/datos-seed.js). Sirve para que
//  Admin → Inventario y la pantalla de Recetas tengan contenido real cuando se
//  trabaja con STORE=local.
//
//  Idempotente: no duplica insumos y reconstruye solo las recetas que puede
//  mapear. No toca pedidos, productos ni movimientos.
//
//  Uso: node scripts/seed-local.js
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { INSUMOS, RECETAS } = require('./datos-seed');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

// Inventario de muestra que sembraba store-local.js antes de existir este
// script. Son nombres inventados que no corresponden al negocio, así que
// estorban en la pantalla; se quitan salvo que ya tengan movimientos.
const MUESTRA = [
  'Pan de perro', 'Pan de hamburguesa', 'Carne de res 150g', 'Pollo desmechado',
  'Panceta', 'Salsa de la casa', 'Gaseosa 400ml', 'Maicitos',
];

// Si la base local no existe todavía, se crea vacía y el resto del script la
// llena. Borrar data/db.json para arrancar limpio es lo primero que uno hace,
// y antes eso dejaba este script reventando con un ENOENT.
if (!fs.existsSync(DATA_FILE)) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, '{}');
  console.log('   (base local nueva)');
}

const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
db.insumos     = Array.isArray(db.insumos) ? db.insumos : [];
db.recetas     = Array.isArray(db.recetas) ? db.recetas : [];
db.movimientos = Array.isArray(db.movimientos) ? db.movimientos : [];
db.nextInsumoId = db.nextInsumoId || db.insumos.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;

// 0) El catálogo, si la base viene vacía. Sale de sql/02_seed_productos.sql,
//    el mismo archivo que se corre contra Supabase, para que las dos bases
//    tengan exactamente los mismos 35 productos y las recetas de abajo
//    encuentren a qué plato pegarse.
db.products      = Array.isArray(db.products) ? db.products : [];
db.nextProductId = db.nextProductId || db.products.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
let productosNuevos = 0;
if (!db.products.length) {
  const { productos } = require('./productos-seed').leerCatalogo();
  for (const p of productos) {
    db.products.push({
      id: db.nextProductId++, nombre: p.nombre, categoria: p.categoria,
      descripcion: p.descripcion, precio: p.precio, precioCombo: p.precioCombo,
      imagen: p.imagen, emoji: p.emoji, orden: p.orden,
      disponible: true, agotado: false, promo: '',
    });
    productosNuevos++;
  }
}

// 1) Quitar la muestra que nadie haya tocado
const conMovimiento = new Set(db.movimientos.map(m => m.insumo_id));
const antes = db.insumos.length;
db.insumos = db.insumos.filter(i => !MUESTRA.includes(i.nombre) || conMovimiento.has(i.id));
const quitados = antes - db.insumos.length;

// 2) Insertar los que falten, sin pisar el stock de los que ya están
const porNombre = new Map(db.insumos.map(i => [i.nombre, i]));
let nuevos = 0;
for (const [nombre, unidad] of INSUMOS) {
  if (porNombre.has(nombre)) continue;
  const ins = {
    id: db.nextInsumoId++, nombre, unidad,
    stock: 10, stock_min: 3, costo_unitario: 0, activo: true,
  };
  db.insumos.push(ins);
  porNombre.set(nombre, ins);
  nuevos++;
}

// 3) Recetas — se mapean por nombre contra el catálogo que ya está en el db
const porProducto = new Map((db.products || []).map(p => [p.nombre, p.id]));
const filas = [];
const faltantes = new Set();
for (const [prod, items] of Object.entries(RECETAS)) {
  const pid = porProducto.get(prod);
  if (!pid) { faltantes.add(`producto: ${prod}`); continue; }
  for (const [ins, cant] of items) {
    const i = porNombre.get(ins);
    if (!i) { faltantes.add(`insumo: ${ins}`); continue; }
    filas.push({ producto_id: pid, insumo_id: i.id, cantidad: cant });
  }
}
// Se conservan las recetas de productos que este seed no cubre (las hechas a mano).
const cubiertos = new Set(filas.map(f => f.producto_id));
db.recetas = db.recetas.filter(r => !cubiertos.has(r.producto_id)).concat(filas);

fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

console.log(`\n✅ Inventario local sembrado`);
console.log(`   productos: ${db.products.length} (${productosNuevos} nuevos)`);
  console.log(`   insumos:  ${db.insumos.length} (${nuevos} nuevos, ${quitados} de muestra retirados)`);
console.log(`   recetas:  ${db.recetas.length} líneas · ${cubiertos.size} productos`);
if (faltantes.size) {
  console.log(`\n⚠️  Sin mapear (${faltantes.size}):`);
  [...faltantes].forEach(f => console.log(`   · ${f}`));
}
console.log('');
