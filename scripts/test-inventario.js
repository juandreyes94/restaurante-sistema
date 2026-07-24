// Prueba end-to-end de la lógica de inventario (no deja rastro).
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../supabase.config.js');
const supa = createClient(cfg.url, cfg.serviceRoleKey, { auth: { persistSession: false } });

const stockDe = async (nombre) => {
  const { data } = await supa.from('insumos').select('stock').eq('nombre', nombre).single();
  return Number(data.stock);
};

(async () => {
  const { data: prod } = await supa.from('productos').select('id,nombre').eq('nombre', 'Hamburguesa Coraje').single();

  const antes = await stockDe('Pan brioche');
  console.log(`Pan brioche antes: ${antes}`);

  // Crear pedido de prueba con 2× Hamburguesa Coraje
  const { data: ped } = await supa.from('pedidos').insert({ tipo: 'mesa', mesa: 'TEST', total: 0 }).select('id').single();
  await supa.from('pedido_items').insert({ pedido_id: ped.id, producto_id: prod.id, nombre: prod.nombre, precio: 41900, cantidad: 2 });

  // Descontar
  await supa.rpc('descontar_inventario_pedido', { p_pedido_id: ped.id, p_usuario: 'test' });
  const despues = await stockDe('Pan brioche');
  console.log(`Pan brioche tras vender 2: ${despues}  ${despues === antes - 2 ? '✅ (-2 correcto)' : '❌'}`);

  // Devolver (cancelación)
  await supa.rpc('devolver_inventario_pedido', { p_pedido_id: ped.id, p_usuario: 'test' });
  const restaurado = await stockDe('Pan brioche');
  console.log(`Pan brioche tras cancelar:  ${restaurado}  ${restaurado === antes ? '✅ (restaurado)' : '❌'}`);

  // Limpiar el pedido de prueba
  await supa.from('pedidos').delete().eq('id', ped.id);
  const { count } = await supa.from('movimientos_inventario').select('*', { count: 'exact', head: true });
  console.log(`Movimientos de inventario registrados (auditoría): ${count}`);
  console.log('🧹 Pedido de prueba eliminado.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
