const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');
const factusConfig = require('./factus.config.js');

// ── Factus token cache (requiere Node 18+ para fetch nativo) ──
let _factusToken = null;
let _factusTokenExpiry = 0;

async function getFactusToken() {
  if (_factusToken && Date.now() < _factusTokenExpiry) return _factusToken;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: '2',
    client_secret: 'factus2024',
    username: factusConfig.email,
    password: factusConfig.password,
  });
  const res = await fetch('https://api.factus.com.co/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.message || 'Auth fallida en Factus');
  _factusToken = data.access_token;
  _factusTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _factusToken;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

const clients = new Set();

// ── Acceso por PIN (rol) ──
// Cambia los PIN con variables de entorno PIN_COCINA / PIN_ADMIN, o aquí.
const PINS = {
  cocina: process.env.PIN_COCINA || '1234',
  mesero: process.env.PIN_MESERO || '5678',
  admin:  process.env.PIN_ADMIN  || '9876',
};
const _tokens = new Map(); // token -> role

app.post('/login', (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  const role = Object.keys(PINS).find(r => PINS[r] === pin);
  if (!role) return res.status(401).json({ error: 'PIN incorrecto' });
  const token = crypto.randomBytes(16).toString('hex');
  _tokens.set(token, role);
  res.json({ ok: true, role, token });
});

// Middleware para proteger rutas por rol
function requireRole(...roles) {
  return (req, res, next) => {
    const role = _tokens.get(req.get('x-auth-token') || '');
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }
    req.role = role;
    next();
  };
}

// ── Catálogo = menú digital real de Coraje (una sola fuente de verdad) ──
const P = (nombre, categoria, precio, precioCombo, imagen, descripcion, emoji) =>
  ({ nombre, categoria, precio, precioCombo: precioCombo || null, imagen: imagen || '', descripcion: descripcion || '', emoji: emoji || '', disponible: true });
