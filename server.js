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

// Middleware para proteger rutas por rol (se aplicará al separar el panel admin)
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

// Recibir nuevo pedido
app.post('/pedido', (req, res) => {
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
app.post('/pedido/:id/completar', (req, res) => {
  const id = parseInt(req.params.id);
  const order = store.get(id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  order.status = 'completado';
  order.completedAt = Date.now();
  store.save();
  broadcast({ type: 'order_complete', id, completedAt: order.completedAt });
  res.json({ success: true });
});

// Listar pedidos pendientes
app.get('/pedidos', (req, res) => {
  res.json(store.pendientes());
});

// Limpiar todos los pedidos completados
app.delete('/pedidos/completados', (req, res) => {
  store.clearCompletados();
  broadcast({ type: 'history_cleared' });
  res.json({ success: true });
});

// Emitir factura electrónica via Factus
app.post('/facturar/:id', async (req, res) => {
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
  console.log(`║  Comandas:  http://${ip}:${PORT}/comanda.html`);
  console.log(`║  QR Codes:  http://${ip}:${PORT}/qr.html`);
  console.log('╚════════════════════════════════════════╝');
  console.log(`🔒 Acceso por PIN — cocina: ${PINS.cocina}  ·  admin: ${PINS.admin}`);
  console.log('💾 Datos persistentes en ./data/db.json\n');
});
