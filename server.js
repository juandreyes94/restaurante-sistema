const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
const store = require('./store-supabase');
const { broadcast } = require('./realtime-server');
const { factus: factusConfig, jwtSecret, jwtEsDeDesarrollo, supabase: supaCfg } = require('./config');

// ── Factus token cache (requiere Node 18+ para fetch nativo) ──
let _factusToken = null;
let _factusTokenExpiry = 0;

async function getFactusToken() {
  if (_factusToken && Date.now() < _factusTokenExpiry) return _factusToken;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: factusConfig.clientId,
    client_secret: factusConfig.clientSecret,
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// ── Acceso: una cuenta por persona, sesión sin estado ──
// El token es un JWT firmado, no una entrada en un Map en memoria: así la
// sesión sobrevive a reinicios y sirve con varias instancias del servidor.
const JWT_SECRET = jwtSecret;
const JWT_HORAS = 12;   // un turno largo

if (jwtEsDeDesarrollo) {
  console.warn('⚠️  JWT_SECRET no está definido: usando uno de desarrollo. Defínelo antes de desplegar.');
}

// Lo que el navegador necesita para suscribirse a los avisos en vivo.
// La anon key es pública por diseño (va al cliente igual); se sirve desde aquí
// para no tenerla escrita a mano en cada HTML ni versionada en el repo.
app.get('/realtime-config', (req, res) => {
  res.json({ url: supaCfg.url, anonKey: supaCfg.anonKey || null });
});

// Login: se elige el rol y se marca el PIN. El PIN identifica a la persona
// dentro de su rol, así que no hay que buscarse en una lista de nombres.
// Sigue aceptando { usuario_id, pin } por si algo viejo lo usa.
app.post('/login', async (req, res) => {
  const { usuario_id, rol, pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'Falta el PIN' });
  if (!usuario_id && !['mesero', 'cocina', 'admin'].includes(rol)) {
    return res.status(400).json({ error: 'Falta el rol' });
  }
  try {
    const u = usuario_id
      ? await store.verificarPin(usuario_id, pin)
      : await store.verificarPinPorRol(rol, pin);
    if (!u) return res.status(401).json({ error: 'PIN incorrecto' });
    const token = jwt.sign(
      { uid: u.id, nombre: u.nombre, rol: u.rol },
      JWT_SECRET, { expiresIn: `${JWT_HORAS}h` });
    res.json({ ok: true, role: u.rol, nombre: u.nombre, usuario_id: u.id, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista para pintar el login: solo id, nombre y rol de la gente activa.
app.get('/usuarios/activos', async (req, res) => {
  try { res.json(await store.usuariosActivos()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Gestión de usuarios (solo admin) ──
app.get('/usuarios', requireRole('admin'), async (req, res) => {
  try { res.json(await store.usuarios()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/usuarios', requireRole('admin'), async (req, res) => {
  const { nombre, rol, pin } = req.body || {};
  if (!String(nombre || '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!['mesero', 'cocina', 'admin'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (!/^\d{4,8}$/.test(String(pin || ''))) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 8 dígitos' });
  try {
    // El PIN es lo único que se marca al entrar, así que dentro de un rol no
    // puede repetirse: si no, quien lo comparte no podría entrar nunca.
    if (await store.pinEnUso(rol, pin)) {
      return res.status(400).json({ error: 'Ese PIN ya lo usa alguien de ese rol. Elige otro.' });
    }
    res.json({ success: true, usuario: await store.usuarioAdd({ nombre: String(nombre).trim(), rol, pin }) });
  }
  catch (e) { res.status(errorHttp(e)).json({ error: errorUsuario(e) }); }
});

app.put('/usuarios/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { nombre, rol, pin, activo } = req.body || {};
  if (nombre !== undefined && !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (rol !== undefined && !['mesero', 'cocina', 'admin'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (pin && !/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 8 dígitos' });
  // Dos formas de quedarse fuera del panel uno mismo: desactivarse o bajarse el rol.
  if (id === req.usuario.id) {
    if (activo === false) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    if (rol !== undefined && rol !== 'admin') return res.status(400).json({ error: 'No puedes quitarte tu propio rol de administrador' });
  }
  try {
    // Mismo motivo que al crear. El rol a validar es el nuevo si lo están
    // cambiando; si no, el que ya tenía.
    if (pin) {
      const actual = (await store.usuarios()).find(u => u.id === id);
      const rolFinal = rol !== undefined ? rol : actual?.rol;
      if (rolFinal && await store.pinEnUso(rolFinal, pin, id)) {
        return res.status(400).json({ error: 'Ese PIN ya lo usa alguien de ese rol. Elige otro.' });
      }
    }
    res.json({ success: true, usuario: await store.usuarioUpdate(id, req.body || {}) });
  }
  catch (e) { res.status(errorHttp(e)).json({ error: errorUsuario(e) }); }
});

// El nombre es único (índice en la BD): sin esto llegaría el error crudo de Postgres.
const errorHttp = (e) => (e?.code === '23505' ? 400 : 500);
const errorUsuario = (e) => (e?.code === '23505'
  ? 'Ya hay alguien con ese nombre. Usa el apellido o una inicial para diferenciarlos.'
  : e.message);

// Middleware para proteger rutas por rol
function requireRole(...roles) {
  return (req, res, next) => {
    let payload;
    try { payload = jwt.verify(req.get('x-auth-token') || '', JWT_SECRET); }
    catch { return res.status(403).json({ error: 'Sesión inválida o vencida' }); }
    if (!roles.includes(payload.rol)) {
      return res.status(403).json({ error: 'Acceso no autorizado' });
    }
    req.role = payload.rol;
    req.usuario = { id: payload.uid, nombre: payload.nombre, rol: payload.rol };
    next();
  };
}

// ── Catálogo: ahora vive en Supabase (tablas categorias + productos).
//    Se carga en memoria al arrancar (store.init) — ya no se hardcodea aquí. ──

// ── Productos (catálogo del menú) ──
app.get('/productos', async (req, res) => {
  try { res.json(await store.products()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/productos', requireRole('admin'), async (req, res) => {
  const { nombre, categoria, precio, disponible, imagen, descripcion, precioCombo, emoji } = req.body || {};
  if (!nombre || !categoria) return res.status(400).json({ error: 'Nombre y categoría son obligatorios' });
  try {
    const p = await store.productAdd({
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/productos/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!await store.productGet(id)) return res.status(404).json({ error: 'Producto no encontrado' });
  const { nombre, categoria, precio, disponible, imagen, descripcion, precioCombo, emoji } = req.body || {};
  const fields = {};
  if (nombre      !== undefined) fields.nombre = String(nombre).trim();
  if (categoria   !== undefined) fields.categoria = String(categoria).trim();
  if (precio      !== undefined) fields.precio = Math.max(0, Number(precio) || 0);
  if (precioCombo !== undefined) fields.precioCombo = precioCombo === '' || precioCombo == null ? null : Math.max(0, Number(precioCombo) || 0);
  if (imagen      !== undefined) fields.imagen = String(imagen).trim();
  if (descripcion !== undefined) fields.descripcion = String(descripcion).trim();
  if (emoji       !== undefined) fields.emoji = String(emoji).trim();
  if (disponible  !== undefined) fields.disponible = !!disponible;
  try {
    const p = await store.productUpdate(id, fields);
    res.json({ success: true, product: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subir foto de producto ──
// En memoria (no toca disco) y de ahí a Supabase Storage. Sin `sharp`: se quitó
// a propósito del proyecto porque rompía en Linux, así que el peso se acota aquí.
const MIMES_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const subirImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (MIMES_OK.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Formato no admitido. Usa JPG, PNG, WEBP o AVIF.'));
  },
}).single('imagen');

app.post('/upload', requireRole('admin'), (req, res) => {
  subirImagen(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'La imagen pesa más de 5 MB. Usa una más liviana.'
        : err.message || 'No se pudo procesar la imagen';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No llegó ninguna imagen' });
    try {
      // multer entrega el nombre en latin1: sin esto "Piña.jpg" llega como "PiÃ±a.jpg"
      // y el nombre del archivo en el bucket sale ilegible.
      const nombre = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const { url, path: ruta } = await store.uploadImagen(
        req.file.buffer, nombre, req.file.mimetype);
      res.json({ success: true, url, path: ruta });
    } catch (e) {
      res.status(500).json({ error: e.message || 'No se pudo subir la imagen' });
    }
  });
});

app.delete('/productos/:id', requireRole('admin'), async (req, res) => {
  try {
    await store.productDelete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Inventario ──
app.get('/insumos', requireRole('cocina', 'admin'), async (req, res) => {
  try { res.json(await store.insumos()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/insumos', requireRole('admin'), async (req, res) => {
  const { nombre, unidad, stock, stock_min } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try { res.json({ success: true, insumo: await store.insumoAdd({ nombre, unidad, stock: Number(stock) || 0, stock_min: Number(stock_min) || 0 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/insumos/:id', requireRole('admin'), async (req, res) => {
  try { res.json({ success: true, insumo: await store.insumoUpdate(parseInt(req.params.id), req.body || {}) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Registrar entrada de stock (compra/reposición)
app.post('/insumos/:id/entrada', requireRole('admin'), async (req, res) => {
  const cantidad = Number(req.body?.cantidad);
  if (!(cantidad > 0)) return res.status(400).json({ error: 'Cantidad inválida' });
  try {
    const nuevo = await store.insumoEntrada(parseInt(req.params.id), cantidad, req.usuario);
    res.json({ success: true, stock: nuevo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/inventario/alertas', requireRole('cocina', 'admin'), async (req, res) => {
  try { res.json(await store.alertas()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recetas (las edita cocina desde recetas.html) ──
app.get('/recetas', requireRole('cocina', 'admin'), async (req, res) => {
  try { res.json(await store.recetas()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Reemplaza la receta completa de un producto (items: [{insumo_id, cantidad}])
app.put('/recetas/:productoId', requireRole('cocina', 'admin'), async (req, res) => {
  const productoId = parseInt(req.params.productoId);
  if (!await store.productGet(productoId)) return res.status(404).json({ error: 'Producto no encontrado' });
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Falta la lista de insumos' });
  try {
    const filas = await store.recetaSet(productoId, items);
    res.json({ success: true, items: filas });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Estado inicial ──
// Antes esto viajaba en el primer mensaje del WebSocket, al conectarse. Ahora
// que los avisos los reparte Supabase, la pantalla lo pide por HTTP al entrar
// (y otra vez al reconectarse, para recuperar lo que se haya perdido mientras
// estuvo caída).
app.get('/estado-inicial', requireRole('cocina', 'mesero', 'admin'), async (req, res) => {
  try {
    const [orders, completed] = await Promise.all([store.pendientes(), store.completados()]);
    res.json({ orders, completed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rutas API ──

// Recibir nuevo pedido (lo crea el mesero desde mesero.html; admin también puede)
app.post('/pedido', requireRole('mesero', 'admin'), async (req, res) => {
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

  try {
    const order = await store.add({
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
      usuario: req.usuario,          // queda registrado quién tomó el pedido
    });
    await broadcast({ type: 'new_order', order });
    res.json({ success: true, id: order.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar pedido como completado
app.post('/pedido/:id/completar', requireRole('cocina', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const order = await store.completar(id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    await broadcast({ type: 'order_complete', id, completedAt: order.completedAt, order });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar un pedido pendiente (corrección) — se refleja en cocina y admin al instante
app.put('/pedido/:id', requireRole('mesero', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const actual = await store.get(id);
  if (!actual) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (actual.status !== 'pendiente') return res.status(409).json({ error: 'Solo se pueden editar pedidos pendientes' });

  const { mesa, items, nombre, notas, tipo, direccion, telefono } = req.body || {};
  if (!items?.length) return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });

  const tipoOk = ['mesa', 'domicilio', 'llevar'];
  const tipoVal = tipoOk.includes(tipo) ? tipo : actual.tipo;
  if (tipoVal === 'mesa' && !mesa) return res.status(400).json({ error: 'Falta el número de mesa' });

  try {
    const order = await store.editar(id, {
      tipo: tipoVal,
      mesa: String(mesa || ''),
      direccion: (direccion || '').trim(),
      telefono:  (telefono  || '').trim(),
      items,
      nombre: (nombre || '').trim(),
      notas:  (notas  || '').trim(),
      usuario: req.usuario,          // quién hizo la corrección
    });
    await broadcast({ type: 'order_updated', order });
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancelar / eliminar un pedido pendiente
app.delete('/pedido/:id', requireRole('mesero', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!await store.get(id)) return res.status(404).json({ error: 'Pedido no encontrado' });
  try {
    await store.remove(id, req.usuario);   // quién canceló
    await broadcast({ type: 'order_cancelled', id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Listar pedidos pendientes
app.get('/pedidos', requireRole('cocina', 'mesero', 'admin'), async (req, res) => {
  try { res.json(await store.pendientes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Limpiar todos los pedidos completados
app.delete('/pedidos/completados', requireRole('cocina', 'admin'), async (req, res) => {
  try {
    await store.clearCompletados();
    await broadcast({ type: 'history_cleared' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Emitir factura electrónica via Factus
app.post('/facturar/:id', requireRole('cocina', 'admin'), async (req, res) => {
  if (!factusConfig.configurado) {
    return res.status(503).json({ error: 'Configura tus credenciales en factus.config.js' });
  }

  const id = parseInt(req.params.id);
  const order = await store.get(id);
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
      await store.marcarFacturado(order.id, { cufe: bill.cufe, number: bill.number });
      await broadcast({ type: 'order_invoiced', id: order.id, number: bill.number });
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

// El app se exporta para que lo levante quien corresponda: en local el
// `listen` de aquí abajo, en Vercel la función de api/index.js.
module.exports = app;

// require.main === module: solo arrancamos un servidor propio si este archivo
// se ejecutó directamente (`node server.js`). Si lo importaron, no.
if (require.main === module) {
  // Comprobar que Supabase responde ANTES de aceptar conexiones: si las
  // credenciales están mal, mejor saberlo aquí que en el primer pedido.
  store.init().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
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
      console.log('🔒 Acceso: cada persona entra con su nombre y su PIN (se administran desde Admin → Usuarios)');
      console.log('☁️  Datos en Supabase · avisos en vivo por Supabase Realtime\n');
    });
  }).catch(err => {
    console.error('❌ No se pudo conectar a Supabase al arrancar:', err.message);
    process.exit(1);
  });
}
