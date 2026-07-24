// Verificación completa del esquema cargado en Supabase.
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');
const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

(async () => {
  const tablas = ['config', 'categorias', 'productos', 'insumos', 'recetas', 'pedidos', 'pedido_items', 'movimientos_inventario'];
  console.log('── Tablas ──');
  for (const t of tablas) {
    const { count, error } = await supa.from(t).select('*', { count: 'exact', head: true });
    console.log(error ? `  ❌ ${t}: ${error.message}` : `  ✅ ${t.padEnd(24)} ${count} filas`);
  }

  console.log('\n── Productos por categoría ──');
  const { data: cats } = await supa.from('categorias').select('id,nombre,orden').order('orden');
  for (const c of cats || []) {
    const { count } = await supa.from('productos').select('*', { count: 'exact', head: true }).eq('categoria_id', c.id);
    console.log(`  ${c.nombre.padEnd(14)} ${count}`);
  }

  console.log('\n── Funciones de inventario (RPC) ──');
  for (const fn of ['recalcular_agotados']) {
    const { error } = await supa.rpc(fn);
    console.log(error ? `  ❌ ${fn}: ${error.message}` : `  ✅ ${fn} existe y corre`);
  }
})();
