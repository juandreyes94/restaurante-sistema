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

const escAuth = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ajena: hay una sesión abierta que no sirve para esta pantalla.
function mostrarLogin(ajena) {
  const ov = document.getElementById('loginOverlay');
  if (ov) ov.style.display = 'flex';

  const err = document.getElementById('loginErr');
  if (ajena && err) {
    const suya = HOME[ajena.role];
    err.innerHTML =
      `Hay una sesión abierta de <b>${escAuth(ajena.nombre)}</b> ` +
      `(${escAuth(NOMBRE_ROL[ajena.role] || ajena.role)}), que no tiene acceso a esta pantalla. ` +
      `Entra con la cuenta que corresponda` +
      (suya ? ` o <a href="${suya}">vuelve a la pantalla de ${escAuth(NOMBRE_ROL[ajena.role] || ajena.role)}</a>` : '') + '.';
  }
  document.getElementById('userInput')?.focus();
}

function initAuth({ roles, onStart }) {
  _rolesPagina = roles;
  _onStart = onStart;

  const a = getAuth();
  if (a?.token && roles.includes(a.role)) return onStart();   // su cuenta sirve aquí

  // Antes, si la sesión abierta era de otro rol, se redirigía en silencio a la
  // pantalla de ese rol. Resultado: con un mesero logueado no había forma de
  // llegar al login del admin — abrías admin.html y aparecía la de mesero.
  // Ahora se muestra el login para poder entrar con la cuenta correcta.
  mostrarLogin(a?.token ? a : null);
}
