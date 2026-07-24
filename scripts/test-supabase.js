// Prueba de conexión a Supabase (valida URL + service_role key).
// Uso: node scripts/test-supabase.js
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');

const supa = createClient(cfg.url, cfg.serviceRoleKey, {
  auth: { persistSession: false },
});

(async () => {
  console.log('🔌 Conectando a', cfg.url);
  // listBuckets no requiere tablas: valida credenciales.
  const { data, error } = await supa.storage.listBuckets();
  if (error) {
    console.error('❌ Error de conexión:', error.message);
    process.exit(1);
  }
  console.log('✅ Conexión OK. Buckets de Storage:', data.map(b => b.name).join(', ') || '(ninguno aún)');

  // Si el esquema ya está cargado, muestra conteos.
  const productos = await supa.from('productos').select('id', { count: 'exact', head: true });
  if (!productos.error) {
    console.log(`📦 Tabla productos: ${productos.count} filas`);
  } else {
    console.log('ℹ️  Aún no existe la tabla productos (corre sql/01 y sql/02 en el SQL Editor).');
  }
})();
