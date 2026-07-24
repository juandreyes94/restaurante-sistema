// Verifica que store-supabase.js lee/escribe correctamente (sin tocar server.js).
const store = require('../store-supabase.js');

(async () => {
  await store.init();

  const prods = store.products();
  console.log(`\n📦 products(): ${prods.length}`);
  const muestra = prods.find(p => p.nombre === 'Hamburguesa Coraje');
  console.log('   muestra →', JSON.stringify(muestra));

  const ins = await store.insumos();
  console.log(`\n🧊 insumos(): ${ins.length}  (ej: ${ins[0].nombre} stock ${ins[0].stock})`);
  const al = await store.alertas();
  console.log(`⚠️  alertas (stock ≤ mínimo): ${al.length}`);

  // Prueba de escritura: crear un pedido, verificar caché + descuento, y limpiar
  console.log('\n— Prueba de escritura (add + remove) —');
  const p = prods.find(p => p.nombre === 'Perro Clásico');
  const antes = (await store.insumos()).find(i => i.nombre === 'Pan brioche').stock;
  const order = await store.add({
    tipo: 'mesa', mesa: 'ADAPTER-TEST', nombre: 'QA',
    items: [{ name: p.nombre, price: p.precio, qty: 1, productoId: p.id }],
    timestamp: Date.now(),
  });
  console.log(`   pedido creado id=${order.id}, pendientes en caché=${store.pendientes().length}`);
  const durante = (await store.insumos()).find(i => i.nombre === 'Pan brioche').stock;
  console.log(`   Pan brioche ${antes} → ${durante}  ${durante === antes - 1 ? '✅' : '❌'}`);
  await store.remove(order.id);
  const despues = (await store.insumos()).find(i => i.nombre === 'Pan brioche').stock;
  console.log(`   tras cancelar → ${despues}  ${despues === antes ? '✅ restaurado' : '❌'}  · pendientes=${store.pendientes().length}`);
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
