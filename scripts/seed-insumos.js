// ─────────────────────────────────────────────────────────────
//  Seed de insumos + recetas de Coraje.
//  Insumos: stock 10, mínimo 3 (ajustables luego desde el panel).
//  Idempotente: no duplica insumos ni recetas si se re-ejecuta.
//  Uso: node scripts/seed-insumos.js
// ─────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');
const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

// Los datos viven en datos-seed.js: los comparte con seed-local.js, que siembra
// lo mismo en data/db.json. Así el modo local y el real no se desincronizan.
const { INSUMOS, RECETAS } = require('./datos-seed');

(async () => {
  // 1) Insumos — insertar solo los que falten (no piso stock existente)
  const { data: yaHay } = await supa.from('insumos').select('id,nombre');
  const insMap = new Map((yaHay || []).map(i => [i.nombre, i.id]));
  const faltanIns = INSUMOS.filter(([n]) => !insMap.has(n))
    .map(([nombre, unidad]) => ({ nombre, unidad, stock: 10, stock_min: 3 }));
  if (faltanIns.length) {
    const { data, error } = await supa.from('insumos').insert(faltanIns).select('id,nombre');
    if (error) throw error;
    data.forEach(i => insMap.set(i.nombre, i.id));
    console.log(`✅ Insumos insertados: ${faltanIns.length} (stock 10 c/u)`);
  } else {
    console.log('ℹ️  Los insumos ya existían — no se tocó el stock.');
  }

  // 2) Productos
  const { data: prods } = await supa.from('productos').select('id,nombre');
  const prodMap = new Map((prods || []).map(p => [p.nombre, p.id]));

  // 3) Recetas — upsert (unique producto_id+insumo_id)
  const filas = [];
  const faltantes = new Set();
  for (const [prod, items] of Object.entries(RECETAS)) {
    const pid = prodMap.get(prod);
    if (!pid) { faltantes.add(`producto: ${prod}`); continue; }
    for (const [ins, cant] of items) {
      const iid = insMap.get(ins);
      if (!iid) { faltantes.add(`insumo: ${ins}`); continue; }
      filas.push({ producto_id: pid, insumo_id: iid, cantidad: cant });
    }
  }
  const { error: e2 } = await supa.from('recetas').upsert(filas, { onConflict: 'producto_id,insumo_id' });
  if (e2) throw e2;
  console.log(`✅ Recetas cargadas: ${filas.length} líneas · ${Object.keys(RECETAS).length} productos`);
  if (faltantes.size) console.log('⚠️  No encontrados:', [...faltantes]);

  await supa.rpc('recalcular_agotados');
  console.log('✅ Listo. recalcular_agotados ejecutado.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
