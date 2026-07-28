// ─────────────────────────────────────────────────────────────
//  Carga el inventario y las recetas de Coraje desde el Excel.
//
//  Uso:
//    node scripts/cargar-inventario.js --dry-run      (no escribe nada)
//    node scripts/cargar-inventario.js
//    node scripts/cargar-inventario.js --file "C:/ruta/archivo.xlsx"
//
//  Orden (importante): renombrar → dividir pan → crear/actualizar insumos
//  → reemplazar recetas → recalcular agotados.
//  Renombrar ANTES de crear evita duplicados y conserva las recetas viejas.
//
//  Es idempotente: correrlo dos veces deja el mismo estado.
// ─────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');

const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

// ── Argumentos ──
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run') || argv.includes('-n');
const fileIdx = argv.indexOf('--file');
const FILE = fileIdx >= 0 && argv[fileIdx + 1]
  ? argv[fileIdx + 1]
  : path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'coraje', 'inventario-coraje-carga-supabase.xlsx');

// ── Salida ──
const c = { g:'\x1b[32m', y:'\x1b[33m', r:'\x1b[31m', b:'\x1b[1m', d:'\x1b[2m', x:'\x1b[0m' };
const log  = (...a) => console.log(...a);
const paso = (n, t) => log(`\n${c.b}${c.y}▸ Paso ${n} — ${t}${c.x}`);
const ok   = (t) => log(`  ${c.g}✓${c.x} ${t}`);
const warn = (t) => log(`  ${c.y}!${c.x} ${t}`);
const skip = (t) => log(`  ${c.d}·${c.x} ${c.d}${t}${c.x}`);

// Nombres que la BD tenía antes → nombre en la foto. Debe coincidir con la
// hoja 'mapeo_nombres' del Excel (aquí va fijo porque es una migración única).
const RENOMBRAR = {
  'Carne premium':        'Carne Hamburguesa',
  'Panceta caramelizada': 'Panceta',
  'Carne desmechada':     'Carne Desmechada',
  'Chorizo artesanal':    'Chorizo',
  'Tocineta':             'Tocineta',
  'Salchicha estándar':   'Salchicha',
  'Salchicha ranchera':   'Salchicha Ranchera',
  'Papa a la francesa':   'Papas Francesa',
  'Queso philadelphia':   'Queso Philadelphia',
  'Queso americano':      'Queso Americano',
  'Queso mozzarella':     'Queso Mozzarella',
  'Queso asado':          'Queso Asado',
  'Queso cuajada':        'Queso Cuajada',
  'Huevos de codorniz':   'Huevos de Codorniz',
};
const PAN_VIEJO = 'Pan brioche';
const PAN_HAMB  = 'Pan Hamburguesa';
const PAN_PERRO = 'Pan Perro';

// ── Utilidades ──
const norm = (s) => String(s ?? '').trim();
const num  = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function leerHoja(wb, nombre) {
  const ws = wb.Sheets[nombre];
  if (!ws) throw new Error(`El Excel no tiene la hoja "${nombre}"`);
  // Las hojas traen título + subtítulo antes del encabezado: buscamos la fila
  // que empieza con la primera columna esperada y leemos desde ahí.
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const iHead = filas.findIndex(f => norm(f[0]).toLowerCase().startsWith('producto_nombre')
                                  || norm(f[0]).toLowerCase() === 'nombre');
  if (iHead < 0) throw new Error(`No encontré la fila de encabezado en la hoja "${nombre}"`);
  const head = filas[iHead].map(h => norm(h));
  return filas.slice(iHead + 1)
    .filter(f => norm(f[0]) && !norm(f[0]).startsWith('—'))   // ignora el separador
    .map(f => Object.fromEntries(head.map((h, i) => [h, f[i]])));
}

