// ─────────────────────────────────────────────────────────────
//  Prueba de la tarjeta de sellos, de punta a punta y por HTTP.
//
//  Va contra un servidor ya levantado, así que sirve igual para el modo local
//  (STORE=local) que para uno cableado a Supabase: lo que se comprueba es el
//  contrato que usan las pantallas, no el motor de datos de abajo.
//
//    STORE=local PORT=3100 node server.js      (en otra terminal)
//    node scripts/test-fidelizacion.js
//
//  Deja rastro a propósito: el cliente de prueba queda registrado con un
//  teléfono aleatorio y sus sellos, igual que quedaría el de un cliente real.
//  El pedido que crea sí lo cancela, para no dejar el inventario descuadrado.
// ─────────────────────────────────────────────────────────────
const BASE = process.env.BASE || 'http://localhost:3100';

const CUENTAS = {
  mesero: { usuario: process.env.U_MESERO || 'Mesero', password: process.env.P_MESERO || '5678' },
  cocina: { usuario: process.env.U_COCINA || 'Cocina', password: process.env.P_COCINA || '1234' },
};

let ok = 0, fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`  ✅ ${nombre}`); }
  else { fallos++; console.log(`  ❌ ${nombre}${detalle ? '  → ' + detalle : ''}`); }
}

async function api(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-auth-token': token } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  let datos = null;
  try { datos = await res.json(); } catch {}
  return { estado: res.status, ok: res.ok, datos };
}

async function entrar(rol) {
  const r = await api('/login', { metodo: 'POST', cuerpo: CUENTAS[rol] });
  if (!r.datos || !r.datos.token) {
    throw new Error(`No se pudo entrar como ${rol}: ${(r.datos && r.datos.error) || r.estado}. ` +
      'Revisa usuario y contraseña (variables U_MESERO / P_MESERO …).');
  }
  return r.datos.token;
}

