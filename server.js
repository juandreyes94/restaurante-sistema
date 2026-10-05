const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const os = require('os');
// Supabase es el motor establecido. STORE=local levanta el sistema contra
// data/db.json para poder navegarlo y trabajar en las pantallas cuando la base
// no está disponible (p. ej. el proyecto pausado por inactividad).
const store = require(process.env.STORE === 'local' ? './store-local' : './store-supabase');
const { broadcast } = require('./realtime-server');
const { factus: factusConfig, jwtSecret, jwtEsDeDesarrollo, supabase: supaCfg } = require('./config');
const { normalizarTelefono } = require('./codigo-cliente');

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

// Pantalla de entrada de cada rol. Vive aquí, del lado del servidor, porque es
// el mismo sitio que decide el rol: el login responde a dónde va cada quien y
// el navegador solo obedece. Antes el mapa estaba escrito a mano en auth.js, y
// una regla duplicada en el cliente es una regla que se puede desincronizar.
//
// Ojo: esto es a dónde aterrizas, no a qué tienes derecho. El permiso real lo
// impone requireRole en cada ruta de la API, que es donde no se puede hacer
// trampa. Los roles están restringidos por CHECK en la tabla usuarios, así que
// el mapa siempre acierta.
const HOME_ROL = { mesero: 'mesero.html', cocina: 'comanda.html', admin: 'admin.html' };

if (jwtEsDeDesarrollo) {
  console.warn('⚠️  JWT_SECRET no está definido: usando uno de desarrollo. Defínelo antes de desplegar.');
}

// Lo que el navegador necesita para suscribirse a los avisos en vivo.
// La anon key es pública por diseño (va al cliente igual); se sirve desde aquí
// para no tenerla escrita a mano en cada HTML ni versionada en el repo.
app.get('/realtime-config', (req, res) => {
  // En modo local no hay canal de Supabase al que suscribirse. Sin anonKey, el
  // navegador toma la rama de respaldo de src/realtime.js: pide el estado por
  // HTTP y pinta la pantalla. Si se manda la clave, se queda esperando un
  // SUBSCRIBED que nunca llega y la comanda no carga nunca.
  const local = process.env.STORE === 'local';
  res.json({ url: supaCfg.url, anonKey: local ? null : (supaCfg.anonKey || null) });
});