store.ensureCatalog([
  // Chuzos
  P('Chuzo Desgranado de Panceta','Chuzos',32900,41900,'img/chuzo-desgranado-de-panceta.jpg','Panceta caramelizada, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.'),
  P('Chuzo Desgranado','Chuzos',35900,44900,'img/chuzo-desgranado.jpg','Res, pollo o mixto, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.'),
  P('Chuzo Desgranado Pulled Pork','Chuzos',33900,42900,'img/chuzo-desgranado-pulled-pork.jpg','Pulled pork en salsa BBQ de lulo, batavia, queso cuajada, ripio de papa, maicitos, salsa de la casa.'),
  // Hamburguesas
  P('Hamburguesa Coraje','Hamburguesas',32900,41900,'img/hamburguesa-coraje.jpg','Pan brioche, 150g carne premium, queso philadelphia, mermelada de tomate, tocineta, aros de cebolla apanados, vegetales, salsa de la casa.'),
  P('Hamburguesa Americana','Hamburguesas',28900,37900,'img/hamburguesa-americana.jpg','Pan brioche, 150g carne premium, queso americano, tocineta, vegetales, salsa BBQ, salsa de la casa.'),
  P('Hamburguesa Mocca','Hamburguesas',33900,42900,'img/hamburguesa-mocca.jpg','Pan brioche, mayonesa de café, carne premium, queso americano, cebolla en reducción de café y ron, queso crema, tocineta.'),
  P('Hamburguesa Hawai','Hamburguesas',33900,42900,'img/hamburguesa-hawai.jpg','Pan brioche, 150g carne premium, queso asado, piña calada, tocineta, vegetales, salsa BBQ, salsa de la casa.'),
  P('Hamburguesa Gaucha','Hamburguesas',33900,42900,'img/hamburguesa-gaucha.jpg','Pan brioche, 150g carne premium, queso mozzarella, chorizo artesanal, guacamole, pico de gallo, vegetales, salsa de la casa.'),
  P('Hamburguesa Marake','Hamburguesas',34900,43900,'img/hamburguesa-marake.jpg','Pan brioche, 150g carne premium, queso asado, dip cremoso de maracuyá, tocineta, vegetales, salsa de la casa.'),
  // Papas
  P('Papas Coraje','Papas',33900,null,'img/papas-coraje.jpg','Papas a la francesa (280g), salchicha ranchera, carne desmechada, queso mozzarella, maicitos, guacamole, pico de gallo, salsa de la casa.'),
  // Perros
  P('Perro Coraje','Perros',28900,37900,'img/perro-coraje.jpg','Pan brioche, salchicha, queso mozzarella, tocineta, carne desmechada, salsa de la casa.'),
  P('Perro Clásico','Perros',25900,34900,'img/perro-clasico.jpg','Pan brioche, salchicha, queso americano, tocineta, salsa de tomate, salsa BBQ.'),
  P('Perro Chancho','Perros',26900,35900,'img/perro-chancho.jpg','Pan brioche, salchicha, chicharrón crujiente, queso mozzarella, salsa BBQ, guacamole.'),
  P('Perro Inmaduro','Perros',26900,35900,'img/perro-inmaduro.jpg','Pan brioche, salchicha, queso philadelphia, maduro calado, tocineta, salsa crema leña.'),
  P('Perro Granjero','Perros',25900,34900,'img/perro-granjero.jpg','Pan brioche, salchicha, queso mozzarella, maicitos, tocineta, salsa de maíz dulce.'),
  P('Perro Chingón','Perros',26900,35900,'img/perro-chingon.jpg','Pan brioche, salchicha, queso mozzarella, tocineta, pico de gallo, guacamole, salsa BBQ.'),
  P('Perro Hawai','Perros',26900,35900,'img/perro-hawai.jpg','Pan brioche, salchicha, queso mozzarella, tocineta, piña calada, salsa BBQ.'),
  P('Perro Perla del Otún','Perros',24900,33900,'img/perro-perla-del-otun.jpg','Pan brioche, salchicha americana, queso cuajada, huevos de codorniz, ripio de papa, tocineta, salsa mora, salsa rosada.'),
  P('Perro Maradoniano','Perros',22900,31900,'img/perro-maradoniano.jpg','Pan brioche, chorizo artesanal, pico de gallo, guacamole, salsa de la casa.'),
  // Bebidas (emoji)
  P('Coca-Cola / Postobón','Bebidas',5900,null,'','Gaseosa 350ml bien fría.','🥤'),
  P('Agua Manantial','Bebidas',5900,null,'','Agua natural 350ml.','💧'),
  P('Tamarindo Michelada','Bebidas',7900,null,'','Michelada sabor tamarindo.','🍹'),
  P('Soda Michelada','Bebidas',7900,null,'','Michelada con soda.','🍹'),
  P('Sodas Saborizadas','Bebidas',12000,null,'','Sodas en diferentes sabores.','🥤'),
  P('Hatsu','Bebidas',8500,null,'','Bebida Hatsu natural o de frutas.','🫖'),
  P('Cerveza Sol','Bebidas',8500,null,'','Cerveza Sol 330ml.','🍺'),
  P('Cerveza 3 Cordilleras','Bebidas',9000,null,'','Cerveza artesanal 3 Cordilleras.','🍺'),
  P('Cerveza Corona','Bebidas',10000,null,'','Cerveza Corona 330ml.','🍺'),
  // Adiciones (emoji)
  P('Carne Premium','Adiciones',11000,null,'','Porción adicional de carne premium.','🥩'),
  P('Queso Asado','Adiciones',4900,null,'','Porción de queso asado.','🧀'),
  P('Queso Philadelphia','Adiciones',4900,null,'','Porción de queso philadelphia.','🧀'),
  P('Queso Mozzarella','Adiciones',3900,null,'','Porción de queso mozzarella.','🧀'),
  P('Queso Americano','Adiciones',3900,null,'','Porción de queso americano.','🧀'),
  P('Porción Papas a la Francesa','Adiciones',7900,null,'','Porción de papas a la francesa.','🍟'),
  P('Huevos de Codorniz','Adiciones',5000,null,'','Porción de huevos de codorniz.','🥚'),
], 'coraje-menu-v1');

// ── Productos (catálogo del menú) ──
app.get('/productos', (req, res) => res.json(store.products()));

app.post('/productos', requireRole('admin'), (req, res) => {
  const { nombre, categoria, precio, disponible, imagen, descripcion, precioCombo, emoji } = req.body || {};
  if (!nombre || !categoria) return res.status(400).json({ error: 'Nombre y categoría son obligatorios' });
  const p = store.productAdd({
    nombre: String(nombre).trim(),
    categoria: String(categoria).trim(),
    precio: Math.max(0, Number(precio) || 0),
    precioCombo: precioCombo != null && precioCombo !== '' ? Math.max(0, Number(precioCombo) || 0) : null,
    imagen: (imagen || '').trim(),
    descripcion: (descripcion || '').trim(),
    emoji: (emoji || '').trim(),
    disponible: disponible !== false,
  });
  res.json({ success: true, product: p });
});