(async () => {
  // El servidor tiene que estar arriba: si no, el resto de mensajes confunde.
  try { await fetch(BASE + '/fidelizacion/reglas'); }
  catch { console.error(`No hay servidor en ${BASE}. Levántalo con: STORE=local PORT=3100 node server.js`); process.exit(1); }

  const mesero = await entrar('mesero');
  const cocina = await entrar('cocina');

  const reglas = (await api('/fidelizacion/reglas')).datos;
  const PARA_PREMIO = reglas.sellos_por_premio;
  console.log(`\nReglas del programa: ${PARA_PREMIO} sellos = ${reglas.premio_descripcion}\n`);

  // Teléfono nuevo en cada corrida: si se repitiera, el registro devolvería la
  // tarjeta vieja y las cuentas de sellos saldrían de otra prueba.
  const nacional = '3' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

  console.log('Registro');
  const sinPermiso = await api('/clientes', { metodo: 'POST', cuerpo: { nombre: 'Prueba Sellos', telefono: nacional } });
  comprobar('sin autorización de datos no se registra', sinPermiso.estado === 400, `dio ${sinPermiso.estado}`);

  const alta = await api('/clientes', { metodo: 'POST', cuerpo: { nombre: 'Prueba Sellos', telefono: nacional, autoriza_datos: true } });
  comprobar('el registro devuelve el código de la tarjeta', !!(alta.datos && alta.datos.codigo));
  const codigo = alta.datos.codigo;

  // El mismo número con indicativo es la misma persona. Sin esto, quien se
  // registra como "+57 300…" y se busca como "300…" termina con dos tarjetas.
  const repetido = await api('/clientes', { metodo: 'POST', cuerpo: { nombre: 'Otro Nombre', telefono: '+57 ' + nacional, autoriza_datos: true } });
  comprobar('el mismo número con indicativo devuelve la tarjeta que ya existía',
    repetido.datos && repetido.datos.yaExistia && repetido.datos.codigo === codigo);

  console.log('\nBuscar en el mostrador');
  const sinSesion = await api('/clientes/buscar?q=' + codigo);
  comprobar('sin sesión no se puede buscar', sinSesion.estado === 401 || sinSesion.estado === 403, `dio ${sinSesion.estado}`);

  const porCodigo = await api('/clientes/buscar?q=' + codigo.toLowerCase(), { token: mesero });
  comprobar('el código en minúsculas encuentra la tarjeta', porCodigo.ok && porCodigo.datos.codigo === codigo);

  const conEspacios = await api('/clientes/buscar?q=' + encodeURIComponent(codigo.slice(0, 4) + ' ' + codigo.slice(4)), { token: mesero });
  comprobar('el código dictado con un espacio en medio también entra', conEspacios.ok && conEspacios.datos.codigo === codigo);

  const porTelefono = await api('/clientes/buscar?q=' + encodeURIComponent('+57 ' + nacional), { token: mesero });
  comprobar('el teléfono con indicativo encuentra al mismo cliente', porTelefono.ok && porTelefono.datos.codigo === codigo);

  const inventado = await api('/clientes/buscar?q=ZZZZZZZZ', { token: mesero });
  comprobar('un código que no existe da 404', inventado.estado === 404, `dio ${inventado.estado}`);

  console.log('\nLa tarjeta pública');
  const publica = await api('/tarjeta/' + codigo);
  comprobar('se puede abrir sin sesión', publica.ok);
  comprobar('no expone el teléfono ni el correo',
    publica.ok && !('telefono' in publica.datos) && !('email' in publica.datos),
    'el enlace se reenvía por WhatsApp');

  console.log('\nQuién puede sellar');
  const selloCocina = await api(`/clientes/${codigo}/sello`, { metodo: 'POST', token: cocina, cuerpo: {} });
  comprobar('cocina no puede sellar', selloCocina.estado === 403, `dio ${selloCocina.estado}`);

  const sello1 = await api(`/clientes/${codigo}/sello`, { metodo: 'POST', token: mesero, cuerpo: {} });
  comprobar('el mesero sella y el saldo sube a 1', sello1.ok && sello1.datos.sellos === 1, JSON.stringify(sello1.datos));

  console.log('\nUn pedido sella una sola vez');
  const productos = (await api('/productos', { token: mesero })).datos;
  const uno = productos[0];
  const pedido = await api('/pedido', {
    metodo: 'POST', token: mesero,
    cuerpo: { tipo: 'mesa', mesa: 'TEST-FID', items: [{ name: uno.nombre, price: uno.precio || 1000, qty: 1, productoId: uno.id }] },
  });
  comprobar('se crea el pedido de prueba', pedido.ok && !!pedido.datos.id);
  const pedidoId = pedido.datos.id;

  const conPedido = await api(`/clientes/${codigo}/sello`, { metodo: 'POST', token: mesero, cuerpo: { pedidoId } });
  comprobar('sellar contra un pedido sube el saldo a 2', conPedido.ok && conPedido.datos.sellos === 2);

  const repetidoPedido = await api(`/clientes/${codigo}/sello`, { metodo: 'POST', token: mesero, cuerpo: { pedidoId } });
  comprobar('el mismo pedido no sella dos veces', repetidoPedido.estado === 400,
    'es lo que frena el doble clic del mesero');

  console.log('\nCanjear');
  const sinSaldo = await api(`/clientes/${codigo}/canjear`, { metodo: 'POST', token: mesero, cuerpo: {} });
  comprobar('no se canjea sin los sellos suficientes', sinSaldo.estado === 400, `dio ${sinSaldo.estado}`);

  // Hasta completar la tarjeta. Van sueltos (sin pedido) a propósito: es el
  // caso del cliente que trae sellos de varias visitas.
  let saldo = 2;
  while (saldo < PARA_PREMIO) {
    const r = await api(`/clientes/${codigo}/sello`, { metodo: 'POST', token: mesero, cuerpo: {} });
    saldo = r.datos.sellos;
  }
  comprobar(`con ${PARA_PREMIO} sellos la tarjeta se marca como completa`, saldo === PARA_PREMIO);

  const canje = await api(`/clientes/${codigo}/canjear`, { metodo: 'POST', token: mesero, cuerpo: {} });
  comprobar('el canje entrega el premio y descuenta los sellos',
    canje.ok && canje.datos.sellos === 0, JSON.stringify(canje.datos));

  console.log('\nEl historial queda firmado');
  const tarjeta = (await api('/tarjeta/' + codigo)).datos;
  comprobar('la tarjeta lista los movimientos', Array.isArray(tarjeta.historial) && tarjeta.historial.length > 0);
  comprobar('cada sello dice quién lo puso',
    (tarjeta.historial || []).filter(h => h.usuario).length > 0,
    'sin esto no se puede auditar un reclamo meses después');

  // El pedido de prueba se cancela para devolver el inventario que descontó.
  await api('/pedido/' + pedidoId, { metodo: 'DELETE', token: mesero });

  console.log(`\n${ok} comprobaciones pasan, ${fallos} fallan.`);
  console.log(`Tarjeta de prueba: ${BASE}/tarjeta.html?c=${codigo}`);
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('\nLa prueba se cayó:', e.message); process.exit(1); });