async function main() {
  log(`${c.b}Carga de inventario — Coraje Fast Food${c.x}`);
  log(`${c.d}Excel:    ${FILE}${c.x}`);
  log(`${c.d}Supabase: ${cfg.url}${c.x}`);
  if (DRY) log(`${c.y}${c.b}\n*** DRY-RUN: no se va a escribir nada en la base ***${c.x}`);

  if (!fs.existsSync(FILE)) {
    log(`\n${c.r}✗ No encuentro el Excel en:${c.x}\n  ${FILE}`);
    log(`${c.d}  Pásale la ruta con --file "C:/ruta/archivo.xlsx"${c.x}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(FILE);
  const filasIns = leerHoja(wb, 'insumos').filter(f => norm(f.nombre) && f.stock !== '' && f.stock != null);
  const filasRec = leerHoja(wb, 'recetas');
  log(`${c.d}Leídas ${filasIns.length} filas de insumos y ${filasRec.length} de recetas.${c.x}`);

  // Estado actual de la BD
  let { data: insDB, error: e0 } = await supa.from('insumos').select('id,nombre,unidad,stock,stock_min');
  if (e0) throw e0;
  const porNombre = () => new Map(insDB.map(i => [i.nombre, i]));

  // ── Paso 1: renombrar ────────────────────────────────────────
  paso(1, 'Renombrar insumos existentes (conservan id y recetas)');
  let nRen = 0;
  for (const [viejo, nuevo] of Object.entries(RENOMBRAR)) {
    const m = porNombre();
    const ins = m.get(viejo);
    if (!ins) { skip(`"${viejo}" no está en la BD (ya renombrado o nunca existió)`); continue; }
    if (viejo === nuevo) { skip(`"${viejo}" ya tiene el nombre correcto`); continue; }
    if (m.has(nuevo)) { warn(`"${nuevo}" ya existe — no se renombra "${viejo}" para no duplicar`); continue; }
    if (!DRY) {
      const { error } = await supa.from('insumos').update({ nombre: nuevo }).eq('id', ins.id);
      if (error) throw error;
    }
    ins.nombre = nuevo;
    ok(`${viejo} → ${nuevo}`);
    nRen++;
  }

  // ── Paso 2: dividir el pan ───────────────────────────────────
  paso(2, 'Dividir "Pan brioche" en Pan Hamburguesa + Pan Perro');
  {
    const m = porNombre();
    const viejo = m.get(PAN_VIEJO);
    if (viejo && !m.has(PAN_HAMB)) {
      if (!DRY) {
        const { error } = await supa.from('insumos').update({ nombre: PAN_HAMB }).eq('id', viejo.id);
        if (error) throw error;
      }
      viejo.nombre = PAN_HAMB;
      ok(`${PAN_VIEJO} → ${PAN_HAMB} (conserva sus recetas actuales)`);
    } else if (!viejo) {
      skip(`"${PAN_VIEJO}" no está en la BD (ya se dividió)`);
    } else {
      warn(`"${PAN_HAMB}" ya existe — se deja "${PAN_VIEJO}" como está`);
    }
    // Pan Perro se crea en el paso 3 como insumo nuevo, y las recetas de los
    // perros lo toman en el paso 4 (se reemplaza la receta completa).
    skip(`"${PAN_PERRO}" se crea en el paso 3 y lo toman los perros en el paso 4`);
  }

  // ── Paso 3: crear / actualizar insumos ───────────────────────
  paso(3, 'Crear insumos nuevos y actualizar unidad, stock y mínimo');
  let nNew = 0, nUpd = 0, nIgual = 0;
  for (const f of filasIns) {
    const nombre = norm(f.nombre);
    const patch = {
      unidad:    norm(f.unidad) || 'unidad',
      stock:     num(f.stock),
      stock_min: num(f.stock_min),
    };
    if (f.costo_unitario !== '' && f.costo_unitario != null) patch.costo_unitario = num(f.costo_unitario);
    const ins = porNombre().get(nombre);
    if (!ins) {
      if (!DRY) {
        const { data, error } = await supa.from('insumos').insert({ nombre, ...patch }).select('id,nombre,unidad,stock,stock_min').single();
        if (error) throw error;
        insDB.push(data);
      } else {
        insDB.push({ id: -1, nombre, ...patch });
      }
      ok(`nuevo · ${nombre} — ${patch.stock} ${patch.unidad} (mín ${patch.stock_min})`);
      nNew++;
    } else {
      const igual = ins.unidad === patch.unidad
        && num(ins.stock) === patch.stock && num(ins.stock_min) === patch.stock_min;
      if (igual) { nIgual++; continue; }
      if (!DRY) {
        const { error } = await supa.from('insumos').update(patch).eq('id', ins.id);
        if (error) throw error;
      }
      Object.assign(ins, patch);
      ok(`actualizado · ${nombre} — ${patch.stock} ${patch.unidad} (mín ${patch.stock_min})`);
      nUpd++;
    }
  }
  if (nIgual) skip(`${nIgual} insumo(s) ya estaban al día`);

  // ── Paso 4: reemplazar recetas ───────────────────────────────
  paso(4, 'Reemplazar las recetas de los productos del Excel');
  const { data: prods, error: e1 } = await supa.from('productos').select('id,nombre');
  if (e1) throw e1;
  const prodPorNombre = new Map((prods || []).map(p => [p.nombre, p.id]));
  const insPorNombre  = porNombre();

  // Agrupar filas por producto
  const porProducto = new Map();
  for (const f of filasRec) {
    const p = norm(f.producto_nombre), i = norm(f.insumo_nombre);
    if (!p || !i) continue;
    if (!porProducto.has(p)) porProducto.set(p, []);
    porProducto.get(p).push({ insumo: i, cantidad: num(f.cantidad) });
  }

  const faltanProd = [], faltanIns = new Set();
  let nRec = 0, nLineas = 0;
  for (const [prod, items] of porProducto) {
    const pid = prodPorNombre.get(prod);
    if (!pid) { faltanProd.push(prod); continue; }

    const filas = [];
    for (const it of items) {
      const ins = insPorNombre.get(it.insumo);
      if (!ins) { faltanIns.add(it.insumo); continue; }
      if (!(it.cantidad > 0)) { warn(`${prod} · ${it.insumo}: cantidad ${it.cantidad} — se omite`); continue; }
      filas.push({ producto_id: pid, insumo_id: ins.id, cantidad: it.cantidad });
    }
    if (!filas.length) { warn(`${prod}: ninguna línea válida — no se toca su receta`); continue; }

    if (!DRY) {
      // Reemplazo completo: borrar y volver a insertar (la tabla tiene
      // unique(producto_id, insumo_id), así no quedan sobras de la receta vieja)
      const { error: eDel } = await supa.from('recetas').delete().eq('producto_id', pid);
      if (eDel) throw eDel;
      const { error: eIns } = await supa.from('recetas').insert(filas);
      if (eIns) throw eIns;
    }
    ok(`${prod} — ${filas.length} insumo(s)`);
    nRec++; nLineas += filas.length;
  }
  if (faltanProd.length) {
    warn(`Productos del Excel que no existen en la BD (receta no cargada): ${faltanProd.join(', ')}`);
  }
  if (faltanIns.size) {
    warn(`Insumos referenciados en recetas que no existen: ${[...faltanIns].join(', ')}`);
  }

  // ── Paso 5: recalcular agotados ──────────────────────────────
  paso(5, 'Recalcular qué productos quedan agotados');
  if (!DRY) {
    const { error } = await supa.rpc('recalcular_agotados');
    if (error) throw error;
    const { data: ag } = await supa.from('productos').select('nombre').eq('agotado', true);
    ok(ag?.length ? `${ag.length} producto(s) agotado(s): ${ag.map(p => p.nombre).join(', ')}`
                  : 'Ningún producto queda agotado.');
  } else {
    skip('se omite en dry-run');
  }

  // ── Resumen ──────────────────────────────────────────────────
  log(`\n${c.b}${'─'.repeat(52)}${c.x}`);
  log(`${c.b}Resumen${c.x}`);
  log(`  Insumos renombrados: ${nRen}`);
  log(`  Insumos nuevos:      ${nNew}`);
  log(`  Insumos actualizados:${nUpd}`);
  log(`  Recetas cargadas:    ${nRec} producto(s), ${nLineas} línea(s)`);
  if (DRY) {
    log(`\n${c.y}${c.b}Nada de esto se escribió (dry-run).${c.x}`);
    log(`${c.d}Vuelve a correrlo sin --dry-run para aplicarlo.${c.x}`);
  } else {
    log(`\n${c.g}${c.b}✓ Listo.${c.x} Reinicia el servidor para que tome la caché nueva.`);
  }
}

main().catch(err => {
  console.error(`\n${c.r}✗ Falló la carga:${c.x}`, err.message || err);
  console.error(`${c.d}No se hicieron más cambios. Corrige y vuelve a correr (el script es idempotente).${c.x}`);
  process.exit(1);
});