app.put('/productos/:id', requireRole('admin'), (req, res) => {
  const p = store.productGet(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const { nombre, categoria, precio, disponible, imagen, descripcion, precioCombo, emoji } = req.body || {};
  if (nombre      !== undefined) p.nombre = String(nombre).trim();
  if (categoria   !== undefined) p.categoria = String(categoria).trim();
  if (precio      !== undefined) p.precio = Math.max(0, Number(precio) || 0);
  if (precioCombo !== undefined) p.precioCombo = precioCombo === '' || precioCombo == null ? null : Math.max(0, Number(precioCombo) || 0);
  if (imagen      !== undefined) p.imagen = String(imagen).trim();
  if (descripcion !== undefined) p.descripcion = String(descripcion).trim();
  if (emoji       !== undefined) p.emoji = String(emoji).trim();
  if (disponible  !== undefined) p.disponible = !!disponible;
  store.save();
  res.json({ success: true, product: p });
});

app.delete('/productos/:id', requireRole('admin'), (req, res) => {
  store.productDelete(parseInt(req.params.id));
  res.json({ success: true });
});

// ── WebSocket ──
wss.on('connection', (ws) => {
  clients.add(ws);
  // Enviar pedidos pendientes (cocina) y completados (control) al conectarse
  ws.send(JSON.stringify({ type: 'init', orders: store.pendientes(), completed: store.completados() }));

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
}

// ── Rutas API ──

// Recibir nuevo pedido (lo crea el mesero desde mesero.html; admin también puede)
app.post('/pedido', requireRole('mesero', 'admin'), (req, res) => {
  const { mesa, items, nombre, notas, nit, email, tipo, direccion, telefono, agoMin } = req.body;

  // Tipo de pedido: 'mesa' | 'domicilio' | 'llevar' (si no llega, se deduce)
  const tipoOk = ['mesa', 'domicilio', 'llevar'];
  const tipoVal = tipoOk.includes(tipo) ? tipo : (mesa ? 'mesa' : 'llevar');

  if (!items?.length) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  if (tipoVal === 'mesa' && !mesa) {
    return res.status(400).json({ error: 'Falta el número de mesa' });
  }

  const order = store.add({
    tipo: tipoVal,
    mesa: String(mesa || ''),
    direccion: (direccion || '').trim(),
    telefono:  (telefono  || '').trim(),
    items,
    nombre: (nombre || '').trim(),
    notas:  (notas  || '').trim(),
    nit:    (nit    || '').trim(),
    email:  (email  || '').trim(),
    // agoMin: opcional, backdatar el pedido N minutos (útil para pruebas/siembra)
    timestamp: Date.now() - (Number(agoMin) > 0 ? Number(agoMin) * 60000 : 0),
    status: 'pendiente',
    facturado: false,
  });
  broadcast({ type: 'new_order', order });
  res.json({ success: true, id: order.id });
});

// Marcar pedido como completado
app.post('/pedido/:id/completar', requireRole('cocina', 'admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const order = store.get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  order.status = 'completado';
  order.completedAt = Date.now();
  store.save();
  broadcast({ type: 'order_complete', id, completedAt: order.completedAt, order });
  res.json({ success: true });
});

// Editar un pedido pendiente (corrección) — se refleja en cocina y admin al instante
app.put('/pedido/:id', requireRole('mesero', 'admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const order = store.get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status !== 'pendiente') return res.status(409).json({ error: 'Solo se pueden editar pedidos pendientes' });

  const { mesa, items, nombre, notas, tipo, direccion, telefono } = req.body || {};
  if (!items?.length) return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });

  const tipoOk = ['mesa', 'domicilio', 'llevar'];
  const tipoVal = tipoOk.includes(tipo) ? tipo : order.tipo;
  if (tipoVal === 'mesa' && !mesa) return res.status(400).json({ error: 'Falta el número de mesa' });

  order.tipo = tipoVal;
  order.mesa = String(mesa || '');
  order.direccion = (direccion || '').trim();
  order.telefono  = (telefono  || '').trim();
  order.items = items;
  order.nombre = (nombre || '').trim();
  order.notas  = (notas  || '').trim();
  order.editedAt = Date.now();
  store.save();
  broadcast({ type: 'order_updated', order });
  res.json({ success: true, order });
});

