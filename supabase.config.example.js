// Plantilla de credenciales de Supabase.
// Copia este archivo a `supabase.config.js` y pega los datos del
// proyecto Supabase de ESTE cliente (Project Settings → API).
// El archivo real (supabase.config.js) NO se sube al repo.
//
// En un servidor no existe este archivo: allá mandan las variables de entorno
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_ANON_KEY.
module.exports = {
  url: 'https://TU_PROYECTO.supabase.co',
  serviceRoleKey: 'TU_SERVICE_ROLE_KEY', // secret — solo servidor
  anonKey: 'TU_ANON_KEY',                // pública — el navegador la usa para los avisos en vivo
};
