const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const os = require('os');
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

// ── Almacenamiento en memoria ──
let orders = [];
let nextId = 1;
const clients = new Set();

// ── WebSocket ──
wss.on('connection', (ws) => {
  clients.add(ws);
  // Enviar pedidos pendientes al conectarse
  const pending = orders.filter(o => o.status === 'pendiente');
  ws.send(JSON.stringify({ type: 'init', orders: pending }));

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
  const { mesa, items, nombre, notas, nit, email } = req.body;
  if (!mesa || !items?.length) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const order = {
    id: nextId++,
    mesa: String(mesa),
    items,
    nombre: (nombre || '').trim(),
    notas:  (notas  || '').trim(),
    nit:    (nit    || '').trim(),
    email:  (email  || '').trim(),
    timestamp: Date.now(),
    status: 'pendiente',
    facturado: false,
  };
  orders.push(order);
  broadcast({ type: 'new_order', order });
  res.json({ success: true, id: order.id });
});

// Marcar pedido como completado
app.post('/pedido/:id/completar', (req, res) => {
  const id = parseInt(req.params.id);
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  order.status = 'completado';
  broadcast({ type: 'order_complete', id });
  res.json({ success: true });
});

// Listar pedidos pendientes
app.get('/pedidos', (req, res) => {
  res.json(orders.filter(o => o.status === 'pendiente'));
});

// Limpiar todos los pedidos completados
app.delete('/pedidos/completados', (req, res) => {
  orders = orders.filter(o => o.status === 'pendiente');
  res.json({ success: true });
});

// Emitir factura electrónica via Factus
app.post('/facturar/:id', async (req, res) => {
  if (factusConfig.email === 'TU_EMAIL@ejemplo.com') {
    return res.status(503).json({ error: 'Configura tus credenciales en factus.config.js' });
  }

  const id = parseInt(req.params.id);
  const order = orders.find(o => o.id === id);
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

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     🍽️   SISTEMA DE PEDIDOS ACTIVO      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Red local: http://${ip}:${PORT}         `);
  console.log(`║  Menú:      http://${ip}:${PORT}/menu.html`);
  console.log(`║  Comandas:  http://${ip}:${PORT}/comanda.html`);
  console.log(`║  QR Codes:  http://${ip}:${PORT}/qr.html`);
  console.log('╚════════════════════════════════════════╝\n');
});