// Login: usuario y contraseña. El rol sale de la cuenta, no se elige al
// entrar — así nadie termina en una pantalla que no le corresponde.
// Sigue aceptando { usuario_id, pin } por si algo viejo lo usa.
app.post('/login', async (req, res) => {
  const { usuario_id, usuario, password, pin } = req.body || {};
  const clave = password ?? pin;
  if (!clave) return res.status(400).json({ error: 'Falta la contraseña' });
  if (!usuario_id && !String(usuario || '').trim()) {
    return res.status(400).json({ error: 'Falta el usuario' });
  }
  try {
    const u = usuario_id
      ? await store.verificarPin(usuario_id, clave)
      : await store.verificarCredenciales(usuario, clave);
    if (!u) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = jwt.sign(
      { uid: u.id, nombre: u.nombre, rol: u.rol },
      JWT_SECRET, { expiresIn: `${JWT_HORAS}h` });
    res.json({ ok: true, role: u.rol, home: HOME_ROL[u.rol], nombre: u.nombre, usuario_id: u.id, token });
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
  const malaClave = validarClave(pin);
  if (malaClave) return res.status(400).json({ error: malaClave });
  try { res.json({ success: true, usuario: await store.usuarioAdd({ nombre: String(nombre).trim(), rol, pin }) }); }
  catch (e) { res.status(errorHttp(e)).json({ error: errorUsuario(e) }); }
});

// La contraseña ya no tiene que ser un PIN numérico: se escribe en un teclado
// normal, así que se admite cualquier cosa de 4 caracteres para arriba. Las
// claves viejas (9876, 1234…) siguen sirviendo tal cual.
function validarClave(v) {
  const s = String(v ?? '');
  if (s.length < 4) return 'La contraseña debe tener al menos 4 caracteres';
  if (s.length > 64) return 'La contraseña es demasiado larga';
  return null;
}

app.put('/usuarios/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { nombre, rol, pin, activo } = req.body || {};
  if (nombre !== undefined && !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (rol !== undefined && !['mesero', 'cocina', 'admin'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (pin) { const mala = validarClave(pin); if (mala) return res.status(400).json({ error: mala }); }
  // Dos formas de quedarse fuera del panel uno mismo: desactivarse o bajarse el rol.
  if (id === req.usuario.id) {
    if (activo === false) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    if (rol !== undefined && rol !== 'admin') return res.status(400).json({ error: 'No puedes quitarte tu propio rol de administrador' });
  }
  try { res.json({ success: true, usuario: await store.usuarioUpdate(id, req.body || {}) }); }
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

// ── Fidelización: tarjeta de sellos ────────────────────────────
//
// Dos rutas públicas y el resto protegidas. Las públicas lo son a propósito:
// el cliente no tiene cuenta en el POS ni debería tenerla, así que su tarjeta
// se identifica con el código aleatorio que lleva encima. No es un secreto
// fuerte, pero solo expone el nombre y los sellos de esa persona, y sin él no
// se puede enumerar nada.

app.get('/fidelizacion/reglas', async (req, res) => {
  try { res.json(await store.reglasFidelizacion()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Registro del cliente. Sin autorización de datos no se guarda: en Colombia
// hay que poder demostrar que la persona la dio, y cuándo.
app.post('/clientes', async (req, res) => {
  const { nombre, telefono, email, autoriza_datos } = req.body || {};
  if (!String(nombre || '').trim()) return res.status(400).json({ error: 'Escribe tu nombre' });
  const tel = normalizarTelefono(telefono);
  if (tel.length < 7) return res.status(400).json({ error: 'Escribe un teléfono válido' });
  if (!autoriza_datos) {
    return res.status(400).json({ error: 'Necesitamos tu autorización para guardar tus datos' });
  }
  try {
    const cliente = await store.clienteAdd({ nombre, telefono: tel, email, autoriza_datos: true });
    res.json({ success: true, codigo: cliente.codigo, nombre: cliente.nombre });
  } catch (e) {
    if (e && e.code === '23505') {
      // Ya registrado: no es un error, es que vuelve. Se le devuelve su código
      // para que abra su tarjeta en vez de quedarse trancado.
      const ya = await store.clientePorTelefono(tel).catch(() => null);
      if (ya) return res.json({ success: true, yaExistia: true, codigo: ya.codigo, nombre: ya.nombre });
      return res.status(400).json({ error: 'Ese teléfono ya está registrado' });
    }
    res.status(500).json({ error: e.message });
  }
});

// La tarjeta que ve el cliente.
app.get('/tarjeta/:codigo', async (req, res) => {
  try {
    const cliente = await store.clientePorCodigo(req.params.codigo);
    if (!cliente || !cliente.activo) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    const [sellos, reglas, historial] = await Promise.all([
      store.clienteSaldo(cliente.id),
      store.reglasFidelizacion(),
      store.clienteHistorial(cliente.id),
    ]);
    // Solo lo que la tarjeta pinta. El teléfono y el email no salen: el
    // enlace puede terminar reenviado por WhatsApp.
    res.json({
      nombre: cliente.nombre, codigo: cliente.codigo, sellos, reglas, historial,
      completadas: Math.floor(sellos / reglas.sellos_por_premio),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buscar en el mostrador: por código escaneado, o por teléfono si no lo trae.
app.get('/clientes/buscar', requireRole('mesero', 'cocina', 'admin'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Falta qué buscar' });
  try {
    const soloDigitos = q.replace(/\D/g, '');
    const cliente = soloDigitos.length >= 7
      ? await store.clientePorTelefono(q)
      : await store.clientePorCodigo(q);
    if (!cliente) return res.status(404).json({ error: 'No encontramos esa tarjeta' });
    const [sellos, reglas] = await Promise.all([
      store.clienteSaldo(cliente.id), store.reglasFidelizacion(),
    ]);
    res.json({
      id: cliente.id, nombre: cliente.nombre, codigo: cliente.codigo,
      telefono: cliente.telefono, activo: cliente.activo,
      sellos, puedeCanjear: sellos >= reglas.sellos_por_premio, reglas,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Poner sello. El pedidoId es lo que impide sellar dos veces la misma venta.
app.post('/clientes/:codigo/sello', requireRole('mesero', 'admin'), async (req, res) => {
  try {
    const reglas = await store.reglasFidelizacion();
    if (!reglas.fidelizacion_activa) {
      return res.status(400).json({ error: 'El programa de sellos está desactivado' });
    }
    const cliente = await store.clientePorCodigo(req.params.codigo);
    if (!cliente || !cliente.activo) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    const pedidoId = req.body && req.body.pedidoId != null ? Number(req.body.pedidoId) : null;
    const cantidad = Number(req.body && req.body.cantidad) || reglas.sellos_por_compra;
    await store.selloDar({
      clienteId: cliente.id, pedidoId, cantidad,
      usuarioId: req.usuario.id, usuario: req.usuario.nombre,
    });
    const sellos = await store.clienteSaldo(cliente.id);
    res.json({
      success: true, nombre: cliente.nombre, sellos,
      puedeCanjear: sellos >= reglas.sellos_por_premio, reglas,
    });
  } catch (e) {
    if (e && e.code === '23505') return res.status(400).json({ error: 'Ese pedido ya tenía sello' });
    res.status(500).json({ error: e.message });
  }
});

// Canjear. El descuento de sellos lo hace la BD en una sola transacción, así
// que dos meseros a la vez no entregan dos premios con los sellos de uno.
app.post('/clientes/:codigo/canjear', requireRole('mesero', 'admin'), async (req, res) => {
  try {
    const cliente = await store.clientePorCodigo(req.params.codigo);
    if (!cliente || !cliente.activo) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    const pedidoId = req.body && req.body.pedidoId != null ? Number(req.body.pedidoId) : null;
    const r = await store.canjear({
      clienteId: cliente.id, pedidoId,
      usuarioId: req.usuario.id, usuario: req.usuario.nombre,
    });
    const reglas = await store.reglasFidelizacion();
    res.json({ success: true, nombre: cliente.nombre, sellos: r.restantes, premio: reglas.premio_descripcion });
  } catch (e) {
    if (e && e.code === 'P0001') return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Listado y edición: del admin.
app.get('/clientes', requireRole('admin'), async (req, res) => {
  try { res.json(await store.clientes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/clientes/:id', requireRole('admin'), async (req, res) => {
  try { res.json({ success: true, cliente: await store.clienteUpdate(parseInt(req.params.id), req.body || {}) }); }
  catch (e) {
    if (e && e.code === '23505') return res.status(400).json({ error: 'Ese teléfono ya está registrado' });
    res.status(500).json({ error: e.message });
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
