// ─────────────────────────────────────────────────────────────
//  Acceso — compartido por todas las pantallas del personal.
//
//  Antes cada pantalla tenía su propia copia del login y del enrutado, y se
//  habían desincronizado (el mesero terminaba en la pantalla de cocina).
//  Aquí vive una sola vez.
//
//  Uso en cada página:
//    <div class="login-overlay" id="loginOverlay">
//      <input id="userInput" /> <input id="pinInput" type="password" /> ...
//    <script src="auth.js"></script>
//    initAuth({ roles: ['cocina','admin'], onStart: startApp });
//
//  · roles   → qué roles puede USAR esta pantalla. A los demás se les manda
//              a la suya (HOME), según el rol que traiga su cuenta.
//  · onStart → se llama cuando el rol sí puede quedarse aquí.
// ─────────────────────────────────────────────────────────────

const AUTH_KEY = 'coraje_auth';

// Pantalla propia de cada rol: a dónde va al entrar si no puede quedarse aquí.
const HOME = { mesero: 'mesero.html', cocina: 'comanda.html', admin: 'admin.html' };
const NOMBRE_ROL = { mesero: 'Mesero', cocina: 'Cocina', admin: 'Administrador' };

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
// Usuario y contraseña, como en cualquier sistema.
//
// Antes se elegía el rol con unas pestañas y se marcaba un PIN. Eso traía dos
// problemas: había que acertarle a la pestaña correcta, y si te equivocabas el
// sistema te mandaba a la pantalla de ese otro rol — parecía que abriera
// cualquier cosa al azar. Ahora el rol sale de la cuenta, así que cada quien
// aterriza siempre donde le toca.
let _rolesPagina = [];
let _onStart = () => {};

// A dónde va este rol: se queda si la pantalla lo admite, si no a la suya.
function routeTo(role) {
  if (_rolesPagina.includes(role)) _onStart();
  else location.href = HOME[role] || 'comanda.html';
}

async function doLogin() {
  const userInput = document.getElementById('userInput');
  const input = document.getElementById('pinInput');
  const err = document.getElementById('loginErr');
  if (err) err.textContent = '';
  const usuario = (userInput?.value || '').trim();
  if (!usuario) { if (err) err.textContent = 'Escribe tu usuario'; userInput?.focus(); return; }
  if (!input.value) { if (err) err.textContent = 'Escribe tu contraseña'; input.focus(); return; }
  try {
    const res = await fetch('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password: input.value }),
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
  document.getElementById('userInput')?.focus();
}

// defaultRole se acepta pero ya no se usa: el rol viene de la cuenta.
function initAuth({ roles, onStart }) {
  _rolesPagina = roles;
  _onStart = onStart;

  const a = getAuth();
  if (a?.token && roles.includes(a.role)) onStart();      // ya tiene sesión y puede estar aquí
  else if (a?.token && HOME[a.role]) location.href = HOME[a.role];  // logueado, pero esta no es su pantalla
  else mostrarLogin();
}
