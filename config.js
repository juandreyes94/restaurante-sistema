// ─────────────────────────────────────────────────────────────
//  Credenciales — variables de entorno primero, archivo local después.
//
//  En local seguimos usando supabase.config.js / factus.config.js (que no
//  van al repo). En un servidor no hay esos archivos: ahí manda el entorno.
//  Por eso el require va dentro de un try: si el archivo no existe, no es un
//  error, simplemente no hay de dónde leer más que del entorno.
// ─────────────────────────────────────────────────────────────

function archivoLocal(ruta) {
  try { return require(ruta); }
  catch { return {}; }
}

const supaLocal   = archivoLocal('./supabase.config.js');
const factusLocal = archivoLocal('./factus.config.js');

const supabase = {
  url:            process.env.SUPABASE_URL             || supaLocal.url,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || supaLocal.serviceRoleKey,
  // Clave pública: la usa el navegador para suscribirse a Realtime. No es
  // secreta (va al cliente igual), pero se sirve desde el servidor para no
  // tenerla escrita a mano en cada HTML.
  anonKey:        process.env.SUPABASE_ANON_KEY        || supaLocal.anonKey,
};

if (!supabase.url || !supabase.serviceRoleKey) {
  throw new Error(
    'Faltan credenciales de Supabase. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ' +
    'en el entorno, o crea supabase.config.js a partir del .example.');
}

const factus = {
  email:              process.env.FACTUS_EMAIL              || factusLocal.email,
  password:           process.env.FACTUS_PASSWORD           || factusLocal.password,
  clientId:           process.env.FACTUS_CLIENT_ID          || factusLocal.clientId          || '2',
  clientSecret:       process.env.FACTUS_CLIENT_SECRET      || factusLocal.clientSecret      || 'factus2024',
  numbering_range_id: Number(process.env.FACTUS_NUMBERING_RANGE_ID) || factusLocal.numbering_range_id || 1,
  municipality_id:    Number(process.env.FACTUS_MUNICIPALITY_ID)    || factusLocal.municipality_id    || 149,
  tax_rate:           process.env.FACTUS_TAX_RATE           || factusLocal.tax_rate           || '0.00',
  tribute_id:         Number(process.env.FACTUS_TRIBUTE_ID) || factusLocal.tribute_id         || 21,
};

// Sin credenciales reales la facturación se apaga sola en vez de reventar al
// emitir: el resto del sistema (pedidos, cocina, inventario) funciona igual.
factus.configurado = !!(factus.email && factus.password &&
                        factus.email !== 'TU_EMAIL@ejemplo.com');

const jwtSecret = process.env.JWT_SECRET || 'coraje-dev-secret-cambiar-en-produccion';
const jwtEsDeDesarrollo = !process.env.JWT_SECRET;

module.exports = { supabase, factus, jwtSecret, jwtEsDeDesarrollo };