// Cancelar / eliminar un pedido pendiente
app.delete('/pedido/:id', requireRole('mesero', 'admin'), (req, res) => {
  const id = parseInt(req.params.id);
  const order = store.get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  store.remove(id);
  broadcast({ type: 'order_cancelled', id });
  res.json({ success: true });
});

// Listar pedidos pendientes
app.get('/pedidos', requireRole('cocina', 'mesero', 'admin'), (req, res) => {
  res.json(store.pendientes());
});

// Limpiar todos los pedidos completados
app.delete('/pedidos/completados', requireRole('cocina', 'admin'), (req, res) => {
  store.clearCompletados();
  broadcast({ type: 'history_cleared' });
  res.json({ success: true });
});

// Emitir factura electrónica via Factus
app.post('/facturar/:id', requireRole('cocina', 'admin'), async (req, res) => {
  if (factusConfig.email === 'TU_EMAIL@ejemplo.com') {
    return res.status(503).json({ error: 'Configura tus credenciales en factus.config.js' });
  }

  const id = parseInt(req.params.id);
  const order = store.get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  const nit    = (req.body?.nit || order.nit || '').trim() || '222222222222';
  const email  = order.email || 'consumidor@final.com';
  const nombre = order.nombre || 'Consumidor Final';

  try {
    const token = await getFactusToken();

    const payload = {
      numbering_range_id: factusConfig.numbering_range_id,
      reference_code: `PED-${String(order.id).padStart(4, '0')}`,
      observation: `Mesa ${order.mesa}${order.nombre ? ' - ' + order.nombre : ''}`,
      payment_form: '1',
      payment_method_code: '10',
      customer: {
        identification: nit,
        dv: null,
        company: null,
        trade_name: null,
        names: nombre,
        address: null,
        email: email,
        mobile: null,
        phone: null,
        type_document_identification_id: 13,
        type_organization_id: 2,
        municipality_id: factusConfig.municipality_id,
        tribute_id: 21,
        type_regime_code: '49',
      },
      items: order.items.map((item, i) => ({
        code_reference: `P${String(i + 1).padStart(3, '0')}`,
        name: item.name,
        quantity: item.qty,
        discount_rate: '0.00',
        price: String(item.price),
        tax_rate: factusConfig.tax_rate,
        unit_measure_id: 70,
        standard_code_id: 1,
        is_excluded: 0,
        tribute_id: factusConfig.tribute_id,
        withholding_taxes: [],
      })),
    };

    const factusRes = await fetch('https://api.factus.com.co/v1/bills/validate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await factusRes.json();
    const bill = result.data?.bill;

    if (bill?.cufe) {
      order.facturado = true;
      order.cufe = bill.cufe;
      order.facturaNum = bill.number;
      store.save();
      broadcast({ type: 'order_invoiced', id: order.id, number: bill.number });
      return res.json({ success: true, cufe: bill.cufe, number: bill.number });
    }

    const errMsg = result.errors
      ? Object.values(result.errors).flat().join(', ')
      : (result.message || 'Error desconocido de Factus');
    res.status(400).json({ error: errMsg });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Detectar IP local ──
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     🍽️   SISTEMA DE PEDIDOS ACTIVO      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Red local: http://${ip}:${PORT}         `);
  console.log(`║  Menú:      http://${ip}:${PORT}/menu.html`);
  console.log(`║  Meseros:   http://${ip}:${PORT}/mesero.html`);
  console.log(`║  Comandas:  http://${ip}:${PORT}/comanda.html`);
  console.log(`║  Admin:     http://${ip}:${PORT}/admin.html`);
  console.log(`║  QR Codes:  http://${ip}:${PORT}/qr.html`);
  console.log('╚════════════════════════════════════════╝');
  console.log(`🔒 Acceso por PIN — cocina: ${PINS.cocina}  ·  mesero: ${PINS.mesero}  ·  admin: ${PINS.admin}`);
  console.log('💾 Datos persistentes en ./data/db.json\n');
});
