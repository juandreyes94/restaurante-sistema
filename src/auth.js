// ─────────────────────────────────────────────────────────────
//  Acceso por PIN — compartido por todas las pantallas del personal.
//
//  Antes cada pantalla tenía su propia copia del login y del enrutado, y se
//  habían desincronizado (el mesero terminaba en la pantalla de cocina).
//  Aquí vive una sola vez.
//
//  Uso en cada página:
//    <div class="login-overlay" id="loginOverlay"> ... <div class="role-tabs" id="roleTabs"></div> ...
//    <script src="auth.js"></script>
//    initAuth({ roles: ['cocina','admin'], onStart: startApp });
//
//  · roles   → qué roles puede USAR esta pantalla. Los demás se redirigen
//              a la suya (el login siempre ofrece los tres).
//  · onStart → se llama cuando el rol sí puede quedarse aquí.
// ─────────────────────────────────────────────────────────────

const AUTH_KEY = 'coraje_auth';

// Pantalla propia de cada rol: a dónde va al entrar si no puede quedarse aquí.
const HOME = { mesero: 'mesero.html', cocina: 'comanda.html', admin: 'admin.html' };
const NOMBRE_ROL = { mesero: 'Mesero', cocina: 'Cocina', admin: 'Administrador' };

const ROLES = [
  { id: 'mesero', label: 'Mesero', icon: '<path d="M18 8h1a3 3 0 0 1 0 6h-1"/><path d="M2 8h16v5a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5z"/><path d="M6 2v2M10 2v2M14 2v2"/>' },
  { id: 'cocina', label: 'Cocina', icon: '<path d="M6 13.9A4 4 0 0 1 7.4 6 5 5 0 0 1 16.6 6 4 4 0 0 1 18 13.9V18H6Z"/><path d="M6 21h12"/>' },
  { id: 'admin',  label: 'Admin',  icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>' },
];

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}
function authHeaders() {
  const a = getAuth();
  return a?.token ? { 'x-auth-token': a.token } : {};
}
function logout() { localStorage.removeItem(AUTH_KEY); location.reload(); }

// Los tokens viven en memoria del servidor: al reiniciarlo, el guardado en el
// navegador deja de servir y la API responde 403. Sin esto las pantallas se
// dibujaban vacías, como si no hubiera datos.
let _sesionCaida = false;
function sesionExpirada(res) {
  if (res.status !== 401 && res.status !== 403) return false;
  if (_sesionCaida) return true;
  _sesionCaida = true;
  localStorage.removeItem(AUTH_KEY);
  if (typeof toast === 'function') toast('Tu sesión expiró (se reinició el servidor). Vuelve a entrar.');
  setTimeout(() => location.reload(), 1800);
  return true;
}

// ── Login ──
// Patrón de POS: tocas tu nombre y marcas tu PIN. Escribir un correo en una
// tablet a media hora pico es inviable, por eso no se usa email/contraseña.
let _rolesPagina = [];
let _onStart = () => {};
let _selRole = null;      // pestaña de rol elegida (filtra la lista de gente)
let _selUsuario = null;   // persona elegida
let _usuarios = [];

const escAuth = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function pickRole(r) {
  _selRole = r;
  _selUsuario = null;
  document.querySelectorAll('.role-tab').forEach(t => t.classList.toggle('active', t.dataset.role === r));
  renderUsuarios();
}

function pickUsuario(id) {
  _selUsuario = _usuarios.find(u => u.id === id) || null;
  renderUsuarios();
  document.getElementById('pinInput')?.focus();
}

function renderRoleTabs() {
  const box = document.getElementById('roleTabs');
  if (!box) return;
  box.innerHTML = ROLES.map(r =>
    `<button class="role-tab${r.id === _selRole ? ' active' : ''}" data-role="${r.id}" onclick="pickRole('${r.id}')">
       <svg class="i" viewBox="0 0 24 24">${r.icon}</svg> ${r.label}
     </button>`).join('');
}

function renderUsuarios() {
  const box = document.getElementById('userList');
  if (!box) return;
  const gente = _usuarios.filter(u => u.rol === _selRole);
  const pin = document.getElementById('pinRow');

  if (!gente.length) {
    box.innerHTML = `<p class="login-vacio">No hay nadie registrado como ${escAuth(NOMBRE_ROL[_selRole] || _selRole)}.</p>`;
    if (pin) pin.style.display = 'none';
    return;
  }
  box.innerHTML = gente.map(u =>
    `<button class="user-chip${_selUsuario?.id === u.id ? ' active' : ''}" onclick="pickUsuario(${u.id})">
       ${escAuth(u.nombre)}
     </button>`).join('');
  if (pin) pin.style.display = _selUsuario ? 'block' : 'none';
}

async function cargarUsuarios() {
  try {
    const r = await fetch('/usuarios/activos');
    _usuarios = await r.json();
    if (!Array.isArray(_usuarios)) _usuarios = [];
  } catch { _usuarios = []; }

  if (!_usuarios.length) {
    const box = document.getElementById('userList');
    if (box) box.innerHTML = `<p class="login-vacio">No hay usuarios creados todavía.<br/>
      Córrele <code>node scripts/crear-usuarios.js</code> al servidor.</p>`;
    return;
  }
  // Si en esta pantalla no hay nadie del rol por defecto, abrir en uno que sí tenga
  if (!_usuarios.some(u => u.rol === _selRole)) {
    const alt = ROLES.map(r => r.id).find(r => _usuarios.some(u => u.rol === r));
    if (alt) _selRole = alt;
  }
  renderRoleTabs();
  renderUsuarios();
}

// A dónde va este rol: se queda si la pantalla lo admite, si no a la suya.
function routeTo(role) {
  if (_rolesPagina.includes(role)) _onStart();
  else location.href = HOME[role] || 'comanda.html';
}

async function doLogin() {
  const input = document.getElementById('pinInput');
  const err = document.getElementById('loginErr');
  if (err) err.textContent = '';
  if (!_selUsuario) { if (err) err.textContent = 'Elige tu nombre primero'; return; }
  try {
    const res = await fetch('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: _selUsuario.id, pin: input.value.trim() }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'PIN incorrecto');
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      role: data.role, token: data.token, nombre: data.nombre, usuario_id: data.usuario_id,
    }));
    routeTo(data.role);
  } catch (e) {
    input.classList.add('err');
    if (err) err.textContent = e.message || 'PIN incorrecto';
    input.value = ''; input.focus();
    setTimeout(() => input.classList.remove('err'), 400);
  }
}

function mostrarLogin() {
  const ov = document.getElementById('loginOverlay');
  if (ov) ov.style.display = 'flex';
  cargarUsuarios();
}

function initAuth({ roles, onStart, defaultRole }) {
  _rolesPagina = roles;
  _onStart = onStart;
  _selRole = defaultRole || roles[0] || 'cocina';
  renderRoleTabs();

  const a = getAuth();
  if (a?.token && roles.includes(a.role)) onStart();      // ya tiene sesión y puede estar aquí
  else if (a?.token && HOME[a.role]) location.href = HOME[a.role];  // logueado, pero esta no es su pantalla
  else mostrarLogin();
}
